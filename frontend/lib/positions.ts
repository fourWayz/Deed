import type { Address, PublicClient } from "viem";
import { ADDR, ZERO, GAS_COMP, deedAbi, factoryAbi, vaultAbi, marketAbi, auctionAbi, priceFeedAbi, spotAbi, troveManagerAbi } from "./config";
import { priceSourceInRange } from "./priceSource";

export type Listing = { seller: Address; expiry: bigint; price: bigint; minICR: bigint; snapshot: `0x${string}` };
export type AuctionInfo = {
  seller: Address;
  byOwner: boolean;
  start: bigint;
  duration: bigint;
  startPrice: bigint;
  floorPrice: bigint;
};

export type Position = {
  id: bigint;
  vault: Address;
  owner: Address;
  lockedBy: Address;
  status: number;
  // stored numbers, these are what the market snapshot hashes
  coll: bigint;
  principal: bigint;
  rate: number;
  // live numbers with interest and pending rewards
  liveColl: bigint;
  // entire debt: principal plus accrued interest plus pending redistribution, this is what ICR is measured against
  debt: bigint;
  interest: bigint;
  // the part of the entire debt that came from other liquidations and is not stored on the trove yet
  pendingDebt: bigint;
  icr: bigint | null;
  equity: bigint | null;
  listing: Listing | null;
  auction: AuctionInfo | null;
};

export type Snapshot = {
  positions: Position[];
  price: bigint | null;
  rescueICR: bigint;
  safeICR: bigint;
  // lowest floor, in basis points of the equity, the auction accepts
  minFloorBps: bigint;
  // false when the DEX price is further from the oracle than the auction allows, null when it could not be checked
  priceSourceOk: boolean | null;
  recovery: RecoveryInfo;
};

// Mezo Recovery Mode: total collateral ratio under 150%. active is null when the oracle was stale and it could not be read.
export type RecoveryInfo = { active: boolean | null; tcr: bigint | null };

const MAX_POSITIONS = 60;

export async function loadPositions(client: PublicClient): Promise<Snapshot> {
  const next = await client.readContract({ address: ADDR.deed, abi: deedAbi, functionName: "nextId" });
  const last = Number(next) - 1;
  const first = Math.max(1, last - MAX_POSITIONS + 1);

  let price: bigint | null = null;
  try {
    price = await client.readContract({ address: ADDR.priceFeed, abi: priceFeedAbi, functionName: "fetchPrice" });
  } catch {
    // the oracle reverts when it is stale
  }

  const [rescueICR, safeICR, minFloorBps] = await Promise.all([
    client.readContract({ address: ADDR.auction, abi: auctionAbi, functionName: "rescueICR" }),
    client.readContract({ address: ADDR.auction, abi: auctionAbi, functionName: "safeICR" }),
    client.readContract({ address: ADDR.auction, abi: auctionAbi, functionName: "MIN_FLOOR_BPS" }),
  ]);

  let priceSourceOk: boolean | null = null;
  if (price !== null) {
    try {
      const [source, maxDev] = await Promise.all([
        client.readContract({ address: ADDR.auction, abi: auctionAbi, functionName: "spotSource" }),
        client.readContract({ address: ADDR.auction, abi: auctionAbi, functionName: "maxDeviationBps" }),
      ]);
      const spot = await client.readContract({ address: source, abi: spotAbi, functionName: "spotPrice" });
      priceSourceOk = priceSourceInRange(price, spot, maxDev);
    } catch {
      // leave it unknown, the contract check still protects the action
    }
  }

  let recovery: RecoveryInfo = { active: null, tcr: null };
  if (price !== null) {
    try {
      const [active, tcr] = await Promise.all([
        client.readContract({ address: ADDR.troveManager, abi: troveManagerAbi, functionName: "checkRecoveryMode", args: [price] }),
        client.readContract({ address: ADDR.troveManager, abi: troveManagerAbi, functionName: "getTCR", args: [price] }),
      ]);
      recovery = { active, tcr };
    } catch {
      // unknown, the contracts still enforce Mezo's rules
    }
  }

  const ids: bigint[] = [];
  for (let i = last; i >= first; i--) ids.push(BigInt(i));

  const positions = await Promise.all(ids.map((id) => loadOne(client, id, price)));
  return { positions, price, rescueICR, safeICR, minFloorBps, priceSourceOk, recovery };
}

async function loadOne(client: PublicClient, id: bigint, price: bigint | null): Promise<Position> {
  const [owner, lockedBy, vault, listing, auction] = await Promise.all([
    client.readContract({ address: ADDR.deed, abi: deedAbi, functionName: "ownerOf", args: [id] }),
    client.readContract({ address: ADDR.deed, abi: deedAbi, functionName: "lockedBy", args: [id] }),
    client.readContract({ address: ADDR.factory, abi: factoryAbi, functionName: "vaultOf", args: [id] }),
    client.readContract({ address: ADDR.market, abi: marketAbi, functionName: "listings", args: [id] }),
    client.readContract({ address: ADDR.auction, abi: auctionAbi, functionName: "auctions", args: [id] }),
  ]);
  const [trove, live, entire] = await Promise.all([
    client.readContract({ address: vault, abi: vaultAbi, functionName: "troveState" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "liveState" }),
    client.readContract({ address: ADDR.troveManager, abi: troveManagerAbi, functionName: "getEntireDebtAndColl", args: [vault] }),
  ]);
  const [status, coll, principal, rate] = trove;
  const [liveColl, debt] = live;
  const interest = entire[2];
  const pendingDebt = entire[4] + entire[5];

  let icr: bigint | null = null;
  let equity: bigint | null = null;
  if (price !== null && status === 1 && debt > 0n) {
    icr = (liveColl * price) / debt;
    const value = (liveColl * price) / 10n ** 18n;
    const owed = debt - GAS_COMP;
    equity = value > owed ? value - owed : 0n;
  }

  const [lSeller, expiry, lPrice, minICR, snapshot] = listing;
  const [aSeller, byOwner, start, duration, startPrice, floorPrice] = auction;
  return {
    id,
    vault,
    owner,
    lockedBy,
    status,
    coll,
    principal,
    rate,
    liveColl,
    debt,
    interest,
    pendingDebt,
    icr,
    equity,
    listing: lSeller === ZERO ? null : { seller: lSeller, expiry, price: lPrice, minICR, snapshot },
    auction: aSeller === ZERO ? null : { seller: aSeller, byOwner, start, duration, startPrice, floorPrice },
  };
}

/** Price the auction asks right now, same linear formula as the contract. */
export function auctionPriceAt(a: AuctionInfo, nowSec: number): bigint {
  const elapsed = BigInt(Math.max(0, nowSec)) - a.start;
  if (elapsed <= 0n) return a.startPrice;
  if (elapsed >= a.duration) return a.floorPrice;
  return a.startPrice - ((a.startPrice - a.floorPrice) * elapsed) / a.duration;
}
