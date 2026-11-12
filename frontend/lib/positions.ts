import type { Address, PublicClient } from "viem";
import { ADDR, ZERO, deedAbi, marketAbi, auctionAbi, spotAbi, lensAbi, troveManagerAbi } from "./config";
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

// DeedLens status codes: 0 none, 1 active, 2 closed by the holder, 3 liquidated, 4 closed by a redemption
export type Position = {
  id: bigint;
  vault: Address;
  owner: Address;
  lockedBy: Address;
  status: number;
  // entire collateral and principal (pending redistribution included), these are what the market snapshot hashes
  collateral: bigint;
  principal: bigint;
  rate: number;
  // principal plus accrued interest plus pending redistribution, what the ICR is measured against
  debt: bigint;
  interest: bigint;
  icr: bigint | null;
  equity: bigint | null;
  // collateral Mezo is holding for this vault after a redemption closed the whole trove
  surplus: bigint;
  // what Mezo allows right now, from DeedLens. A listing or auction can still freeze the vault on top of this.
  can: { close: boolean; withdraw: boolean; borrow: boolean; refinance: boolean };
  listing: Listing | null;
  auction: AuctionInfo | null;
};

// Recovery Mode is a system total collateral ratio under 150%. stale means the oracle was older than 60 seconds.
export type SystemInfo = { recovery: boolean; tcr: bigint | null; stale: boolean };

export type Snapshot = {
  positions: Position[];
  price: bigint | null;
  rescueICR: bigint;
  safeICR: bigint;
  // lowest floor, in basis points of the equity, the auction accepts
  minFloorBps: bigint;
  // false when the DEX price is further from the oracle than the auction allows, null when it could not be checked
  priceSourceOk: boolean | null;
  system: SystemInfo;
};

const MAX_POSITIONS = 60;

export async function loadPositions(client: PublicClient): Promise<Snapshot> {
  const next = await client.readContract({ address: ADDR.deed, abi: deedAbi, functionName: "nextId" });
  const last = Number(next) - 1;
  const first = Math.max(1, last - MAX_POSITIONS + 1);

  const [sys, rescueICR, safeICR, minFloorBps] = await Promise.all([
    client.readContract({ address: ADDR.lens, abi: lensAbi, functionName: "system" }),
    client.readContract({ address: ADDR.auction, abi: auctionAbi, functionName: "rescueICR" }),
    client.readContract({ address: ADDR.auction, abi: auctionAbi, functionName: "safeICR" }),
    client.readContract({ address: ADDR.auction, abi: auctionAbi, functionName: "MIN_FLOOR_BPS" }),
  ]);
  const [lensPrice, tcr, recovery, stale] = sys;
  const price = stale ? null : lensPrice;
  const system: SystemInfo = { recovery: !stale && recovery, tcr: stale ? null : tcr, stale };

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

  const ids: bigint[] = [];
  for (let i = last; i >= first; i--) ids.push(BigInt(i));
  const positions = await Promise.all(ids.map((id) => loadOne(client, id)));
  return { positions, price, rescueICR, safeICR, minFloorBps, priceSourceOk, system };
}

async function loadOne(client: PublicClient, id: bigint): Promise<Position> {
  const [v, listing, auction] = await Promise.all([
    client.readContract({ address: ADDR.lens, abi: lensAbi, functionName: "position", args: [id] }),
    client.readContract({ address: ADDR.market, abi: marketAbi, functionName: "listings", args: [id] }),
    client.readContract({ address: ADDR.auction, abi: auctionAbi, functionName: "auctions", args: [id] }),
  ]);
  const [lSeller, expiry, lPrice, minICR, snapshot] = listing;
  const [aSeller, byOwner, start, duration, startPrice, floorPrice] = auction;
  const active = v.status === 1;
  return {
    id,
    vault: v.vault,
    owner: v.holder,
    lockedBy: v.lockedBy,
    status: v.status,
    collateral: v.collateral,
    principal: v.principal,
    rate: v.rate,
    debt: v.debt,
    interest: v.interest,
    // the lens answers 0 when the oracle is stale, that is "no reading", not a ratio of zero
    icr: active && !v.priceStale ? v.icr : null,
    equity: active && !v.priceStale ? v.equity : null,
    surplus: v.surplus,
    can: { close: v.canClose, withdraw: v.canWithdraw, borrow: v.canBorrow, refinance: v.canRefinance },
    listing: lSeller === ZERO ? null : { seller: lSeller, expiry, price: lPrice, minICR, snapshot },
    auction: aSeller === ZERO ? null : { seller: aSeller, byOwner, start, duration, startPrice, floorPrice },
  };
}

/**
 * The part of the lens's principal and interest that came from other liquidations and is not stored on the trove yet.
 * Only the position page needs it, to split the entire debt into what was borrowed, interest and pending.
 */
export async function loadPending(client: PublicClient, vault: Address): Promise<{ principal: bigint; interest: bigint }> {
  const e = await client.readContract({ address: ADDR.troveManager, abi: troveManagerAbi, functionName: "getEntireDebtAndColl", args: [vault] });
  return { principal: e[4], interest: e[5] };
}

/** Price the auction asks right now, same linear formula as the contract. */
export function auctionPriceAt(a: AuctionInfo, nowSec: number): bigint {
  const elapsed = BigInt(Math.max(0, nowSec)) - a.start;
  if (elapsed <= 0n) return a.startPrice;
  if (elapsed >= a.duration) return a.floorPrice;
  return a.startPrice - ((a.startPrice - a.floorPrice) * elapsed) / a.duration;
}
