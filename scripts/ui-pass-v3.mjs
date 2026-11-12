// Browser pass for the v3 frontend, against the v2 deployment, in headless Chromium on Linux.
//   node --env-file=../Deed/.env scripts/ui-pass-v3.mjs   (frontend served on http://localhost:3111)
// Wallets are bridged: the page gets a plain EIP-1193 provider and every signature happens here in Node. Keys are read
// from the environment and never printed or sent to the page. Results go to docs/ui-pass-v3.json.
import fs from "node:fs";
import { chromium } from "playwright-core";
import {
  createPublicClient, createWalletClient, decodeFunctionData, decodeFunctionResult, encodeFunctionResult,
  formatUnits, http, parseAbi, parseAbiItem, toFunctionSelector,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const dep = JSON.parse(fs.readFileSync(new URL("../deployments.json", import.meta.url)));
const BASE = process.env.UI_BASE ?? "http://localhost:3111";
const SHOTS = process.env.SHOT_DIR ?? "./shots";
fs.mkdirSync(SHOTS, { recursive: true });
const RPC = process.env.MEZO_TESTNET_RPC;
const chain = { id: 31611, name: "Mezo Testnet", nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const transport = http(RPC, { retryCount: 5, retryDelay: 1500 });
const pub = createPublicClient({ chain, transport });
const key = (k) => (k.startsWith("0x") ? k : `0x${k}`);
const wallets = {
  holder: privateKeyToAccount(key(process.env.SELLER_KEY)), // holds Deed #1 and #2 on the v2 deployment
  buyer: privateKeyToAccount(key(process.env.BUYER_KEY)), // holds Deed #3 (closed)
  empty: privateKeyToAccount(generatePrivateKey()), // fresh wallet, no funds, no Deeds
};
const clients = Object.fromEntries(Object.entries(wallets).map(([k, a]) => [k, createWalletClient({ account: a, chain, transport })]));
const lc = (a) => a.toLowerCase();

const results = [];
const txs = [];
const consoleErrors = [];
const step = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -  " + detail : ""}`);
};
const approved = { holder: false, buyer: false, empty: false };

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
      // the page sets an explicit gas limit (useSafeWrite); record it so the report can say the gas handling was in play
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

async function connect(page) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  if (!(await chip(page))) {
    await page.getByRole("button", { name: "Connect Wallet" }).first().click({ timeout: 60000 });
    await page.getByText("Browser Wallet", { exact: false }).first().click({ timeout: 30000 });
  }
  await page.waitForFunction(() => /0x[0-9a-fA-F]{2,6}\S{1,3}[0-9a-fA-F]{4}/.test(document.querySelector("nav")?.innerText ?? ""), null, { timeout: 60000 });
}

async function tx(page, label, timeout = 150000) {
  const b = page.getByRole("button", { name: label, exact: true }).first();
  await b.waitFor({ timeout: 30000 });
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
    if (/not attached|detached/i.test(e.message)) return { verdict: "detached", text: "card removed after the action" };
    throw e;
  }
}
const field = (page, label) => page.getByText(label, { exact: true }).locator("xpath=following-sibling::input").first();
const fill = async (page, label, v) => { const f = field(page, label); await f.fill(""); await f.fill(String(v)); };

// Rewrites what the page sees for chosen read-only calls. Reads go through Multicall3, so the target sits inside aggregate3.
const RPC_GLOB = "**/rpc.test.mezo.org/**";
const MULTICALL = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
]);
const word = (v) => "0x" + BigInt(v).toString(16).padStart(64, "0");
async function tamper(page, rules) {
  await page.route(RPC_GLOB, async (route) => {
    let body;
    try { body = JSON.parse(route.request().postData() ?? ""); } catch { return route.continue(); }
    const items = Array.isArray(body) ? body : [body];
    const plan = new Map();
    for (const it of items) {
      if (it.method !== "eth_call") continue;
      const data = it.params?.[0]?.data ?? it.params?.[0]?.input ?? "";
      if (data.startsWith("0x82ad56cb")) {
        const calls = decodeFunctionData({ abi: MULTICALL, data }).args[0];
        const hits = calls.flatMap((c, n) => { const r = rules.find((x) => c.callData.startsWith(x.sel)); return r ? [[n, r]] : []; });
        if (hits.length) plan.set(it.id, hits);
      } else {
        const r = rules.find((x) => data.startsWith(x.sel));
        if (r) plan.set(it.id, "direct:" + rules.indexOf(r));
      }
    }
    if (plan.size === 0) return route.continue();
    const real = await route.fetch();
    const json = await real.json();
    const out = Array.isArray(json) ? json : [json];
    for (const o of out) {
      const how = plan.get(o.id);
      if (!how || o.result === undefined) continue;
      if (typeof how === "string") { o.result = rules[Number(how.split(":")[1])].ret; continue; }
      const res = decodeFunctionResult({ abi: MULTICALL, functionName: "aggregate3", data: o.result }).map((r) => ({ ...r }));
      for (const [n, r] of how) { res[n].success = true; res[n].returnData = r.ret; }
      o.result = encodeFunctionResult({ abi: MULTICALL, functionName: "aggregate3", result: res });
    }
    await route.fulfill({ response: real, json: Array.isArray(json) ? out : out[0] });
  });
}
const RECOVERY_RULES = [
  { sel: toFunctionSelector("checkRecoveryMode(uint256)"), ret: word(1) },
  { sel: toFunctionSelector("getTCR(uint256)"), ret: word(13n * 10n ** 17n) },
];

// independent count of the same events the Activity page shows, a plain scan with the library's own event filter
async function chainTotals() {
  const head = await pub.getBlockNumber();
  const from = BigInt(process.env.NEXT_PUBLIC_START_BLOCK ?? "16339553");
  const created = parseAbiItem("event PositionCreated(uint256 indexed tokenId, address indexed vault, address indexed owner, uint256 collateral, uint256 debt)");
  const sold = parseAbiItem("event Sold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price)");
  const won = parseAbiItem("event Won(uint256 indexed tokenId, address indexed seller, address indexed winner, uint256 price, uint256 topUp)");
  let positions = 0, volume = 0n;
  const wallets = new Set();
  for (let a = from; a <= head; a += 10000n) {
    const b = a + 9999n < head ? a + 9999n : head;
    const [c, s, w] = await Promise.all([
      pub.getLogs({ address: dep.factory, event: created, fromBlock: a, toBlock: b }),
      pub.getLogs({ address: dep.market, event: sold, fromBlock: a, toBlock: b }),
      pub.getLogs({ address: dep.auction, event: won, fromBlock: a, toBlock: b }),
    ]);
    positions += c.length;
    c.forEach((l) => wallets.add(lc(l.args.owner)));
    for (const l of s) { volume += l.args.price; wallets.add(lc(l.args.seller)); wallets.add(lc(l.args.buyer)); }
    for (const l of w) { volume += l.args.price; wallets.add(lc(l.args.seller)); wallets.add(lc(l.args.winner)); }
  }
  return { positions, volume, wallets: wallets.size };
}

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const text = (page) => page.locator("main").innerText();
const RAW_SELECTOR = /0x[0-9a-fA-F]{8}\b/;

async function main() {
  browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
  const holder = await session("holder");
  const buyer = await session("buyer");
  const empty = await session("empty");
  const phone = await session("empty", { width: 390, height: 844 });

  // 1. every route at desktop and phone width, no wallet connected
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

  // 2. landing content and live stats against an independent chain scan
  await empty.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await empty.getByText("Positions opened").first().waitFor({ timeout: 120000 });
  const land = await text(empty);
  for (const [label, re] of [
    ["problem sentence", /stuck to the wallet that opened it/],
    ["track", /DeFi · Borrowing/],
    ["target users", /BTC holders with a MUSD loan[\s\S]*Position buyers[\s\S]*Rescue bidders[\s\S]*Keepers/],
    ["how it works", /Open in a vault[\s\S]*The Deed is the key[\s\S]*Sell it/],
    ["safety rules", /Strangers start rescues only under 120% ICR/],
    ["fee disclosure", /Deed's fee:[\s\S]*0\.1% borrowing fee/],
    ["video placeholder", /Demo video coming soon/],
  ]) step(`landing shows ${label}`, re.test(land));
  const truth = await chainTotals();
  const ui = await empty.evaluate(() => {
    const m = {};
    document.querySelectorAll(".stat").forEach((s) => (m[s.querySelector(".k").textContent] = s.querySelector(".v").textContent));
    return m;
  });
  step("landing stats match an independent chain scan (positions, wallets)", Number(ui["Positions opened"]) === truth.positions && Number(ui["Unique wallets"]) === truth.wallets, `ui ${ui["Positions opened"]} positions / ${ui["Unique wallets"]} wallets, chain ${truth.positions} / ${truth.wallets}`);
  const uiVol = Number(ui["Volume"].replace(/[^\d.]/g, ""));
  step("landing volume matches the chain scan", Math.abs(uiVol - Number(formatUnits(truth.volume, 18))) < 0.01, `ui ${ui["Volume"]}, chain ${formatUnits(truth.volume, 18)} MUSD`);
  step("landing fees line reads 0 on a deployment with no fee", /^0\.00 MUSD/.test(ui["Fees paid"] ?? ""), ui["Fees paid"]);

  // 3. activity page
  await empty.goto(BASE + "/activity", { waitUntil: "domcontentloaded" });
  await empty.getByText("Recent transactions").waitFor({ timeout: 120000 });
  await settle(empty, 1500);
  const links = await empty.locator(".feed a").evaluateAll((as) => as.map((a) => a.href));
  step("activity lists recent transactions with explorer links", links.length > 0 && links.every((h) => /explorer\.test\.mezo\.org\/tx\/0x[0-9a-f]{64}/.test(h)), `${links.length} rows`);
  await shot(empty, "activity");

  // 4. empty states and a wallet with nothing
  await empty.goto(BASE + "/positions", { waitUntil: "domcontentloaded" });
  await connect(empty);
  await empty.goto(BASE + "/positions", { waitUntil: "domcontentloaded" });
  await empty.getByText("No positions yet", { exact: false }).waitFor({ timeout: 90000 });
  step("empty wallet sees the empty state on Positions", true);
  await empty.goto(BASE + "/start", { waitUntil: "domcontentloaded" });
  await empty.getByRole("link", { name: "Open the Mezo faucet" }).waitFor({ timeout: 60000 });
  const w1 = await text(empty);
  step("wizard, empty wallet: step 1 open with faucet link, steps 2 and 3 locked", /Get test BTC/.test(w1) && (await empty.locator(".step.todo").count()) === 2);
  await shot(empty, "wizard-empty");

  // 5. holder: position page numbers, gauge, debt breakdown, fee preview, borrow panel
  await connect(holder);
  await holder.goto(BASE + "/position/1", { waitUntil: "domcontentloaded" });
  await holder.getByRole("heading", { name: "Entire debt" }).waitFor({ timeout: 90000 });
  await settle(holder, 2500);
  const entire = await pub.readContract({ address: dep.troveManager, abi: parseAbi(["function getEntireDebtAndColl(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)"]), functionName: "getEntireDebtAndColl", args: [await pub.readContract({ address: dep.factory, abi: parseAbi(["function vaultOf(uint256) view returns (address)"]), functionName: "vaultOf", args: [1n] })] });
  const debtShown = Number((await holder.locator(".health .big").innerText()).replace(/[^\d.]/g, ""));
  const debtChain = Number(formatUnits(entire[1] + entire[2], 18));
  step("position page: entire debt matches TroveManager (within accrual since the read)", Math.abs(debtShown - debtChain) < 0.05, `ui ${debtShown}, chain ${debtChain.toFixed(4)}`);
  const rows = await holder.locator(".breakdown > div b").allInnerTexts();
  const nums = rows.map((r) => Number(r.replace(/[^\d.]/g, "")));
  step("debt breakdown rows add up to the entire debt", Math.abs(nums[0] + nums[1] + nums[2] - debtShown) < 0.02, `${nums.slice(0, 3).join(" + ")} vs ${debtShown}`);
  step("health gauge is on screen", (await holder.locator(".gauge svg").count()) === 1 && /%/.test(await holder.locator(".gauge svg text").first().innerText()));
  const pageText = await text(holder);
  step("borrow and refinance explain that v2 vaults cannot", /no borrow or refinance function/.test(pageText) && (await holder.getByRole("button", { name: "Borrow", exact: true }).isDisabled()) && (await holder.getByRole("button", { name: "Refinance to current rate", exact: true }).isDisabled()));
  await fill(holder, "Price (MUSD)", "50");
  step("list form shows the fee preview (no fee on this deployment)", await holder.getByText("no fee").first().isVisible());
  await fill(holder, "Borrow more (MUSD)", "10");
  await settle(holder, 1500);
  step("borrow preview shows the fee and the new ICR", /Borrowing fee .* is added to your debt/.test(await text(holder)));
  await shot(holder, "position-1");

  // 6. Recovery Mode (simulated at the RPC, the real system is at a healthy TCR)
  await tamper(holder, RECOVERY_RULES);
  await holder.reload({ waitUntil: "domcontentloaded" });
  await holder.getByText("Recovery Mode", { exact: true }).first().waitFor({ timeout: 90000 });
  await fill(holder, "Amount (BTC for collateral, MUSD for repay)", "0.00001");
  const rm = await text(holder);
  step("Recovery Mode (simulated): banner explains what is blocked", /Withdrawing collateral:\s*blocked/.test(rm) && /still work/.test(rm));
  step("Recovery Mode (simulated): withdraw is disabled", await holder.getByRole("button", { name: "Withdraw collateral", exact: true }).isDisabled());
  step("Recovery Mode (simulated): borrow and refinance are disabled", (await holder.getByRole("button", { name: "Borrow", exact: true }).isDisabled()) && (await holder.getByRole("button", { name: "Refinance to current rate", exact: true }).isDisabled()));
  step("Recovery Mode (simulated): add collateral and repay stay enabled", !(await holder.getByRole("button", { name: "Add collateral", exact: true }).first().isDisabled()) && !(await holder.getByRole("button", { name: "Repay MUSD", exact: true }).isDisabled()));
  const closeBlocked = await holder.getByRole("button", { name: "Close position", exact: true }).isDisabled();
  step("Recovery Mode (simulated): close follows Mezo's mint-list rule", closeBlocked === /Closing a position:\s*blocked/.test(rm), `close disabled: ${closeBlocked}`);
  await shot(holder, "recovery-banner");
  const mrm = await session("holder", { width: 390, height: 844 });
  await tamper(mrm, RECOVERY_RULES);
  await connect(mrm);
  await mrm.goto(BASE + "/position/1", { waitUntil: "domcontentloaded" });
  await mrm.getByText("Recovery Mode", { exact: true }).first().waitFor({ timeout: 90000 });
  step("Recovery Mode banner at 390px, no sideways scroll", (await overflow(mrm)) <= 1);
  await shot(mrm, "m_recovery");
  await holder.unroute(RPC_GLOB);

  // 7. real transactions through useSafeWrite: list and cancel Deed #2
  await holder.goto(BASE + "/position/2", { waitUntil: "domcontentloaded" });
  await holder.getByRole("heading", { name: "Sell at a fixed price" }).waitFor({ timeout: 90000 });
  await fill(holder, "Price (MUSD)", "5");
  await fill(holder, "Promised min ICR (%)", "110");
  await fill(holder, "Listing length (days)", "1");
  let r = await tx(holder, "List for sale");
  step("list Deed #2 from the UI", r.verdict === "ok", r.text);
  await buyer.goto(BASE + "/market", { waitUntil: "domcontentloaded" });
  await connect(buyer);
  await buyer.goto(BASE + "/market", { waitUntil: "domcontentloaded" });
  await buyer.getByText("Deed #2", { exact: true }).first().waitFor({ timeout: 90000 });
  step("market shows the listing with the buyer's fee line", /You pay 5\.00 MUSD, nothing on top/.test(await text(buyer)));
  await shot(buyer, "market");
  await holder.reload({ waitUntil: "domcontentloaded" });
  r = await tx(holder, "Cancel listing");
  step("cancel the listing from the UI", r.verdict === "ok", r.text);

  // 8. closed position and surplus
  await buyer.goto(BASE + "/position/3", { waitUntil: "domcontentloaded" });
  await buyer.getByRole("heading", { name: /Closed|Liquidated/ }).waitFor({ timeout: 90000 });
  await settle(buyer, 3000);
  const closedText = await text(buyer);
  step("closed position shows the surplus state instead of a bare button", /surplus collateral/.test(closedText), (closedText.match(/(Mezo is holding[^.]*\.|There is no surplus[^.]*\.)/) ?? [""])[0]);
  await shot(buyer, "position-3-closed");

  // 9. errors read like sentences, not selectors
  await holder.goto(BASE + "/position/1", { waitUntil: "domcontentloaded" });
  await holder.getByRole("heading", { name: "Manage" }).waitFor({ timeout: 90000 });
  await fill(holder, "Amount (BTC for collateral, MUSD for repay)", "5");
  r = await tx(holder, "Withdraw collateral");
  step("an impossible withdrawal shows a plain-language error, no raw selector", r.verdict === "err" && !RAW_SELECTOR.test(r.text), r.text.slice(0, 140));
  await shot(holder, "error-withdraw");

  // 10. wizard for a wallet that already holds a position
  await holder.goto(BASE + "/start", { waitUntil: "domcontentloaded" });
  await holder.getByRole("heading", { name: "List it for sale" }).waitFor({ timeout: 90000 });
  await settle(holder, 3000);
  const wz = await text(holder);
  step("wizard, holder: step 2 done, step 3 shows the list form", /You hold Deed #\d/.test(wz) && (await holder.getByRole("button", { name: "List for sale", exact: true }).count()) === 1);
  await shot(holder, "wizard-holder");

  // 11. error state with the RPC down
  const down = await session("empty");
  await down.route(RPC_GLOB, (route) => route.abort());
  await down.goto(BASE + "/market", { waitUntil: "domcontentloaded" });
  await down.getByRole("alert").first().waitFor({ timeout: 90000 });
  const errText = await down.getByRole("alert").first().innerText();
  step("RPC down: Market shows a readable error with Retry", /Could not load positions/.test(errText) && !RAW_SELECTOR.test(errText) && (await down.getByRole("button", { name: "Retry" }).count()) > 0, errText.replace(/\s+/g, " ").slice(0, 140));
  await shot(down, "error-rpc-down");

  await browser.close();
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed, ${failed} failed`);
  console.log(`${txs.length} transactions sent`);
  const safeConsole = [...new Set(consoleErrors)].slice(0, 25);
  fs.writeFileSync(new URL("../docs/ui-pass-v3.json", import.meta.url), JSON.stringify({ base: BASE, results, txs, consoleErrors: safeConsole }, null, 2));
  if (safeConsole.length) console.log("console errors:\n" + safeConsole.join("\n"));
}
main().catch(async (e) => {
  console.error("pass crashed:", e.message.split("\n")[0]);
  fs.writeFileSync(new URL("../docs/ui-pass-v3.json", import.meta.url), JSON.stringify({ base: BASE, results, txs, consoleErrors: [...new Set(consoleErrors)].slice(0, 25), crashed: e.message.split("\n")[0] }, null, 2));
  await browser?.close();
  process.exit(1);
});
