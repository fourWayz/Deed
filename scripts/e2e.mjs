// Live end to end run against the deployed Deed contracts on Mezo testnet.
// node --env-file=.env scripts/e2e.mjs
// Keys come from the environment and are never printed or written anywhere.
import fs from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  encodeFunctionData,
  formatUnits,
  http,
  parseAbi,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const dep = JSON.parse(fs.readFileSync(new URL("../deployments.json", import.meta.url)));
for (const k of ["deedNFT", "factory", "market", "auction", "spotSource", "musd", "priceFeed", "troveManager", "hintHelpers", "sortedTroves"]) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(dep[k] ?? "")) throw new Error(`deployments.json has no address for "${k}"`);
}
const RPC = process.env.MEZO_TESTNET_RPC;
const key = (k) => (k.startsWith("0x") ? k : `0x${k}`);
const chain = {
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};
const transport = http(RPC, { retryCount: 5, retryDelay: 1500 });
const pub = createPublicClient({ chain, transport });
const seller = privateKeyToAccount(key(process.env.SELLER_KEY));
const buyer = privateKeyToAccount(key(process.env.BUYER_KEY));
const wallets = {
  seller: createWalletClient({ account: seller, chain, transport }),
  buyer: createWalletClient({ account: buyer, chain, transport }),
};

const abi = {
  deed: parseAbi([
    "function ownerOf(uint256) view returns (address)",
    "function lockedBy(uint256) view returns (address)",
    "function nextId() view returns (uint256)",
    "function initialized() view returns (bool)",
    "function init(address,address,address)",
    "function transferFrom(address,address,uint256)",
    "error Locked()",
    "error AlreadyInitialized()",
    "error NotDeployer()",
  ]),
  factory: parseAbi([
    "function createPosition(uint256 debtAmount, address upperHint, address lowerHint) payable returns (uint256 tokenId, address vault)",
    "function vaultOf(uint256) view returns (address)",
    "event PositionCreated(uint256 indexed tokenId, address indexed vault, address indexed owner, uint256 collateral, uint256 debt)",
  ]),
  vault: parseAbi([
    "function troveState() view returns (uint8 status, uint256 coll, uint256 principal, uint16 rate)",
    "function liveState() view returns (uint256 coll, uint256 debt)",
    "function addCollateral(address,address) payable",
    "function withdraw(uint256,address,address)",
    "error NotController()",
  ]),
  market: parseAbi([
    "function list(uint256 tokenId, uint256 price, uint64 expiry, uint256 minICR)",
    "function cancel(uint256 tokenId)",
    "function buy(uint256 tokenId, bytes32 expectedSnapshot, uint256 maxPrice)",
    "function claim()",
    "function claimable(address) view returns (uint256)",
    "function listings(uint256) view returns (address seller, uint64 expiry, uint256 price, uint256 minICR, bytes32 snapshot)",
    "function snapshot(address vault, uint256 minICR) view returns (bytes32)",
    "error SnapshotMismatch()",
    "error Expired()",
    "error NotListed()",
    "error PriceTooHigh()",
    "error NotSeller()",
    "error IcrTooLow(uint256 icr, uint256 minICR)",
  ]),
  auction: parseAbi([
    "function startRescue(uint256 tokenId)",
    "function start(uint256 tokenId, uint256 floorBps, uint64 duration)",
    "error BadParams()",
    "function bid(uint256 tokenId, uint256 maxPrice, address upperHint, address lowerHint) payable",
    "function claim()",
    "function claimable(address) view returns (uint256)",
    "function currentPrice(uint256) view returns (uint256)",
    "function requiredTopUp(uint256) view returns (uint256)",
    "function equityOf(uint256) view returns (uint256)",
    "function auctions(uint256) view returns (address seller, bool byOwner, uint64 start, uint64 duration, uint256 startPrice, uint256 floorPrice)",
    "function rescueICR() view returns (uint256)",
    "function safeICR() view returns (uint256)",
    "error SpotDeviation(uint256 oracle, uint256 spot)",
    "error Healthy(uint256 icr, uint256 rescueICR)",
    "error StillRisky(uint256 icr, uint256 safeICR)",
  ]),
  tm: parseAbi(["function getCurrentICR(address,uint256) view returns (uint256)"]),
  feed: parseAbi(["function fetchPrice() view returns (uint256)"]),
  spot: parseAbi(["function spotPrice() view returns (uint256)"]),
  erc20: parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function transfer(address,uint256) returns (bool)",
  ]),
  hh: parseAbi([
    "function getApproxHint(uint256,uint256,uint256) view returns (address,uint256,uint256)",
    "function computeNominalCR(uint256,uint256) pure returns (uint256)",
  ]),
  sorted: parseAbi([
    "function findInsertPosition(uint256,address,address) view returns (address,address)",
    "function getSize() view returns (uint256)",
  ]),
};
const allErrors = [...abi.deed, ...abi.vault, ...abi.market, ...abi.auction].filter((x) => x.type === "error");

const ZERO = "0x0000000000000000000000000000000000000000";
// RESUME_RESCUE=<id> continues a rescue auction that an earlier run already started
const RESUME = process.env.RESUME_RESCUE ? BigInt(process.env.RESUME_RESCUE) : null;
const log = [];
const e18 = (v) => formatUnits(v, 18);
const say = (...a) => console.log(...a);
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

async function nowChain() {
  return Number((await pub.getBlock()).timestamp);
}

async function reasonOf(tx, receipt) {
  try {
    await pub.call({
      account: tx.account,
      to: tx.to,
      data: tx.data,
      value: tx.value,
      blockNumber: receipt.blockNumber - 1n,
    });
    return "no revert on replay";
  } catch (e) {
    const data = e?.data ?? e?.cause?.data ?? e?.cause?.cause?.data;
    if (typeof data === "string" && data.startsWith("0x")) {
      try {
        const d = decodeErrorResult({ abi: allErrors, data });
        return d.errorName;
      } catch {
        return `unknown error ${data.slice(0, 10)}`;
      }
    }
    return e?.shortMessage ?? "reverted";
  }
}

/** Sends a tx and records it. With expectRevert it forces the tx on chain so the failure has a hash. */
async function send(who, label, { to, abi: a, fn, args = [], value, expectRevert }) {
  const w = wallets[who];
  const data = encodeFunctionData({ abi: a, functionName: fn, args });
  let hash;
  if (expectRevert) {
    hash = await w.sendTransaction({ to, data, value, gas: 700000n });
  } else {
    // the Mezo RPC sometimes answers eth_estimateGas with just the 21k intrinsic cost (see estimate-probe.mjs)
    let best = 0n;
    for (let i = 0; i < 3; i++) {
      try {
        const g = await pub.estimateGas({ account: w.account, to, data, value });
        if (g > best) best = g;
      } catch (e) {
        if (i === 0) throw e; // a real revert fails the first estimate too
      }
    }
    const gas = (best * 13n) / 10n > 700000n ? (best * 13n) / 10n : 700000n;
    hash = await w.sendTransaction({ to, data, value, gas });
  }
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  const entry = { who, label, hash, status: receipt.status, block: Number(receipt.blockNumber) };
  if (expectRevert) {
    if (receipt.status !== "reverted") throw new Error(`${label}: expected a revert but it succeeded (${hash})`);
    entry.revertReason = await reasonOf({ account: w.account, to, data, value }, receipt);
    if (expectRevert !== true && entry.revertReason !== expectRevert) {
      throw new Error(`${label}: reverted with ${entry.revertReason}, expected ${expectRevert}`);
    }
  } else if (receipt.status !== "success") {
    throw new Error(`${label}: reverted unexpectedly (${hash})`);
  }
  log.push(entry);
  say(`  ${entry.status === "success" ? "ok " : "REV"} ${label}${entry.revertReason ? ` -> ${entry.revertReason}` : ""}  ${hash}`);
  return receipt;
}

const read = (address, a, functionName, args = [], blockNumber) =>
  pub.readContract({ address, abi: a, functionName, args, blockNumber });

async function hints(coll, principal) {
  try {
    const nicr = await read(dep.hintHelpers, abi.hh, "computeNominalCR", [coll, principal]);
    const size = await read(dep.sortedTroves, abi.sorted, "getSize");
    const trials = BigInt(Math.max(15, Math.ceil(15 * Math.sqrt(Number(size)))));
    const [hint] = await read(dep.hintHelpers, abi.hh, "getApproxHint", [nicr, trials, 42n]);
    const [upper, lower] = await read(dep.sortedTroves, abi.sorted, "findInsertPosition", [nicr, hint, hint]);
    return [upper, lower];
  } catch {
    return [ZERO, ZERO];
  }
}

async function snap(id) {
  const vault = await read(dep.factory, abi.factory, "vaultOf", [id]);
  const [status, coll, principal, rate] = await read(vault, abi.vault, "troveState");
  const [liveColl, debt] = await read(vault, abi.vault, "liveState");
  const price = await read(dep.priceFeed, abi.feed, "fetchPrice");
  const icr = await read(dep.troveManager, abi.tm, "getCurrentICR", [vault, price]);
  return { id, vault, status, coll, principal, rate, liveColl, debt, price, icr };
}
const pct = (v) => `${(Number(formatUnits(v, 18)) * 100).toFixed(2)}%`;

async function approve(who, token, spender, amount) {
  const owner = wallets[who].account.address;
  const cur = await read(token, abi.erc20, "allowance", [owner, spender]);
  if (cur >= amount) return;
  await send(who, `${who} approves MUSD for ${spender === dep.market ? "market" : "auction"}`, {
    to: token,
    abi: abi.erc20,
    fn: "approve",
    args: [spender, amount],
  });
}

async function open(who, label, coll, debt) {
  const principal = debt + debt / 1000n + 200n * 10n ** 18n;
  const [u, l] = await hints(coll, principal);
  const r = await send(who, label, {
    to: dep.factory,
    abi: abi.factory,
    fn: "createPosition",
    args: [debt, u, l],
    value: coll,
  });
  const ev = parseEventLogs({ abi: abi.factory, logs: r.logs, eventName: "PositionCreated" })[0];
  return ev.args.tokenId;
}

const out = { startedAt: new Date().toISOString(), wallets: { seller: seller.address, buyer: buyer.address } };

async function main() {
  const b0 = { seller: await pub.getBalance({ address: seller.address }), buyer: await pub.getBalance({ address: buyer.address }) };
  say(`seller ${seller.address} ${e18(b0.seller)} BTC`);
  say(`buyer  ${buyer.address} ${e18(b0.buyer)} BTC`);
  const price0 = await read(dep.priceFeed, abi.feed, "fetchPrice");
  const spot0 = await read(dep.spotSource, abi.spot, "spotPrice");
  say(`oracle ${e18(price0)}  dex spot ${e18(spot0)}`);
  out.prices = { oracle: e18(price0), spot: e18(spot0) };

  const debt = 1800n * 10n ** 18n;
  const totalDebt = debt + debt / 1000n + 200n * 10n ** 18n;

  if (!RESUME) {
  // --- 1. seller opens the position that goes to market
  say("\n[1] open market position");
  const coll1 = ((totalDebt * 145n) / 100n * 10n ** 18n) / price0 + 10n ** 12n; // about 145% ICR
  // REUSE_A=<id> picks up a position opened by an earlier run so a retry does not burn more BTC
  const id1 = process.env.REUSE_A
    ? BigInt(process.env.REUSE_A)
    : await open("seller", "seller opens position A (market flow)", coll1, debt);
  const a0 = await snap(id1);
  say(`  Deed #${id1} vault ${a0.vault} coll ${e18(a0.liveColl)} BTC debt ${e18(a0.debt)} MUSD ICR ${pct(a0.icr)}`);
  out.positionA = { id: id1.toString(), coll: e18(a0.liveColl), debt: e18(a0.debt), icr: pct(a0.icr) };
  if ((await read(dep.deedNFT, abi.deed, "ownerOf", [id1])).toLowerCase() !== seller.address.toLowerCase()) throw new Error("seller does not hold Deed A");

  // seller hands the buyer enough MUSD for both purchases
  say("\n[2] fund buyer with MUSD");
  await send("seller", "seller sends 1000 MUSD to buyer", {
    to: dep.musd,
    abi: abi.erc20,
    fn: "transfer",
    args: [buyer.address, 1000n * 10n ** 18n],
  });

  say("\n[2b] rescue rules that changed");
  await send("buyer", "a stranger cannot start a public rescue on a healthy position (about 145%, the line is 120%)", {
    to: dep.auction,
    abi: abi.auction,
    fn: "startRescue",
    args: [id1],
    expectRevert: "Healthy",
  });
  await send("seller", "the holder cannot start an auction with a floor under 80% of equity", {
    to: dep.auction,
    abi: abi.auction,
    fn: "start",
    args: [id1, 7999n, 3600n],
    expectRevert: "BadParams",
  });

  const minICR = 13n * 10n ** 17n;
  const salePrice = 100n * 10n ** 18n;

  // --- 3. expiry
  say("\n[3] expiry path");
  const t = await nowChain();
  await send("seller", "seller lists A with a 75s expiry", {
    to: dep.market,
    abi: abi.market,
    fn: "list",
    args: [id1, salePrice, BigInt(t + 75), minICR],
  });
  const lockedBy = await read(dep.deedNFT, abi.deed, "lockedBy", [id1]);
  if (lockedBy.toLowerCase() !== dep.market.toLowerCase()) throw new Error("Deed A not locked by market");
  await send("seller", "seller cannot move a listed Deed", {
    to: dep.deedNFT,
    abi: abi.deed,
    fn: "transferFrom",
    args: [seller.address, buyer.address, id1],
    expectRevert: "Locked",
  });
  await send("seller", "seller cannot withdraw from a listed vault", {
    to: a0.vault,
    abi: abi.vault,
    fn: "withdraw",
    args: [10n ** 12n, ZERO, ZERO],
    expectRevert: "NotController",
  });
  say("  waiting for the listing to expire…");
  while ((await nowChain()) <= t + 75) await sleep(5);
  const s0 = await read(dep.market, abi.market, "snapshot", [a0.vault, minICR]);
  await approve("buyer", dep.musd, dep.market, salePrice);
  await send("buyer", "buyer tries to buy an expired listing", {
    to: dep.market,
    abi: abi.market,
    fn: "buy",
    args: [id1, s0, salePrice],
    expectRevert: "Expired",
  });
  await send("buyer", "buyer (a stranger) clears the expired listing", {
    to: dep.market,
    abi: abi.market,
    fn: "cancel",
    args: [id1],
  });
  if ((await read(dep.deedNFT, abi.deed, "lockedBy", [id1])) !== ZERO) throw new Error("Deed A still locked after expiry cancel");

  // --- 4. cancel
  say("\n[4] cancel path");
  const day = BigInt((await nowChain()) + 86400);
  await send("seller", "seller lists A again (1 day)", { to: dep.market, abi: abi.market, fn: "list", args: [id1, salePrice, day, minICR] });
  await send("buyer", "buyer cannot cancel someone else's live listing", {
    to: dep.market,
    abi: abi.market,
    fn: "cancel",
    args: [id1],
    expectRevert: "NotSeller",
  });
  await send("seller", "seller cancels the listing", { to: dep.market, abi: abi.market, fn: "cancel", args: [id1] });
  await send("buyer", "buyer cannot buy a cancelled listing", {
    to: dep.market,
    abi: abi.market,
    fn: "buy",
    args: [id1, s0, salePrice],
    expectRevert: "NotListed",
  });

  // --- 5. front run: seller changes state after the buyer looked
  say("\n[5] front-run path");
  await send("seller", "seller lists A (buyer will inspect this one)", { to: dep.market, abi: abi.market, fn: "list", args: [id1, salePrice, day, minICR] });
  const seen = (await read(dep.market, abi.market, "listings", [id1]))[4];
  await send("seller", "seller cancels, quietly", { to: dep.market, abi: abi.market, fn: "cancel", args: [id1] });
  const extra = 10n ** 14n; // 0.0001 BTC
  const stored = await read(a0.vault, abi.vault, "troveState");
  const [hu, hl] = await hints(stored[1] + extra, stored[2]);
  await send("seller", "seller adds collateral while unlisted", { to: a0.vault, abi: abi.vault, fn: "addCollateral", args: [hu, hl], value: extra });
  await send("seller", "seller relists A at the same price", { to: dep.market, abi: abi.market, fn: "list", args: [id1, salePrice, day, minICR] });
  await send("buyer", "buyer's purchase with the hash they saw is rejected", {
    to: dep.market,
    abi: abi.market,
    fn: "buy",
    args: [id1, seen, salePrice],
    expectRevert: "SnapshotMismatch",
  });
  const lowMax = salePrice - 1n;
  const fresh = (await read(dep.market, abi.market, "listings", [id1]))[4];
  await send("buyer", "buyer's purchase with a too low max price is rejected", {
    to: dep.market,
    abi: abi.market,
    fn: "buy",
    args: [id1, fresh, lowMax],
    expectRevert: "PriceTooHigh",
  });

  // --- 6. the real sale
  say("\n[6] sale");
  const sellerMusdBefore = await read(dep.musd, abi.erc20, "balanceOf", [seller.address]);
  const buyerMusdBefore = await read(dep.musd, abi.erc20, "balanceOf", [buyer.address]);
  await send("buyer", "buyer buys A with the fresh snapshot", {
    to: dep.market,
    abi: abi.market,
    fn: "buy",
    args: [id1, fresh, salePrice],
  });
  const ownerNow = await read(dep.deedNFT, abi.deed, "ownerOf", [id1]);
  if (ownerNow.toLowerCase() !== buyer.address.toLowerCase()) throw new Error("buyer does not hold Deed A");
  const owed = await read(dep.market, abi.market, "claimable", [seller.address]);
  const buyerMusdAfter = await read(dep.musd, abi.erc20, "balanceOf", [buyer.address]);
  if (owed !== salePrice || buyerMusdBefore - buyerMusdAfter !== salePrice) throw new Error("payment mismatch");
  await send("seller", "seller claims the sale proceeds", { to: dep.market, abi: abi.market, fn: "claim" });
  const sellerMusdAfter = await read(dep.musd, abi.erc20, "balanceOf", [seller.address]);
  if (sellerMusdAfter - sellerMusdBefore !== salePrice) throw new Error("seller did not receive the price");
  await send("seller", "old owner can no longer touch the vault", {
    to: a0.vault,
    abi: abi.vault,
    fn: "withdraw",
    args: [10n ** 12n, ZERO, ZERO],
    expectRevert: "NotController",
  });
  const st = await read(a0.vault, abi.vault, "troveState");
  const [bu, bl] = await hints(st[1] + 10n ** 12n, st[2]);
  await send("buyer", "new owner adds collateral to the vault", { to: a0.vault, abi: abi.vault, fn: "addCollateral", args: [bu, bl], value: 10n ** 12n });
  out.sale = {
    price: e18(salePrice),
    buyerPaid: e18(buyerMusdBefore - buyerMusdAfter),
    sellerReceived: e18(sellerMusdAfter - sellerMusdBefore),
    newOwner: ownerNow,
  };

  }

  // --- 7. rescue
  say("\n[7] rescue auction");
  const rescueICR = await read(dep.auction, abi.auction, "rescueICR");
  const safeICR = await read(dep.auction, abi.auction, "safeICR");
  const price1 = await read(dep.priceFeed, abi.feed, "fetchPrice");
  // aim for 117%: under the 120% public line, and 7 points above liquidation
  const coll2 = ((totalDebt * 1170n) / 1000n * 10n ** 18n) / price1 + 10n ** 12n;
  const id2 = RESUME ?? (await open("seller", "seller opens position B (rescue flow)", coll2, debt));
  const b = await snap(id2);
  say(`  Deed #${id2} coll ${e18(b.liveColl)} BTC debt ${e18(b.debt)} MUSD ICR ${pct(b.icr)} (rescue line ${pct(rescueICR)})`);
  if (!RESUME && b.icr >= rescueICR) throw new Error(`position B is not under the rescue line (${pct(b.icr)})`);

  // the guard reads the DEX but the price it uses comes from the oracle
  const equity = await read(dep.auction, abi.auction, "equityOf", [id2]);
  const oracleNow = await read(dep.priceFeed, abi.feed, "fetchPrice");
  const spotNow = await read(dep.spotSource, abi.spot, "spotPrice");
  const [liveCollB, liveDebtB] = await read(b.vault, abi.vault, "liveState");
  const eq = (p) => (liveCollB * p) / 10n ** 18n - (liveDebtB - 200n * 10n ** 18n);
  say(`  equityOf (contract) ${e18(equity)}  oracle-based ${e18(eq(oracleNow))}  spot-based ${e18(eq(spotNow))}`);

  if (!RESUME) {
    await send("buyer", "buyer starts the rescue auction (anyone can, ICR is under the line)", {
      to: dep.auction,
      abi: abi.auction,
      fn: "startRescue",
      args: [id2],
    });
  }
  const au = await read(dep.auction, abi.auction, "auctions", [id2]);
  say(`  start price ${e18(au[4])}  floor ${e18(au[5])}  duration ${au[3]}s`);
  if (au[5] !== (au[4] * 8000n) / 10000n) throw new Error("the floor is not 80% of the start price");
  await send("seller", "seller cannot touch the vault during the auction", {
    to: b.vault,
    abi: abi.vault,
    fn: "withdraw",
    args: [10n ** 12n, ZERO, ZERO],
    expectRevert: "NotController",
  });
  say("  letting the price fall for 45s…");
  await sleep(45);
  const quote = await read(dep.auction, abi.auction, "currentPrice", [id2]);
  const needed = await read(dep.auction, abi.auction, "requiredTopUp", [id2]);
  const topUp = needed + needed / 100n + 1n;
  say(`  price now ${e18(quote)} MUSD, required top-up ${e18(needed)} BTC (sending ${e18(topUp)})`);

  await approve("buyer", dep.musd, dep.auction, quote * 2n);
  await send("buyer", "buyer cannot win with a top-up that is too small", {
    to: dep.auction,
    abi: abi.auction,
    fn: "bid",
    args: [id2, quote, ZERO, ZERO],
    value: needed / 2n,
    expectRevert: "StillRisky",
  });
  const sellerBeforeB = await read(dep.musd, abi.erc20, "balanceOf", [seller.address]);
  const priceAtBid = await read(dep.auction, abi.auction, "currentPrice", [id2]);
  const [bu2, bl2] = await hints(b.liveColl + topUp, b.principal);
  await send("buyer", "buyer wins the auction and tops up in the same tx", {
    to: dep.auction,
    abi: abi.auction,
    fn: "bid",
    args: [id2, priceAtBid, bu2, bl2],
    value: topUp,
  });
  const after = await snap(id2);
  const owner2 = await read(dep.deedNFT, abi.deed, "ownerOf", [id2]);
  const owed2 = await read(dep.auction, abi.auction, "claimable", [seller.address]);
  say(`  new owner ${owner2}`);
  say(`  collateral ${e18(b.liveColl)} -> ${e18(after.liveColl)} BTC, debt ${e18(b.debt)} -> ${e18(after.debt)} MUSD`);
  say(`  ICR ${pct(b.icr)} -> ${pct(after.icr)} (safe line ${pct(safeICR)})`);
  if (owner2.toLowerCase() !== buyer.address.toLowerCase()) throw new Error("buyer does not hold Deed B");
  if (after.icr < safeICR) throw new Error("ICR after the auction is below the safe line");
  await send("seller", "seller claims the auction payout", { to: dep.auction, abi: abi.auction, fn: "claim" });
  const sellerAfterB = await read(dep.musd, abi.erc20, "balanceOf", [seller.address]);
  say(`  auction payout ${e18(owed2)} MUSD (seller balance +${e18(sellerAfterB - sellerBeforeB)})`);
  if (sellerAfterB - sellerBeforeB !== owed2) throw new Error("seller payout mismatch");
  out.rescue = {
    deed: id2.toString(),
    before: { collateralBTC: e18(b.liveColl), debtMUSD: e18(b.debt), icr: pct(b.icr), oraclePrice: e18(b.price) },
    after: { collateralBTC: e18(after.liveColl), debtMUSD: e18(after.debt), icr: pct(after.icr), oraclePrice: e18(after.price) },
    startPrice: e18(au[4]),
    floorPrice: e18(au[5]),
    pricePaid: e18(priceAtBid),
    topUpBTC: e18(topUp),
    sellerPayout: e18(owed2),
    equityContract: e18(equity),
    equityOracleBased: e18(eq(oracleNow)),
    equitySpotBased: e18(eq(spotNow)),
    newOwner: owner2,
  };

  out.txs = log;
  out.finishedAt = new Date().toISOString();
  fs.writeFileSync(new URL(`../docs/${RESUME ? "e2e-results-rescue" : "e2e-results"}.json`, import.meta.url), JSON.stringify(out, null, 2));
  say(`\nall steps passed, ${log.length} transactions recorded in docs/e2e-results.json`);
}

main().catch((e) => {
  out.txs = log;
  out.error = e.shortMessage ?? e.message;
  fs.writeFileSync(new URL(`../docs/${RESUME ? "e2e-results-rescue" : "e2e-results"}.partial.json`, import.meta.url), JSON.stringify(out, null, 2));
  console.error("\nFAILED:", out.error);
  process.exit(1);
});
