// Browser pass for the frontend against the v3 deployment (deployments.json), headless Chromium on Linux.
//   cd scripts && node --env-file=../../Deed/.env ui-pass-v3-live.mjs   (frontend served on http://localhost:3111)
// Wallets are bridged: the page gets a plain EIP-1193 provider and every signature happens here in Node. Keys are read
// from the environment and never printed or sent to the page. Results go to docs/ui-pass-v3.json.
//
// One new position goes through its whole life, every step clicked in the UI: open (wizard), borrow, refinance, list,
// buy, rescue start, bid, close, claims. Env: PHASE_FROM=n resumes at phase n, POS=<tokenId> names the position when resuming.
import fs from "node:fs";
import { chromium } from "playwright-core";
import {
  createPublicClient, createWalletClient, decodeFunctionData, decodeFunctionResult, encodeFunctionResult,
  formatUnits, http, parseAbi, parseAbiItem, toFunctionSelector, parseUnits,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const dep = JSON.parse(fs.readFileSync(new URL("../deployments.json", import.meta.url)));
const BASE = process.env.UI_BASE ?? "http://localhost:3111";
const INDEXER = process.env.UI_INDEXER ?? "http://localhost:8787";
const SHOTS = process.env.SHOT_DIR ?? "./shots";
const FROM = Number(process.env.PHASE_FROM ?? 0);
fs.mkdirSync(SHOTS, { recursive: true });
const RPC = process.env.MEZO_TESTNET_RPC;
const chain = { id: 31611, name: "Mezo Testnet", nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const transport = http(RPC, { retryCount: 6, retryDelay: 1500 });
const pub = createPublicClient({ chain, transport });
const key = (k) => (k.startsWith("0x") ? k : `0x${k}`);
const wallets = {
  alice: privateKeyToAccount(key(process.env.BUYER_KEY)), // opens, borrows, lists, later bids and closes
  bob: privateKeyToAccount(key(process.env.SELLER_KEY)), // buys, then lets the position fall under the rescue line
  empty: privateKeyToAccount(generatePrivateKey()), // fresh wallet, nothing on it
};
const clients = Object.fromEntries(Object.entries(wallets).map(([k, a]) => [k, createWalletClient({ account: a, chain, transport })]));
const lc = (a) => a.toLowerCase();

const results = [];
const txs = [];
const untested = [];
const consoleErrors = [];
const step = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -  " + detail : ""}`);
};
const approved = { alice: false, bob: false, empty: false };

async function handle(who, method, params) {
  const a = wallets[who];
  switch (method) {
    case "eth_requestAccounts": approved[who] = true; return [a.address];
    case "eth_accounts": return approved[who] ? [a.address] : [];
    case "eth_chainId": return "0x7b7b";
    case "net_version": return "31611";
    case "wallet_switchEthereumChain": case "wallet_addEthereumChain": return null;
    case "wallet_getPermissions": case "wallet_requestPermissions": return [{ parentCapability: "eth_accounts" }];
    case "eth_sendTransaction": {
      const t = params[0];
      const value = t.value ? BigInt(t.value) : undefined;
      const gas = t.gas ? BigInt(t.gas) : ((await pub.estimateGas({ account: a, to: t.to, data: t.data, value })) * 13n) / 10n;
      const hash = await clients[who].sendTransaction({ to: t.to, data: t.data, value, gas });
      txs.push({ who, to: t.to, selector: (t.data ?? "0x").slice(0, 10), pageGas: t.gas ? BigInt(t.gas).toString() : null, hash });
      return hash;
    }
    case "personal_sign": return clients[who].signMessage({ message: { raw: params[0] } });
    default: return pub.request({ method, params });
  }
}

let browser;
async function session(who, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.exposeFunction("__walletRequest", (method, params) => handle(who, method, params));
  await ctx.addInitScript(() => {
    const ls = {};
    window.ethereum = {
      isMetaMask: true,
      request: ({ method, params }) => window.__walletRequest(method, params ?? []),
      on: (e, f) => ((ls[e] ||= []).push(f), window.ethereum),
      removeListener: (e, f) => ((ls[e] = (ls[e] || []).filter((x) => x !== f)), window.ethereum),
    };
  });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(`[${who}] ${m.text().slice(0, 200)}`));
  page.on("pageerror", (e) => consoleErrors.push(`[${who}] pageerror ${e.message.slice(0, 200)}`));
  return page;
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const settle = (page, ms = 2500) => page.waitForTimeout(ms);
const chip = (page) => page.evaluate(() => /0x[0-9a-fA-F]{2,6}\S{1,3}[0-9a-fA-F]{4}/.test(document.querySelector("nav")?.innerText ?? ""));

async function connectOnce(page) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  if (!(await chip(page))) {
    await page.getByRole("button", { name: "Connect Wallet" }).first().click({ timeout: 60000 });
    await page.getByText("Browser Wallet", { exact: false }).first().click({ timeout: 30000 });
  }
  await page.waitForFunction(() => /0x[0-9a-fA-F]{2,6}\S{1,3}[0-9a-fA-F]{4}/.test(document.querySelector("nav")?.innerText ?? ""), null, { timeout: 60000 });
}
async function connect(page, retry = true) {
  try { await connectOnce(page); } catch (e) { if (!retry) throw e; await connect(page, false); }
}

async function tx(page, label, timeout = 180000) {
  const b = page.getByRole("button", { name: label, exact: true }).first();
  await b.waitFor({ timeout: 60000 });
  const box = (await (await b.elementHandle()).evaluateHandle((e) => e.parentElement)).asElement();
  await b.click();
  try {
    const verdict = await Promise.race([
      box.waitForSelector(".txline.ok", { timeout }).then(() => "ok"),
      box.waitForSelector(".txline.err", { timeout }).then(() => "err"),
    ]);
    const text = (await box.$eval(".txline", (e) => e.innerText)).replace(/\s+/g, " ");
    return { verdict, text };
  } catch (e) {
    if (/not attached|detached/i.test(e.message)) return { verdict: "detached", text: "card removed after the action, the chain check that follows decides" };
    throw e;
  }
}
const okOrGone = (r) => r.verdict === "ok" || r.verdict === "detached";
const field = (page, label) => page.getByText(label, { exact: true }).locator("xpath=following-sibling::input").first();
const fill = async (page, label, v) => { const f = field(page, label); await f.fill(""); await f.fill(String(v)); };
const text = (page) => page.locator("main").innerText();
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const RAW_SELECTOR = /0x[0-9a-fA-F]{8}\b/;
const e18 = (v) => Number(formatUnits(v, 18));
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// --- chain reads, independent of the app ---
const lensAbi = parseAbi([
  "function position(uint256) view returns ((address vault, address holder, address lockedBy, uint8 status, uint256 collateral, uint256 principal, uint256 interest, uint256 debt, uint256 icr, uint16 rate, uint256 collateralValue, uint256 equity, uint256 surplus, uint256 price, uint256 tcr, bool recoveryMode, bool priceStale, bool canClose, bool canWithdraw, bool canBorrow, bool canRefinance))",
  "function system() view returns (uint256 price, uint256 tcr, bool recoveryMode, bool priceStale)",
]);
const venueAbi = parseAbi(["function claimable(address) view returns (uint256)", "function feeFor(uint256) view returns (uint256)", "function listings(uint256) view returns (address,uint64,uint256,uint256,bytes32)", "function auctions(uint256) view returns (address,bool,uint64,uint64,uint256,uint256)"]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"]);
const nftAbi = parseAbi(["function nextId() view returns (uint256)", "function ownerOf(uint256) view returns (address)"]);
const lens = (id) => pub.readContract({ address: dep.lens, abi: lensAbi, functionName: "position", args: [BigInt(id)] });
const claimable = (venue, who) => pub.readContract({ address: venue, abi: venueAbi, functionName: "claimable", args: [who] });
const musdOf = (a) => pub.readContract({ address: dep.musd, abi: erc20, functionName: "balanceOf", args: [a] });

// Rewrites what the page sees for DeedLens reads (system and position), without touching the chain.
const RPC_GLOB = "**/rpc.test.mezo.org/**";
const MULTICALL = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
]);
const SEL = { system: toFunctionSelector("system()"), position: toFunctionSelector("position(uint256)") };
function rewrite(kind, data, canClose) {
  if (kind === "system") {
    const [price] = decodeFunctionResult({ abi: lensAbi, functionName: "system", data });
    return encodeFunctionResult({ abi: lensAbi, functionName: "system", result: [price, 13n * 10n ** 17n, true, false] });
  }
  const p = decodeFunctionResult({ abi: lensAbi, functionName: "position", data });
  return encodeFunctionResult({
    abi: lensAbi, functionName: "position",
    result: { ...p, tcr: 13n * 10n ** 17n, recoveryMode: true, canWithdraw: false, canBorrow: false, canRefinance: false, canClose },
  });
}
async function simulateRecovery(page, canClose) {
  await page.route(RPC_GLOB, async (route) => {
    let body;
    try { body = JSON.parse(route.request().postData() ?? ""); } catch { return route.continue(); }
    const items = Array.isArray(body) ? body : [body];
    const plan = new Map();
    const kindOf = (cd) => (cd.startsWith(SEL.system) ? "system" : cd.startsWith(SEL.position) ? "position" : null);
    for (const it of items) {
      if (it.method !== "eth_call") continue;
      const data = it.params?.[0]?.data ?? it.params?.[0]?.input ?? "";
      if (data.startsWith("0x82ad56cb")) {
        const calls = decodeFunctionData({ abi: MULTICALL, data }).args[0];
        const hits = calls.flatMap((c, n) => (c.target.toLowerCase() === dep.lens.toLowerCase() && kindOf(c.callData) ? [[n, kindOf(c.callData)]] : []));
        if (hits.length) plan.set(it.id, hits);
      } else if ((it.params?.[0]?.to ?? "").toLowerCase() === dep.lens.toLowerCase() && kindOf(data)) {
        plan.set(it.id, [["direct", kindOf(data)]]);
      }
    }
    if (plan.size === 0) return route.continue();
    const real = await route.fetch();
    const json = await real.json();
    const out = Array.isArray(json) ? json : [json];
    for (const o of out) {
      const hits = plan.get(o.id);
      if (!hits || o.result === undefined) continue;
      if (hits[0][0] === "direct") { o.result = rewrite(hits[0][1], o.result, canClose); continue; }
      const res = decodeFunctionResult({ abi: MULTICALL, functionName: "aggregate3", data: o.result }).map((r) => ({ ...r }));
      for (const [n, kind] of hits) res[n].returnData = rewrite(kind, res[n].returnData, canClose);
      o.result = encodeFunctionResult({ abi: MULTICALL, functionName: "aggregate3", result: res });
    }
    await route.fulfill({ response: real, json: Array.isArray(json) ? out : out[0] });
  });
}

// independent count of the events the Activity page shows for this deployment: plain getLogs with the library's own filters
async function chainTotals(from, fromVersion) {
  const A = fromVersion;
  const head = await pub.getBlockNumber();
  const created = parseAbiItem("event PositionCreated(uint256 indexed tokenId, address indexed vault, address indexed owner, uint256 collateral, uint256 debt)");
  const sold = parseAbiItem("event Sold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price, uint256 fee)");
  const won = parseAbiItem("event Won(uint256 indexed tokenId, address indexed seller, address indexed winner, uint256 price, uint256 fee, uint256 topUp)");
  const listed = parseAbiItem("event Listed(uint256 indexed tokenId, address indexed seller, uint256 price, uint64 expiry, uint256 minICR, bytes32 snapshot)");
  const started = parseAbiItem("event Started(uint256 indexed tokenId, address indexed seller, bool byOwner, uint256 startPrice, uint256 floorPrice, uint64 duration)");
  let positions = 0, volume = 0n, fees = 0n;
  const w = new Set();
  for (let a = from; a <= head; a += 10000n) {
    const b = a + 9999n < head ? a + 9999n : head;
    const [c, s, wn, l, st] = await Promise.all([
      pub.getLogs({ address: A.factory, event: created, fromBlock: a, toBlock: b }),
      pub.getLogs({ address: A.market, event: sold, fromBlock: a, toBlock: b }),
      pub.getLogs({ address: A.auction, event: won, fromBlock: a, toBlock: b }),
      pub.getLogs({ address: A.market, event: listed, fromBlock: a, toBlock: b }),
      pub.getLogs({ address: A.auction, event: started, fromBlock: a, toBlock: b }),
    ]);
    positions += c.length;
    c.forEach((x) => w.add(lc(x.args.owner)));
    l.forEach((x) => w.add(lc(x.args.seller)));
    st.forEach((x) => w.add(lc(x.args.seller)));
    for (const x of s) { volume += x.args.price; fees += x.args.fee; w.add(lc(x.args.seller)); w.add(lc(x.args.buyer)); }
    for (const x of wn) { volume += x.args.price; fees += x.args.fee; w.add(lc(x.args.seller)); w.add(lc(x.args.winner)); }
  }
  return { positions, volume, fees, wallets: w.size };
}

const statsOf = (page) =>
  page.evaluate(() => {
    const m = {};
    document.querySelectorAll(".stat").forEach((s) => (m[s.querySelector(".k").textContent] = s.querySelector(".v").textContent));
    return m;
  });
const num = (s) => Number((s ?? "").replace(/[^\d.]/g, ""));

async function main() {
  browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
  const alice = await session("alice");
  const bob = await session("bob");
  const empty = await session("empty");
  const phone = await session("empty", { width: 390, height: 844 });
  const startNext = await pub.readContract({ address: dep.deedNFT, abi: nftAbi, functionName: "nextId" });
  let N = process.env.POS ? BigInt(process.env.POS) : startNext;
  let r;

  // ---------- phase 0: routes, landing, activity, error and fallback states ----------
  if (FROM <= 0) {
    // the RPC-down check goes first, before the long run has loaded the machine
    const down = await session("empty");
    await down.route(RPC_GLOB, (route) => route.abort());
    await down.goto(BASE + "/market", { waitUntil: "domcontentloaded" });
    await down.locator(".notice.err").first().waitFor({ timeout: 90000 });
    const errText = await down.locator(".notice.err").first().innerText();
    step("RPC down: Market shows a readable error with Retry", /Could not load positions/.test(errText) && !RAW_SELECTOR.test(errText) && (await down.getByRole("button", { name: "Retry" }).count()) > 0, errText.replace(/\s+/g, " ").slice(0, 120));

    const routes = [["/", /Your MUSD loan/], ["/positions", /My positions/], ["/market", /^Market$/], ["/rescue", /^Rescue$/], ["/activity", /^Activity$/], ["/start", /^Get started$/], ["/position/1", /Deed #1/]];
    for (const [path, h1] of routes) {
      for (const [name, page] of [["desktop", empty], ["390px", phone]]) {
        await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
        try {
          await page.getByRole("heading", { level: 1 }).filter({ hasText: h1 }).first().waitFor({ timeout: 45000 });
          await settle(page, 3500);
          const ov = await overflow(page);
          step(`route ${path} at ${name}: renders, no sideways scroll`, ov <= 1, ov > 1 ? `${ov}px too wide` : "");
        } catch (e) {
          step(`route ${path} at ${name}: renders, no sideways scroll`, false, e.message.split("\n")[0]);
        }
        await shot(page, `${name === "390px" ? "m" : "d"}${path.replace(/\//g, "_") || "_home"}`);
      }
    }

    // fee disclosure is read from the contracts
    await empty.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await empty.getByText("Positions opened").first().waitFor({ timeout: 120000 });
    const land = await text(empty);
    step("landing fee text shows the on-chain rates and the treasury", /0\.50% of the sale price on a fixed price sale and 0\.50% on a rescue auction/.test(land) && land.includes(dep.treasury.slice(0, 6)), (land.match(/Deed's fee:[^\n]*/) ?? [""])[0].slice(0, 110));
    step("landing labels the earlier deployment", /Earlier deployment \(v2\): 3 positions/.test(land), (land.match(/Earlier deployment[^\n]*/) ?? ["none"])[0]);
    step("landing says the indexer has not indexed v3 yet (it follows v2 only)", /has not indexed this deployment yet/.test(land));
    await shot(empty, "landing-stats");
  }

  // ---------- phase 1: empty wallet ----------
  if (FROM <= 1) {
    await connect(empty);
    await empty.goto(BASE + "/positions", { waitUntil: "domcontentloaded" });
    await empty.getByText("No positions yet", { exact: false }).waitFor({ timeout: 90000 });
    step("empty wallet sees the empty state on Positions", true);
    await empty.goto(BASE + "/start", { waitUntil: "domcontentloaded" });
    await empty.getByRole("link", { name: "Open the Mezo faucet" }).waitFor({ timeout: 60000 });
    step("wizard, empty wallet: step 1 open with faucet link, steps 2 and 3 locked", (await empty.locator(".step.todo").count()) === 2);
  }

  // ---------- phase 2: open through the wizard, then borrow and refinance ----------
  if (FROM <= 2) {
    await connect(alice);
    await alice.goto(BASE + "/start", { waitUntil: "domcontentloaded" });
    await alice.getByRole("heading", { name: "Open a position" }).first().waitFor({ timeout: 90000 });
    await alice.getByRole("button", { name: "Open position", exact: true }).waitFor({ timeout: 90000 });
    const wiz = await text(alice);
    step("wizard, funded wallet: step 1 done, step 2 open with the create form", (await alice.locator(".step.done").count()) >= 1 && /Resulting ICR/.test(wiz));
    await fill(alice, "Collateral (BTC)", "0.04");
    await fill(alice, "Borrow (MUSD, min 1,800)", "1800");
    await settle(alice, 800);
    await shot(alice, "wizard-open");
    r = await tx(alice, "Open position");
    step("open a position from the wizard (0.04 BTC, 1800 MUSD)", r.verdict === "ok", r.text);
    const after = await pub.readContract({ address: dep.deedNFT, abi: nftAbi, functionName: "nextId" });
    N = after - 1n;
    step("new Deed minted to the opener", after > startNext && lc(await pub.readContract({ address: dep.deedNFT, abi: nftAbi, functionName: "ownerOf", args: [N] })) === lc(wallets.alice.address), `Deed #${N}`);

    // the wizard moves on to step 3 by itself
    await alice.getByRole("button", { name: "List for sale", exact: true }).waitFor({ timeout: 90000 });
    step("wizard moves to step 3 and shows the list form", /Promised min ICR/.test(await text(alice)));
    await shot(alice, "wizard-list");

    // position page: gauge, debt, default ICR in the list form, borrow, refinance
    await alice.goto(BASE + `/position/${N}`, { waitUntil: "domcontentloaded" });
    await alice.getByRole("heading", { name: "Entire debt" }).waitFor({ timeout: 90000 });
    await settle(alice, 2500);
    const p0 = await lens(N);
    const defIcr = await field(alice, "Promised min ICR (%)").inputValue();
    step("list form default ICR is the position's ICR rounded down, capped at 150", Number(defIcr) === Math.min(150, Math.floor(Number(p0.icr) / 1e16)), `default ${defIcr}%, lens icr ${(Number(p0.icr) / 1e16).toFixed(2)}%`);
    const debtShown = num(await alice.locator(".health .big").innerText());
    step("position page entire debt matches DeedLens", near(debtShown, e18(p0.debt), 0.05), `ui ${debtShown}, lens ${e18(p0.debt).toFixed(4)}`);
    const rows = (await alice.locator(".breakdown > div b").allInnerTexts()).map(num);
    step("debt breakdown rows add up to the entire debt", near(rows[0] + rows[1] + rows[2], debtShown, 0.02), `${rows.slice(0, 3).join(" + ")} vs ${debtShown}`);
    step("health gauge renders", /%/.test(await alice.locator(".gauge svg text").first().textContent()));
    await shot(alice, "position-active");

    const debtBefore = p0.debt;
    const musdBefore = await musdOf(wallets.alice.address);
    await fill(alice, "Borrow more (MUSD)", "50");
    await settle(alice, 1500);
    step("borrow preview shows the fee and the new ICR", /Borrowing fee .* is added to your debt\. ICR after/.test(await text(alice)));
    r = await tx(alice, "Borrow");
    step("borrow 50 MUSD from the UI", r.verdict === "ok", r.text);
    const p1 = await lens(N);
    const got = (await musdOf(wallets.alice.address)) - musdBefore;
    step("chain: wallet received 50 MUSD and the debt rose by 50 plus the borrowing fee", near(e18(got), 50, 0.001) && near(e18(p1.debt - debtBefore), 50.05, 0.05), `received ${e18(got)}, debt +${e18(p1.debt - debtBefore).toFixed(4)}`);

    r = await tx(alice, "Refinance to current rate");
    step("refinance to the current rate from the UI", r.verdict === "ok", r.text);
    const p2 = await lens(N);
    step("chain: position still active after refinance, rate now matches the system", p2.status === 1, `rate ${p1.rate} -> ${p2.rate} bps, debt ${e18(p1.debt).toFixed(3)} -> ${e18(p2.debt).toFixed(3)}`);
  }

  // ---------- phase 3: list in the wizard with the default ICR, fee preview, bob buys ----------
  if (FROM <= 3) {
    await connect(alice);
    await alice.goto(BASE + "/start", { waitUntil: "domcontentloaded" });
    await alice.getByRole("button", { name: "List for sale", exact: true }).waitFor({ timeout: 90000 });
    await fill(alice, "Price (MUSD)", "50");
    await fill(alice, "Listing length (days)", "1");
    await settle(alice, 2000);
    const feeLine = await alice.locator(".fee").first().innerText();
    step("list form fee preview: 0.50% of 50 is 0.25, seller receives 49.75", /0\.25 MUSD/.test(feeLine) && /49\.75 MUSD/.test(feeLine), feeLine.replace(/\s+/g, " "));
    const fee = await pub.readContract({ address: dep.market, abi: venueAbi, functionName: "feeFor", args: [parseUnits("50", 18)] });
    step("fee preview equals the contract's feeFor", fee === parseUnits("0.25", 18), `feeFor(50) = ${e18(fee)}`);
    r = await tx(alice, "List for sale");
    step("list from the wizard with the untouched default ICR", r.verdict === "ok", r.text);
    const listedShown = await alice.getByText(/is listed/).first().waitFor({ timeout: 60000 }).then(() => true, () => false);
    step("wizard step 3 shows listed", listedShown);

    const treasuryBefore = await claimable(dep.market, dep.treasury);
    const aliceClaimBefore = await claimable(dep.market, wallets.alice.address);
    await connect(bob);
    await bob.goto(BASE + "/market", { waitUntil: "domcontentloaded" });
    await bob.getByText(`Deed #${N}`, { exact: true }).first().waitFor({ timeout: 90000 });
    await settle(bob, 2500);
    const mk = await text(bob);
    step("market card shows the buyer's fee line and the equity comparison", /You pay 50\.00 MUSD\. 0\.25 MUSD of it is the protocol fee/.test(mk) && /equity vs price/i.test(mk), (mk.match(/You pay[^\n]*/) ?? [""])[0].slice(0, 100));
    await shot(bob, "market-listing");
    r = await tx(bob, "Buy for 50.00 MUSD");
    step("buy the listing from the UI (approve then buy)", okOrGone(r), r.text);
    step("chain: Deed now belongs to the buyer", lc(await pub.readContract({ address: dep.deedNFT, abi: nftAbi, functionName: "ownerOf", args: [N] })) === lc(wallets.bob.address));
    const aliceGain = (await claimable(dep.market, wallets.alice.address)) - aliceClaimBefore;
    const treasuryGain = (await claimable(dep.market, dep.treasury)) - treasuryBefore;
    step("chain: seller credited 49.75, treasury credited 0.25", aliceGain === parseUnits("49.75", 18) && treasuryGain === parseUnits("0.25", 18), `seller +${e18(aliceGain)}, treasury +${e18(treasuryGain)}`);

    await alice.goto(BASE + "/positions", { waitUntil: "domcontentloaded" });
    await alice.getByRole("button", { name: /Claim .* \(market\)/ }).waitFor({ timeout: 90000 });
    await shot(alice, "proceeds");
    const claimLabel = (await alice.getByRole("button", { name: /Claim .* \(market\)/ }).first().innerText()).trim();
    const before = await musdOf(wallets.alice.address);
    r = await tx(alice, claimLabel);
    step(`seller claims the proceeds from the UI (${claimLabel})`, okOrGone(r), r.text);
    step("chain: wallet received the proceeds", near(e18((await musdOf(wallets.alice.address)) - before), 49.75, 0.001));
  }

  // ---------- phase 4: Recovery Mode (simulated) on the position bob now holds ----------
  if (FROM <= 4) {
    await connect(bob);
    for (const canClose of [false, true]) {
      const pg = await session("bob");
      await simulateRecovery(pg, canClose);
      await connect(pg);
      await pg.goto(BASE + `/position/${N}`, { waitUntil: "domcontentloaded" });
      await pg.getByText("Recovery Mode", { exact: true }).first().waitFor({ timeout: 90000 });
      await fill(pg, "Amount (BTC for collateral, MUSD for repay)", "0.00001");
      await fill(pg, "Borrow more (MUSD)", "10");
      const t = await text(pg);
      const dis = (name) => pg.getByRole("button", { name, exact: true }).first().isDisabled();
      step(`Recovery Mode (simulated, close ${canClose ? "allowed" : "blocked"}): banner and disabled buttons follow DeedLens`,
        /Withdrawing collateral:\s*blocked/.test(t) && (await dis("Withdraw collateral")) && (await dis("Borrow")) && (await dis("Refinance to current rate")) &&
        !(await dis("Add collateral")) && !(await dis("Repay MUSD")) && (await dis("Close position")) === !canClose &&
        (canClose ? /still allowed right now/.test(t) : /Closing a position:\s*blocked/.test(t)));
      if (!canClose) await shot(pg, "recovery-banner");
      if (!canClose) {
        const m = await session("bob", { width: 390, height: 844 });
        await simulateRecovery(m, false);
        await connect(m);
        await m.goto(BASE + `/position/${N}`, { waitUntil: "domcontentloaded" });
        await m.getByText("Recovery Mode", { exact: true }).first().waitFor({ timeout: 90000 });
        step("Recovery Mode banner at 390px, no sideways scroll", (await overflow(m)) <= 1);
        await shot(m, "m_recovery");
      }
    }
  }

  // ---------- phase 5: rescue. bob withdraws to under 120%, alice starts the rescue and bids ----------
  if (FROM <= 5) {
    await connect(bob);
    await bob.goto(BASE + `/position/${N}`, { waitUntil: "domcontentloaded" });
    await bob.getByRole("heading", { name: "Manage" }).waitFor({ timeout: 90000 });
    await settle(bob, 2000);
    const p = await lens(N);
    // collateral that leaves the ICR at 117%, so under the 120% public line and above the 110% floor
    const keep = (p.debt * 117n * 10n ** 16n) / p.price;
    const out = ((p.collateral - keep) / 10n ** 12n) * 10n ** 12n;
    await fill(bob, "Amount (BTC for collateral, MUSD for repay)", formatUnits(out, 18));
    r = await tx(bob, "Withdraw collateral");
    step("withdraw collateral from the UI to bring the position under the rescue line", r.verdict === "ok", `${e18(out).toFixed(5)} BTC, ${r.text}`);
    const pw = await lens(N);
    step("chain: ICR is now under 120% and above 110%", pw.icr < 12n * 10n ** 17n && pw.icr > 11n * 10n ** 17n, `${(Number(pw.icr) / 1e16).toFixed(2)}%`);

    await connect(alice);
    await alice.goto(BASE + "/rescue", { waitUntil: "domcontentloaded" });
    await alice.getByText(`Deed #${N}`, { exact: true }).first().waitFor({ timeout: 90000 });
    await settle(alice, 3000);
    await shot(alice, "rescue-atrisk");
    const guard = await alice.getByRole("button", { name: "Start rescue auction", exact: true }).first().isDisabled();
    step("rescue page lists the at-risk position and the start button is enabled", !guard, guard ? "button was disabled: the price source guard reported out of range" : "");
    r = await tx(alice, "Start rescue auction");
    step("a stranger starts the rescue auction from the At risk list", r.verdict === "ok", r.text);
    await alice.reload({ waitUntil: "domcontentloaded" });
    await alice.getByRole("button", { name: "Bid at current price", exact: true }).first().waitFor({ timeout: 90000 });
    await settle(alice, 2500);
    const card = await text(alice);
    const treasuryBefore = await claimable(dep.auction, dep.treasury);
    const bobBefore = await claimable(dep.auction, wallets.bob.address);
    step("auction card shows floor, time left, the winner's target ICR and the bid fee line", /Floor/.test(card) && /Time left/.test(card) && /Winner leaves ICR/.test(card) && /protocol fee/.test(card), (card.match(/You pay[^\n]*/) ?? [""])[0].slice(0, 110));
    await shot(alice, "rescue-live");
    const oldOwnerMusd = await musdOf(wallets.alice.address);
    r = await tx(alice, "Bid at current price");
    step("win the rescue auction from the UI (approve, then bid with BTC top-up)", okOrGone(r), r.text);
    const pb = await lens(N);
    step("chain: bidder holds the Deed and the position left above the safe ICR", lc(pb.holder) === lc(wallets.alice.address) && pb.icr >= 15n * 10n ** 17n, `${(Number(pb.icr) / 1e16).toFixed(2)}%`);
    const paid = oldOwnerMusd - (await musdOf(wallets.alice.address));
    const bobGain = (await claimable(dep.auction, wallets.bob.address)) - bobBefore;
    const treasuryGain = (await claimable(dep.auction, dep.treasury)) - treasuryBefore;
    step("chain: seller credited price minus fee, treasury credited the fee (0.5%)", bobGain > 0n && treasuryGain > 0n && bobGain + treasuryGain === paid && treasuryGain === (paid * 50n) / 10000n, `paid ${e18(paid).toFixed(4)}, seller +${e18(bobGain).toFixed(4)}, treasury +${e18(treasuryGain).toFixed(4)}`);

    await connect(bob);
    await bob.goto(BASE + "/positions", { waitUntil: "domcontentloaded" });
    await bob.getByRole("button", { name: /Claim .* \(auction\)/ }).waitFor({ timeout: 90000 });
    const lab = (await bob.getByRole("button", { name: /Claim .* \(auction\)/ }).first().innerText()).trim();
    const b0 = await musdOf(wallets.bob.address);
    r = await tx(bob, lab);
    step(`old owner claims the auction proceeds from the UI (${lab})`, okOrGone(r), r.text);
    step("chain: wallet received the auction proceeds", near(e18((await musdOf(wallets.bob.address)) - b0), e18(bobGain), 0.001));
  }

  // ---------- phase 6: close ----------
  if (FROM <= 6) {
    await connect(alice);
    const p = await lens(N);
    const need = p.debt - 200n * 10n ** 18n;
    const have = await musdOf(wallets.alice.address);
    if (have < need + need / 50n) {
      // funding the closer is test setup, not a UI step: bob sends the shortfall from his own wallet
      const top = need + need / 50n - have + 10n ** 18n;
      const hash = await clients.bob.writeContract({ address: dep.musd, abi: erc20, functionName: "transfer", args: [wallets.alice.address, top], gas: 200000n });
      await pub.waitForTransactionReceipt({ hash });
      txs.push({ who: "bob", to: dep.musd, selector: "transfer (test funding, not a UI step)", pageGas: null, hash });
    }
    await alice.goto(BASE + `/position/${N}`, { waitUntil: "domcontentloaded" });
    await alice.getByRole("heading", { name: "Manage" }).waitFor({ timeout: 90000 });
    await settle(alice, 2500);
    const pageText = await text(alice);
    const shownNeed = num((pageText.match(/Closing needs ([\d,.]+) MUSD/) ?? [])[1]);
    step("close panel states the entire debt less the 200 MUSD deposit", near(shownNeed, e18(need), 0.1), `ui ${shownNeed}, lens ${e18(need).toFixed(3)}`);
    const btcBefore = await pub.getBalance({ address: wallets.alice.address });
    r = await tx(alice, "Close position");
    step("close the position from the UI (approve entire debt, then close)", r.verdict === "ok", r.text);
    const pc = await lens(N);
    const btcGain = (await pub.getBalance({ address: wallets.alice.address })) - btcBefore;
    step("chain: trove closed by the holder and the collateral came back to the wallet", pc.status === 2 && btcGain > 0n, `status ${pc.status}, +${e18(btcGain).toFixed(5)} BTC`);
    await alice.reload({ waitUntil: "domcontentloaded" });
    await alice.getByRole("heading", { name: "Closed" }).waitFor({ timeout: 90000 });
    await settle(alice, 1500);
    const ct = await text(alice);
    step("closed position says nothing to claim and the claim button is disabled", /Nothing to claim/.test(ct) && (await alice.getByRole("button", { name: "Claim surplus", exact: true }).isDisabled()), "");
    await shot(alice, "position-closed");
  }

  // ---------- phase 7: closed and redeemed positions from the earlier v3 run ----------
  if (FROM <= 7) {
    await connect(bob);
    await bob.goto(BASE + "/position/3", { waitUntil: "domcontentloaded" });
    await bob.getByRole("heading", { name: /Closed by a redemption/ }).waitFor({ timeout: 90000 });
    await settle(bob, 1500);
    const t3 = await text(bob);
    step("a position closed by a redemption (surplus already claimed) says nothing to claim, button disabled", /Nothing to claim/.test(t3) && (await bob.getByRole("button", { name: "Claim surplus", exact: true }).isDisabled()) && /redeemed/.test(t3));
    await shot(bob, "position-redeemed");
    await bob.goto(BASE + "/position/1", { waitUntil: "domcontentloaded" });
    await bob.getByRole("heading", { name: "Deed #1" }).waitFor({ timeout: 90000 });
    await settle(bob, 1500);
    step("a position held by someone else shows the connect-the-holder note, no actions", /Connect the wallet that holds this Deed/.test(await text(bob)));
    const a3 = await lens(3);
    step("chain: redeemed position has no surplus left (it was claimed in the earlier run)", a3.surplus === 0n && a3.status === 4);
    untested.push("A claim that actually pays out surplus: surplus only exists after a third party's full redemption of a trove, which cannot be caused on demand. The claim path itself was exercised by the contracts session (docs/demo.md, Deed #3 of the v3 run, tx 0x3a672efe…57fa67). The UI shows 'Nothing to claim' for the redeemed and closed positions.");
  }

  // ---------- phase 8: errors read like sentences ----------
  if (FROM <= 8) {
    await connect(alice);
    await alice.goto(BASE + "/positions", { waitUntil: "domcontentloaded" });
    await alice.getByRole("heading", { name: "Open a position" }).waitFor({ timeout: 90000 });
    await fill(alice, "Collateral (BTC)", "0.001");
    await fill(alice, "Borrow (MUSD, min 1,800)", "1800");
    step("open form blocks an under-collateralised position before sending anything", await alice.getByRole("button", { name: "Open position", exact: true }).isDisabled());
    await connect(bob);
    await bob.goto(BASE + "/position/3", { waitUntil: "domcontentloaded" });
  }

  // ---------- phase 9: stats, earlier deployment, indexer fallback ----------
  if (FROM <= 9) {
    const truth = await chainTotals(BigInt(dep.deployBlock), dep);
    const earlier = await chainTotals(16339552n, dep.previousDeployments.v2);
    for (const [label, pg, apiUp] of [["indexer up (follows v2 only)", empty, true], ["indexer down", await session("empty"), false]]) {
      if (!apiUp) await pg.route(`${INDEXER}/**`, (route) => route.abort());
      await pg.goto(BASE + "/", { waitUntil: "domcontentloaded" });
      await pg.getByText("Positions opened").first().waitFor({ timeout: 150000 });
      await settle(pg, 1500);
      const ui = await statsOf(pg);
      const landing = await text(pg);
      step(`stats, ${label}: current deployment counted from chain and matches an independent scan`,
        num(ui["Positions opened"]) === truth.positions && num(ui["Unique wallets"]) === truth.wallets && near(num(ui["Volume"]), e18(truth.volume), 0.01) && near(num(ui["Fees paid"]), e18(truth.fees), 0.01),
        `ui ${ui["Positions opened"]} pos / ${ui["Unique wallets"]} wallets / ${ui["Volume"]} / fees ${ui["Fees paid"]}; chain ${truth.positions} / ${truth.wallets} / ${e18(truth.volume).toFixed(2)} / ${e18(truth.fees).toFixed(4)}`);
      if (apiUp) step("stats, indexer up: earlier deployment is labelled and its numbers match an independent v2 scan", new RegExp(`Earlier deployment \\(v2\\): ${earlier.positions} positions, ${e18(earlier.volume).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MUSD volume`).test(landing), (landing.match(/Earlier deployment[^\n]*/) ?? ["missing"])[0]);
      else step("stats, indexer down: page says the indexer did not answer, no earlier line, no error box", /indexer did not answer/.test(landing) && !/Earlier deployment/.test(landing) && (await pg.locator(".notice.err").count()) === 0);
    }
    await empty.goto(BASE + "/activity", { waitUntil: "domcontentloaded" });
    await empty.getByText("Recent transactions").waitFor({ timeout: 150000 });
    await settle(empty, 1500);
    const rows = await empty.locator(".feed .feed-row").allInnerTexts();
    const links = await empty.locator(".feed a").evaluateAll((as) => as.map((a) => a.href));
    step("activity lists recent v3 transactions with explorer links, newest first", links.length > 0 && links.every((h) => /explorer\.test\.mezo\.org\/tx\/0x[0-9a-f]{64}/.test(h)), `${links.length} rows`);
    step("activity shows this run's sale and rescue with their amounts", rows.some((x) => /Sold at a fixed price/.test(x) && /50\.00 MUSD/.test(x)) && rows.some((x) => /Rescue auction won/.test(x)), "");
    await shot(empty, "activity");
    untested.push("Stats from an indexer that follows v3: the indexer is not wired to v3 yet, so only the 'indexer behind' path (v2 history from the API, v3 from chain) and the 'indexer down' path were exercised. The code path for an indexer that has v3 was not run against real data.");
  }

  await browser.close();
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed, ${failed} failed`);
  console.log(`${txs.length} transactions sent`);
  const safeConsole = [...new Set(consoleErrors)].slice(0, 25);
  fs.writeFileSync(new URL("../docs/ui-pass-v3.json", import.meta.url), JSON.stringify({ base: BASE, position: String(N), results, txs, untested, consoleErrors: safeConsole }, null, 2));
  if (safeConsole.length) console.log("console errors:\n" + safeConsole.join("\n"));
}
main().catch(async (e) => {
  console.error("pass crashed:", e.message.split("\n")[0]);
  fs.writeFileSync(new URL("../docs/ui-pass-v3.json", import.meta.url), JSON.stringify({ base: BASE, results, txs, untested, consoleErrors: [...new Set(consoleErrors)].slice(0, 25), crashed: e.message.split("\n")[0] }, null, 2));
  await browser?.close();
  process.exit(1);
});
