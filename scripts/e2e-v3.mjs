// Live end to end run of the v3 contracts on Mezo testnet.
// node --env-file=<env file with PRIVATE_KEY, SELLER_KEY, BUYER_KEY, MEZO_TESTNET_RPC> scripts/e2e-v3.mjs
// PRIVATE_KEY is the treasury wallet (it receives the fees). Keys are never printed or written anywhere.
// STEPS=borrow,sale,rescue,claim limits the run, default is all of them, in that order.
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

const here = (p) => new URL(p, import.meta.url);
const dep = JSON.parse(fs.readFileSync(here("../deployments.json")));
const v3 = dep; // the top level of deployments.json is the current (v3) deployment
for (const k of ["deedNFT", "factory", "market", "auction", "lens", "spotSource", "treasury"]) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(v3[k] ?? "")) throw new Error(`deployments.json has no address for "${k}"`);
}
const sys = dep;
const jsonAbi = (n) => JSON.parse(fs.readFileSync(here(`../abis/${n}.json`)));
const RPC = process.env.MEZO_TESTNET_RPC;
const key = (k) => (k.startsWith("0x") ? k : `0x${k}`);
const chain = {
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};
const transport = http(RPC, { retryCount: 6, retryDelay: 2000 });
const pub = createPublicClient({ chain, transport });
const accounts = {
  seller: privateKeyToAccount(key(process.env.SELLER_KEY)),
  buyer: privateKeyToAccount(key(process.env.BUYER_KEY)),
  treasury: privateKeyToAccount(key(process.env.PRIVATE_KEY)),
};
const wallets = Object.fromEntries(Object.entries(accounts).map(([n, a]) => [n, createWalletClient({ account: a, chain, transport })]));
if (accounts.treasury.address.toLowerCase() !== v3.treasury.toLowerCase()) throw new Error("PRIVATE_KEY is not the deployed treasury");

const abi = {
  deed: jsonAbi("DeedNFT"),
  factory: jsonAbi("DeedFactory"),
  vault: jsonAbi("PositionVault"),
  market: jsonAbi("DeedMarket"),
  auction: jsonAbi("RescueAuction"),
  lens: jsonAbi("DeedLens"),
  erc20: parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function transfer(address,uint256) returns (bool)",
  ]),
  tm: parseAbi([
    "function getCurrentICR(address,uint256) view returns (uint256)",
    "function getTroveStatus(address) view returns (uint8)",
    "function getTroveDebt(address) view returns (uint256)",
    "function redeemCollateral(uint256 amount,address firstHint,address upperHint,address lowerHint,uint256 partialNICR,uint256 maxIterations)",
  ]),
  feed: parseAbi(["function fetchPrice() view returns (uint256)"]),
  spot: parseAbi(["function spotPrice() view returns (uint256)"]),
  hh: parseAbi([
    "function getApproxHint(uint256,uint256,uint256) view returns (address,uint256,uint256)",
    "function computeNominalCR(uint256,uint256) pure returns (uint256)",
    "function getRedemptionHints(uint256 amount,uint256 price,uint256 maxIterations) view returns (address firstRedemptionHint,uint256 partialRedemptionHintNICR,uint256 truncatedAmount)",
  ]),
  sorted: parseAbi([
    "function findInsertPosition(uint256,address,address) view returns (address,address)",
    "function getSize() view returns (uint256)",
  ]),
};
const allErrors = [...abi.deed, ...abi.vault, ...abi.market, ...abi.auction, ...abi.lens].filter((x) => x.type === "error");

const ZERO = "0x0000000000000000000000000000000000000000";
const STEPS = (process.env.STEPS ?? "borrow,sale,rescue,claim").split(",");
const log = [];
const e18 = (v) => formatUnits(v, 18);
const say = (...a) => console.log(...a);
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const pct = (v) => `${(Number(formatUnits(v, 18)) * 100).toFixed(2)}%`;
const eq = (a, b, what) => {
  if (a !== b) throw new Error(`${what}: ${a} != ${b}`);
};
const nowChain = async () => Number((await pub.getBlock()).timestamp);

async function reasonOf(tx, receipt) {
  try {
    await pub.call({ account: tx.account, to: tx.to, data: tx.data, value: tx.value, blockNumber: receipt.blockNumber - 1n });
    return "no revert on replay";
  } catch (e) {
    const data = e?.data ?? e?.cause?.data ?? e?.cause?.cause?.data;
    if (typeof data === "string" && data.startsWith("0x")) {
      try {
        return decodeErrorResult({ abi: allErrors, data }).errorName;
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
    hash = await w.sendTransaction({ to, data, value, gas: 900000n });
  } else {
    // the Mezo RPC sometimes answers eth_estimateGas with just the 21k intrinsic cost (see estimate-probe.mjs)
    let best = 0n;
    for (let i = 0; i < 3; i++) {
      try {
        const g = await pub.estimateGas({ account: w.account, to, data, value });
        if (g > best) best = g;
      } catch (e) {
        if (i === 0) throw e;
      }
    }
    const gas = (best * 13n) / 10n > 900000n ? (best * 13n) / 10n : 900000n;
    hash = await w.sendTransaction({ to, data, value, gas });
  }
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 240_000 });
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

const read = (address, a, functionName, args = []) => pub.readContract({ address, abi: a, functionName, args });
const musdOf = (addr) => read(sys.musd, abi.erc20, "balanceOf", [addr]);

async function hints(coll, principal) {
  try {
    const nicr = await read(sys.hintHelpers, abi.hh, "computeNominalCR", [coll, principal]);
    const size = await read(sys.sortedTroves, abi.sorted, "getSize");
    const trials = BigInt(Math.max(15, Math.ceil(15 * Math.sqrt(Number(size)))));
    const [hint] = await read(sys.hintHelpers, abi.hh, "getApproxHint", [nicr, trials, 42n]);
    const [upper, lower] = await read(sys.sortedTroves, abi.sorted, "findInsertPosition", [nicr, hint, hint]);
    return [upper, lower];
  } catch {
    return [ZERO, ZERO];
  }
}

/** the two wallets share test funds: top up one from the other when it is short, so a run needs no manual steps */
const other = { seller: "buyer", buyer: "seller" };
async function ensureMusd(who, amount) {
  const have = await musdOf(accounts[who].address);
  if (have >= amount) return;
  await send(other[who], `${other[who]} sends ${e18(amount - have)} MUSD to ${who}`, { to: sys.musd, abi: abi.erc20, fn: "transfer", args: [accounts[who].address, amount - have] });
}
async function ensureBtc(who, amount) {
  const have = await pub.getBalance({ address: accounts[who].address });
  if (have >= amount) return;
  const hash = await wallets[other[who]].sendTransaction({ to: accounts[who].address, value: amount - have, gas: 100000n });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 240_000 });
  if (r.status !== "success") throw new Error("btc transfer failed");
  log.push({ who: other[who], label: `${other[who]} sends ${e18(amount - have)} BTC to ${who}`, hash, status: r.status, block: Number(r.blockNumber) });
  say(`  ok ${other[who]} sends ${e18(amount - have)} BTC to ${who}  ${hash}`);
}

const lensOf = (id) => read(v3.lens, abi.lens, "position", [id]);

async function approve(who, spender, amount, name) {
  const owner = accounts[who].address;
  const cur = await read(sys.musd, abi.erc20, "allowance", [owner, spender]);
  if (cur >= amount) return;
  await send(who, `${who} approves MUSD for ${name}`, { to: sys.musd, abi: abi.erc20, fn: "approve", args: [spender, amount] });
}

async function open(who, label, coll, debt) {
  const principal = debt + debt / 1000n + 200n * 10n ** 18n;
  const [u, l] = await hints(coll, principal);
  const r = await send(who, label, { to: v3.factory, abi: abi.factory, fn: "createPosition", args: [debt, u, l], value: coll });
  const ev = parseEventLogs({ abi: abi.factory, logs: r.logs, eventName: "PositionCreated" })[0];
  return { id: ev.args.tokenId, vault: ev.args.vault };
}

const collFor = (debt, price, icrPct1000) => {
  const total = debt + debt / 1000n + 200n * 10n ** 18n;
  return ((total * icrPct1000) / 1000n * 10n ** 18n) / price + 10n ** 12n;
};

// RESUME_B=<deed id> continues after a run that failed once position B was won: it reloads the partial results,
// skips steps 1 to 4 and the auction itself, and finishes the claims and the claimCollateral step
const RESUME_B = process.env.RESUME_B ? BigInt(process.env.RESUME_B) : null;
const out = { startedAt: new Date().toISOString(), wallets: Object.fromEntries(Object.entries(accounts).map(([n, a]) => [n, a.address])) };
const results = (out.results = {});
const DEBT = 1800n * 10n ** 18n;

async function main() {
  if (RESUME_B || process.env.RESUME_C) {
    const prev = JSON.parse(fs.readFileSync(here("../docs/e2e-v3-results.partial.json")));
    log.push(...prev.txs);
    Object.assign(results, prev.results);
    out.startedAt = prev.startedAt;
    out.resumedAt = new Date().toISOString();
  }
  const price0 = await read(sys.priceFeed, abi.feed, "fetchPrice");
  const spot0 = await read(v3.spotSource, abi.spot, "spotPrice");
  const [sp, stcr, srm, sstale] = await read(v3.lens, abi.lens, "system");
  const feeBpsMarket = await read(v3.market, abi.market, "feeBps");
  const feeBpsAuction = await read(v3.auction, abi.auction, "feeBps");
  say(`oracle ${e18(price0)}  twap ${e18(spot0)}  lens: price ${e18(sp)} TCR ${pct(stcr)} recoveryMode ${srm} stale ${sstale}`);
  say(`market fee ${feeBpsMarket} bps, auction fee ${feeBpsAuction} bps, treasury ${v3.treasury}`);
  results.system = { oracle: e18(price0), twap: e18(spot0), tcr: pct(stcr), recoveryMode: srm, marketFeeBps: Number(feeBpsMarket), auctionFeeBps: Number(feeBpsAuction) };
  for (const n of ["seller", "buyer", "treasury"]) say(`  ${n} ${accounts[n].address} ${e18(await pub.getBalance({ address: accounts[n].address }))} BTC ${e18(await musdOf(accounts[n].address))} MUSD`);

  // ---------- borrow, refinance, fee-bearing sale, closeTrove ----------
  if (!RESUME_B && !process.env.RESUME_C && (STEPS.includes("borrow") || STEPS.includes("sale"))) {
    say("\n[1] open position A (about 150% ICR)");
    await ensureBtc("seller", collFor(DEBT, price0, 1500n) + 5n * 10n ** 15n);
    const a = await open("seller", "seller opens position A", collFor(DEBT, price0, 1500n), DEBT);
    const A = a.id;
    const l0 = await lensOf(A);
    say(`  Deed #${A} vault ${a.vault} coll ${e18(l0.collateral)} debt ${e18(l0.debt)} ICR ${pct(l0.icr)} equity ${e18(l0.equity)}`);
    results.positionA = { deed: A.toString(), vault: a.vault, lens: { collateral: e18(l0.collateral), debt: e18(l0.debt), icr: pct(l0.icr), rate: l0.rate } };

    say("\n[2] borrow and refinance through the vault");
    await send("seller", "claimSurplus with nothing to claim reverts clearly", { to: a.vault, abi: abi.vault, fn: "claimSurplus", expectRevert: "NothingToClaim" });
    const musdBefore = await musdOf(accounts.seller.address);
    const [, , prinBefore] = await read(a.vault, abi.vault, "troveState");
    const borrowAmt = 100n * 10n ** 18n;
    const [bu, bl] = await hints(l0.collateral, prinBefore + borrowAmt);
    await send("seller", "seller borrows 100 MUSD more through the vault", { to: a.vault, abi: abi.vault, fn: "borrow", args: [borrowAmt, bu, bl] });
    const [, , prinAfter] = await read(a.vault, abi.vault, "troveState");
    eq((await musdOf(accounts.seller.address)) - musdBefore, borrowAmt, "borrowed MUSD reached the holder");
    eq(await musdOf(a.vault), 0n, "vault holds no MUSD");
    say(`  principal ${e18(prinBefore)} -> ${e18(prinAfter)} (100 borrowed + fee ${e18(prinAfter - prinBefore - borrowAmt)})`);

    const [, , prinR0, rateR0] = await read(a.vault, abi.vault, "troveState");
    const [ru, rl] = await hints(l0.collateral, prinR0);
    await send("seller", "seller refinances to the current system rate", { to: a.vault, abi: abi.vault, fn: "refinance", args: [ru, rl] });
    const [, , prinR1, rateR1] = await read(a.vault, abi.vault, "troveState");
    say(`  rate ${rateR0} -> ${rateR1} bps, principal ${e18(prinR0)} -> ${e18(prinR1)} (refinancing fee ${e18(prinR1 - prinR0)})`);
    if (prinR1 <= prinR0) throw new Error("refinance charged no fee");
    results.borrowRefinance = {
      borrowed: e18(borrowAmt),
      borrowFee: e18(prinAfter - prinBefore - borrowAmt),
      rateBefore: rateR0,
      rateAfter: rateR1,
      refinanceFee: e18(prinR1 - prinR0),
    };

    say("\n[3] fee-bearing sale");
    const price = 100n * 10n ** 18n;
    const minICR = 13n * 10n ** 17n;
    const day = BigInt((await nowChain()) + 86400);
    await send("seller", "seller lists A for 100 MUSD", { to: v3.market, abi: abi.market, fn: "list", args: [A, price, day, minICR] });
    await send("seller", "seller cannot borrow against a listed vault", { to: a.vault, abi: abi.vault, fn: "borrow", args: [10n ** 18n, ZERO, ZERO], expectRevert: "NotController" });
    await send("seller", "seller cannot refinance a listed vault", { to: a.vault, abi: abi.vault, fn: "refinance", args: [ZERO, ZERO], expectRevert: "NotController" });
    const snap = (await read(v3.market, abi.market, "listings", [A]))[4];
    await approve("buyer", v3.market, price, "market");
    const fee = await read(v3.market, abi.market, "feeFor", [price]);
    const sBefore = await musdOf(accounts.seller.address);
    const tBefore = await musdOf(accounts.treasury.address);
    const bBefore = await musdOf(accounts.buyer.address);
    await send("buyer", "buyer buys A", { to: v3.market, abi: abi.market, fn: "buy", args: [A, snap, price] });
    eq((await read(v3.deedNFT, abi.deed, "ownerOf", [A])).toLowerCase(), accounts.buyer.address.toLowerCase(), "buyer holds A");
    eq(await read(v3.market, abi.market, "claimable", [accounts.seller.address]), price - fee, "seller owed price - fee");
    eq(await read(v3.market, abi.market, "claimable", [accounts.treasury.address]), fee, "treasury owed the fee");
    eq(bBefore - (await musdOf(accounts.buyer.address)), price, "buyer paid the price");
    await send("seller", "seller claims price minus fee", { to: v3.market, abi: abi.market, fn: "claim" });
    await send("treasury", "treasury claims the fee", { to: v3.market, abi: abi.market, fn: "claim" });
    eq((await musdOf(accounts.seller.address)) - sBefore, price - fee, "seller received price - fee");
    eq((await musdOf(accounts.treasury.address)) - tBefore, fee, "treasury received the fee");
    eq(await musdOf(v3.market), 0n, "market holds nothing after both claims");
    say(`  price ${e18(price)} = seller ${e18(price - fee)} + fee ${e18(fee)}; market balance 0`);
    results.sale = { price: e18(price), fee: e18(fee), sellerReceived: e18(price - fee), feeBps: Number(feeBpsMarket) };

    say("\n[4] closeTrove through the vault (new owner closes A)");
    const lc = await lensOf(A);
    const needed = lc.debt - 200n * 10n ** 18n;
    say(`  entire debt ${e18(lc.debt)}, MUSD to pay ${e18(needed)}`);
    await ensureMusd("buyer", needed + 10n ** 18n);
    await approve("buyer", a.vault, needed + 10n ** 18n, "the vault");
    const btcBefore = await pub.getBalance({ address: accounts.buyer.address });
    const mBefore = await musdOf(accounts.buyer.address);
    const r = await send("buyer", "buyer closes the trove through the vault", { to: a.vault, abi: abi.vault, fn: "close" });
    eq(await read(sys.troveManager, abi.tm, "getTroveStatus", [a.vault]), 2, "trove closed by owner");
    const spent = mBefore - (await musdOf(accounts.buyer.address));
    say(`  MUSD paid ${e18(spent)} (needed at least ${e18(needed)}), vault MUSD ${e18(await musdOf(a.vault))}, vault BTC ${e18(await pub.getBalance({ address: a.vault }))}`);
    if (spent < needed) throw new Error("close paid less than the debt");
    eq(await musdOf(a.vault), 0n, "vault swept");
    const gasCost = r.gasUsed * r.effectiveGasPrice;
    results.close = { musdPaid: e18(spent), btcReturned: e18((await pub.getBalance({ address: accounts.buyer.address })) - btcBefore + gasCost), status: 2 };
  }

  // ---------- rescue ----------
  if (STEPS.includes("rescue") && !process.env.RESUME_C) {
    say("\n[5] rescue auction with the time weighted price guard");
    let B, b, lb, equity, oracleNow, twapNow, priceAtBid, feePaid, la;
    if (!RESUME_B) {
      const price1 = await read(sys.priceFeed, abi.feed, "fetchPrice");
      await ensureBtc("seller", collFor(DEBT, price1, 1170n) + 5n * 10n ** 15n);
      b = await open("seller", "seller opens position B (about 117%)", collFor(DEBT, price1, 1170n), DEBT);
      B = b.id;
      lb = await lensOf(B);
      say(`  Deed #${B} coll ${e18(lb.collateral)} debt ${e18(lb.debt)} ICR ${pct(lb.icr)} (rescue line ${pct(await read(v3.auction, abi.auction, "rescueICR"))})`);
      oracleNow = await read(sys.priceFeed, abi.feed, "fetchPrice");
      twapNow = await read(v3.spotSource, abi.spot, "spotPrice");
      equity = await read(v3.auction, abi.auction, "equityOf", [B]);
      say(`  oracle ${e18(oracleNow)}  twap ${e18(twapNow)}  deviation ${(Math.abs(Number(twapNow - oracleNow)) / Number(oracleNow) * 100).toFixed(2)}%  equityOf ${e18(equity)}`);
      await send("buyer", "buyer starts the rescue (ICR is under the line)", { to: v3.auction, abi: abi.auction, fn: "startRescue", args: [B] });
      const au = await read(v3.auction, abi.auction, "auctions", [B]);
      say(`  start ${e18(au[4])} floor ${e18(au[5])} duration ${au[3]}s`);
      await send("seller", "seller cannot borrow against an auctioned vault", { to: b.vault, abi: abi.vault, fn: "borrow", args: [10n ** 18n, ZERO, ZERO], expectRevert: "NotController" });
      await sleep(30);
      const quote = await read(v3.auction, abi.auction, "currentPrice", [B]);
      const need = await read(v3.auction, abi.auction, "requiredTopUp", [B]);
      const topUp = need + need / 100n + 1n;
      await approve("buyer", v3.auction, quote * 2n, "auction");
      priceAtBid = await read(v3.auction, abi.auction, "currentPrice", [B]);
      const [u2, l2] = await hints(lb.collateral + topUp, lb.principal);
      const r = await send("buyer", "buyer wins the auction and tops up in the same tx", { to: v3.auction, abi: abi.auction, fn: "bid", args: [B, priceAtBid, u2, l2], value: topUp });
      const won = parseEventLogs({ abi: abi.auction, logs: r.logs, eventName: "Won" })[0].args;
      priceAtBid = won.price;
      feePaid = won.fee;
      results.rescueTopUpBTC = e18(topUp);
    } else {
      B = RESUME_B;
      b = { vault: await read(v3.factory, abi.factory, "vaultOf", [B]) };
      const evs = await pub.getContractEvents({ address: v3.auction, abi: abi.auction, eventName: "Won", args: { tokenId: B }, fromBlock: BigInt(dep.deployBlock), toBlock: "latest" });
      const won = evs[evs.length - 1].args;
      priceAtBid = won.price;
      feePaid = won.fee;
      // readings the first run printed just before it failed on a script bug (see docs/demo.md)
      lb = { icr: "116.98%", collateral: 32748807974404764n, debt: 2001800000000000000000n };
      oracleNow = 71502512960000000000000n;
      twapNow = 78477188117572139227190n;
      equity = 539756211464020064403n;
      say(`  resuming after the bid on Deed #${B}: price paid ${e18(priceAtBid)}, fee ${e18(feePaid)}`);
    }
    la = await lensOf(B);
    eq(la.holder.toLowerCase(), accounts.buyer.address.toLowerCase(), "buyer holds B");
    const owedSeller = await read(v3.auction, abi.auction, "claimable", [accounts.seller.address]);
    const owedTreasury = await read(v3.auction, abi.auction, "claimable", [accounts.treasury.address]);
    eq(owedSeller + owedTreasury, priceAtBid, "fee + proceeds == price paid");
    eq(owedTreasury, feePaid, "treasury is owed the fee from the event");
    eq(owedTreasury, (priceAtBid * feeBpsAuction) / 10000n, "fee is feeBps of the price");
    const sBefore = await musdOf(accounts.seller.address);
    const tBefore = await musdOf(accounts.treasury.address);
    await send("seller", "seller claims the auction payout", { to: v3.auction, abi: abi.auction, fn: "claim" });
    await send("treasury", "treasury claims the auction fee", { to: v3.auction, abi: abi.auction, fn: "claim" });
    eq((await musdOf(accounts.seller.address)) - sBefore, owedSeller, "seller received proceeds");
    eq((await musdOf(accounts.treasury.address)) - tBefore, owedTreasury, "treasury received fee");
    eq(await musdOf(v3.auction), 0n, "auction holds nothing after both claims");
    say(`  price paid ${e18(priceAtBid)} = seller ${e18(owedSeller)} + fee ${e18(owedTreasury)}; auction balance 0; ICR now ${pct(la.icr)}`);
    results.rescueBefore ??= lb && { collateral: e18(lb.collateral), debt: e18(lb.debt), icr: pct(lb.icr) };
    results.rescue = {
      deed: B.toString(),
      icrBefore: lb?.icr !== undefined && typeof lb.icr === "bigint" ? pct(lb.icr) : lb?.icr,
      icrAfter: pct(la.icr),
      pricePaid: e18(priceAtBid),
      fee: e18(owedTreasury),
      sellerPayout: e18(owedSeller),
      oracle: oracleNow ? e18(oracleNow) : results.rescue?.oracle,
      twap: twapNow ? e18(twapNow) : results.rescue?.twap,
      equityOf: equity ? e18(equity) : results.rescue?.equityOf,
    };
    // recover the collateral: the winner closes the position
    const need2 = la.debt - 200n * 10n ** 18n;
    await ensureMusd("buyer", need2 + 10n ** 18n);
    await approve("buyer", b.vault, need2 + 10n ** 18n, "the vault");
    await send("buyer", "winner closes position B through the vault", { to: b.vault, abi: abi.vault, fn: "close" });
  }

  // ---------- claimCollateral after a redemption closes the trove ----------
  if (STEPS.includes("claim")) {
    say("\n[6] claimCollateral: a redemption closes a trove, the vault claims the surplus");
    const p = await read(sys.priceFeed, abi.feed, "fetchPrice");
    // RESUME_C=<deed id> picks up a position C that an earlier run already opened
    let c;
    let openBlock = 0n;
    if (process.env.RESUME_C) {
      const id = BigInt(process.env.RESUME_C);
      c = { id, vault: await read(v3.factory, abi.factory, "vaultOf", [id]) };
      openBlock = BigInt(process.env.RESUME_C_BLOCK ?? 0);
    } else {
      // as low an ICR as safe, so a redemption reaches this trove before any other
      await ensureBtc("seller", collFor(DEBT, p, 1110n) + 5n * 10n ** 15n);
      c = await open("seller", "seller opens position C (about 111%)", collFor(DEBT, p, 1110n), DEBT);
      openBlock = BigInt(log[log.length - 1].block);
    }
    const lcc = await lensOf(c.id);
    say(`  Deed #${c.id} vault ${c.vault} status ${lcc.status} coll ${e18(lcc.collateral)} debt ${e18(lcc.debt)} ICR ${pct(lcc.icr)}`);
    let redeemedBy = "a third party before this script could";
    const statusOf = () => read(sys.troveManager, abi.tm, "getTroveStatus", [c.vault]);
    if ((await statusOf()) !== 4) {
      const net = (await read(sys.troveManager, abi.tm, "getTroveDebt", [c.vault])) - 200n * 10n ** 18n;
      const amount = net + 2n * 10n ** 18n; // interest keeps accruing, and the surplus stays with the redeemer
      const [first] = await read(sys.hintHelpers, abi.hh, "getRedemptionHints", [amount, p, 0n]);
      say(`  first redemption hint ${first}`);
      if (first.toLowerCase() === c.vault.toLowerCase()) {
        try {
          await ensureMusd("buyer", amount);
          await send("buyer", "buyer redeems exactly this trove's net debt", { to: sys.troveManager, abi: abi.tm, fn: "redeemCollateral", args: [amount, c.vault, ZERO, ZERO, 0n, 1n] });
          redeemedBy = "the buyer wallet, in this script";
        } catch (e) {
          if ((await statusOf()) !== 4) throw e;
          say("  the trove was redeemed by someone else while this script was preparing its own redemption");
        }
      }
    }
    eq(await statusOf(), 4, "trove closed by redemption");
    // who redeemed it, from the TroveManager's own log for this vault
    const topic = "0x" + "0".repeat(24) + c.vault.slice(2).toLowerCase();
    const logs = await pub.request({ method: "eth_getLogs", params: [{ address: sys.troveManager, fromBlock: `0x${openBlock.toString(16)}`, toBlock: "latest", topics: [null, topic] }] });
    const redeemLog = logs.find((l) => !log.some((e) => e.hash === l.transactionHash));
    const redeemTx = redeemedBy.startsWith("the buyer") ? log[log.length - 1].hash : redeemLog?.transactionHash;
    if (redeemedBy.startsWith("a third")) {
      const rtx = redeemTx ? await pub.getTransaction({ hash: redeemTx }) : null;
      say(`  redemption tx ${redeemTx} sent by ${rtx?.from}`);
      log.push({ who: "third party", label: "a third party redeems this trove completely", hash: redeemTx, status: "success", block: redeemLog ? Number(BigInt(redeemLog.blockNumber)) : null, from: rtx?.from });
    }
    const lz = await lensOf(c.id);
    say(`  status ${lz.status}, surplus waiting ${e18(lz.surplus)} BTC (lens)`);
    if (lz.surplus === 0n) throw new Error("no surplus after the redemption");
    eq(lz.surplus, await read(c.vault, abi.vault, "surplus"), "lens and vault agree on the surplus");
    await send("buyer", "a stranger cannot claim the vault's surplus", { to: c.vault, abi: abi.vault, fn: "claimSurplus", expectRevert: "NotController" });
    const sBtc0 = await pub.getBalance({ address: accounts.seller.address });
    const r = await send("seller", "seller claims the surplus through the vault (claimCollateral)", { to: c.vault, abi: abi.vault, fn: "claimSurplus" });
    const sBtc1 = await pub.getBalance({ address: accounts.seller.address });
    eq(sBtc1 - sBtc0 + r.gasUsed * r.effectiveGasPrice, lz.surplus, "holder received exactly the surplus");
    eq(await pub.getBalance({ address: c.vault }), 0n, "vault holds no BTC");
    eq(await read(c.vault, abi.vault, "surplus"), 0n, "no surplus left");
    await send("seller", "a second claim reverts clearly", { to: c.vault, abi: abi.vault, fn: "claimSurplus", expectRevert: "NothingToClaim" });
    results.claim = { deed: c.id.toString(), status: lz.status, surplusBTC: e18(lz.surplus), redeemedBy, redemptionTx: redeemTx };
  }

  out.txs = log;
  out.finishedAt = new Date().toISOString();
  fs.writeFileSync(here("../docs/e2e-v3-results.json"), JSON.stringify(out, null, 2));
  say(`\nall steps passed, ${log.length} transactions recorded in docs/e2e-v3-results.json`);
}

main().catch((e) => {
  out.txs = log;
  out.error = e.shortMessage ?? e.message;
  fs.writeFileSync(here("../docs/e2e-v3-results.partial.json"), JSON.stringify(out, null, 2));
  console.error("\nFAILED:", out.error);
  process.exit(1);
});
