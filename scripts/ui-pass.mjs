// Click-through of the Deed frontend against the deployed contracts, in a real Chrome.
//   node --env-file=.env scripts/ui-pass.mjs   (frontend on http://localhost:3111, built with the deployed addresses)
// Needs playwright-core and an installed Chrome. Wallets are bridged: the page gets a plain EIP-1193 provider
// and every signature happens here in Node. Keys are read from the environment and never printed or sent to the page.
import fs from "node:fs";
import { chromium } from "playwright-core";
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  decodeFunctionResult,
  encodeErrorResult,
  encodeFunctionResult,
  formatUnits,
  http,
  parseAbi,
  toFunctionSelector,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const dep = JSON.parse(fs.readFileSync(new URL("../deployments.json", import.meta.url)));
const BASE = process.env.UI_BASE ?? "http://localhost:3111";
const SHOTS = process.env.SHOT_DIR ?? "./shots";
fs.mkdirSync(SHOTS, { recursive: true });
const RPC = process.env.MEZO_TESTNET_RPC;
const chain = {
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};
const transport = http(RPC, { retryCount: 5, retryDelay: 1500 });
const pub = createPublicClient({ chain, transport });
const key = (k) => (k.startsWith("0x") ? k : `0x${k}`);
const wallets = {
  owner: privateKeyToAccount(key(process.env.BUYER_KEY)), // holds Deed #1 and #2 after the e2e run
  taker: privateKeyToAccount(key(process.env.SELLER_KEY)), // buys and bids
};
const clients = Object.fromEntries(Object.entries(wallets).map(([k, a]) => [k, createWalletClient({ account: a, chain, transport })]));

const abi = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function nextId() view returns (uint256)",
  "function fetchPrice() view returns (uint256)",
  "function lockedBy(uint256) view returns (address)",
]);
const ownerOf = (id) => pub.readContract({ address: dep.deedNFT, abi, functionName: "ownerOf", args: [BigInt(id)] });

const pages = [];
const REST = process.env.REST === "1"; // continue from the state an earlier run left behind
const results = [];
const txs = [];
const consoleErrors = [];
const step = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -  " + detail : ""}`);
};

// like a real wallet: no accounts are shared until the page asks and the user approves
const approved = { owner: false, taker: false };

async function handle(who, method, params) {
  const a = wallets[who];
  switch (method) {
    case "eth_requestAccounts":
      approved[who] = true;
      return [a.address];
    case "eth_accounts":
      return approved[who] ? [a.address] : [];
    case "eth_chainId":
      return "0x7b7b";
    case "net_version":
      return "31611";
    case "wallet_switchEthereumChain":
    case "wallet_addEthereumChain":
      return null;
    case "wallet_getPermissions":
    case "wallet_requestPermissions":
      return [{ parentCapability: "eth_accounts" }];
    case "eth_sendTransaction": {
      const t = params[0];
      const value = t.value ? BigInt(t.value) : undefined;
      const gas = t.gas
        ? BigInt(t.gas)
        : ((await pub.estimateGas({ account: a, to: t.to, data: t.data, value })) * 13n) / 10n;
      const hash = await clients[who].sendTransaction({ to: t.to, data: t.data, value, gas });
      txs.push({ who, to: t.to, selector: (t.data ?? "0x").slice(0, 10), hash });
      return hash;
    }
    case "personal_sign":
      return clients[who].signMessage({ message: { raw: params[0] } });
    default:
      return pub.request({ method, params });
  }
}

async function session(browser, who, viewport = { width: 1280, height: 900 }) {
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
  pages.push(page);
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(`[${who}] ${m.text().slice(0, 220)}`));
  page.on("pageerror", (e) => consoleErrors.push(`[${who}] pageerror ${e.message.slice(0, 220)}`));
  page.on("response", (r) => {
    if (r.status() >= 400) consoleErrors.push(`[${who}] HTTP ${r.status()} ${r.url().slice(0, 140)}`);
  });
  return page;
}

const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

async function connect(page) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  const connectBtn = page.getByRole("button", { name: "Connect Wallet" }).first();
  // a wallet that was approved before reconnects by itself, the button only flashes while that happens
  await page.waitForTimeout(5000);
  const chip = () => page.evaluate(() => /0x[0-9a-fA-F]{2,6}\S{1,3}[0-9a-fA-F]{4}/.test(document.querySelector("nav")?.innerText ?? ""));
  const already = await chip();
  if (!already) {
    await connectBtn.click({ timeout: 60000 });
    await page.getByText("Browser Wallet", { exact: false }).first().click({ timeout: 30000 });
  }
  await page.waitForFunction(() => /0x[0-9a-fA-F]{2,6}\S{1,3}[0-9a-fA-F]{4}/.test(document.querySelector("nav")?.innerText ?? ""), null, {
    timeout: 60000,
  });
}

/** Clicks a transaction button and waits for its own status line to say done or error. */
async function tx(page, label, timeout = 150000) {
  const b = page.getByRole("button", { name: label, exact: true }).first();
  await b.waitFor({ timeout: 30000 });
  const handle = await b.elementHandle();
  const box = (await handle.evaluateHandle((e) => e.parentElement)).asElement();
  await b.click();
  try {
    const verdict = await Promise.race([
      box.waitForSelector(".txline.ok", { timeout }).then(() => "ok"),
      box.waitForSelector(".txline.err", { timeout }).then(() => "err"),
    ]);
    const text = (await box.$eval(".txline", (e) => e.innerText)).replace(/\s+/g, " ");
    return { verdict, text };
  } catch (e) {
    // the card holding the button was removed, which is what happens when the action worked (auction won,
    // payout claimed). Callers that can, check the chain; this only says what the page did.
    if (/not attached|detached/i.test(e.message)) return { verdict: "detached", text: "the button's card disappeared after the action" };
    throw e;
  }
}

const field = (page, label) => page.getByText(label, { exact: true }).locator("xpath=following-sibling::input").first();
const fill = async (page, label, v) => {
  const f = field(page, label);
  await f.fill("");
  await f.fill(String(v));
};
const e18 = (v) => formatUnits(v, 18);
const settle = (page, ms = 2500) => page.waitForTimeout(ms);

// Changes what the page sees from the RPC, without touching the chain.
//   skew:   the DEX spot price comes back 30% lower, so the page should say the price source is out of range
//   revert: requiredTopUp fails the way the contract does when its own guard trips (SpotDeviation)
// The app reads through Multicall3 (viem batches reads), so the call to change sits inside an aggregate3.
const RPC_GLOB = "**/rpc.test.mezo.org/**";
const SEL = { skew: toFunctionSelector("spotPrice()"), revert: toFunctionSelector("requiredTopUp(uint256)") };
const GUARD_MESSAGE = "Price source out of range, try again shortly.";
const MULTICALL = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
]);
const SPOT_DEVIATION = encodeErrorResult({
  abi: parseAbi(["error SpotDeviation(uint256 oracle, uint256 spot)"]),
  errorName: "SpotDeviation",
  args: [1n, 2n],
});
async function tamper(page, kind) {
  await page.route(RPC_GLOB, async (route) => {
    let body;
    try {
      body = JSON.parse(route.request().postData() ?? "");
    } catch {
      return route.continue();
    }
    const items = Array.isArray(body) ? body : [body];
    // for every eth_call, the positions of the inner calls we want to change (empty when none)
    const plan = new Map();
    for (const it of items) {
      if (it.method !== "eth_call") continue;
      const data = it.params?.[0]?.data ?? it.params?.[0]?.input ?? "";
      if (data.startsWith("0x82ad56cb")) {
        const calls = decodeFunctionData({ abi: MULTICALL, data }).args[0];
        const idx = calls.flatMap((c, n) => (c.callData.startsWith(SEL[kind]) ? [n] : []));
        if (idx.length) plan.set(it.id, idx);
      } else if (data.startsWith(SEL[kind])) {
        plan.set(it.id, "direct");
      }
    }
    if (plan.size === 0) return route.continue();
    const real = await route.fetch();
    const json = await real.json();
    const out = Array.isArray(json) ? json : [json];
    for (const o of out) {
      const how = plan.get(o.id);
      if (!how || o.result === undefined) continue;
      if (how === "direct") {
        if (kind === "skew") o.result = "0x" + ((BigInt(o.result) * 7n) / 10n).toString(16).padStart(64, "0");
        else {
          delete o.result;
          o.error = { code: 3, message: "execution reverted", data: SPOT_DEVIATION };
        }
        continue;
      }
      const results = decodeFunctionResult({ abi: MULTICALL, functionName: "aggregate3", data: o.result }).map((r) => ({ ...r }));
      for (const n of how) {
        if (kind === "skew") {
          results[n].returnData = "0x" + ((BigInt(results[n].returnData) * 7n) / 10n).toString(16).padStart(64, "0");
        } else {
          results[n].success = false;
          results[n].returnData = SPOT_DEVIATION;
        }
      }
      o.result = encodeFunctionResult({ abi: MULTICALL, functionName: "aggregate3", result: results });
    }
    await route.fulfill({ response: real, json: Array.isArray(json) ? out : out[0] });
  });
}
async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const owner = await session(browser, "owner");
  const taker = await session(browser, "taker");
  const startNext = await pub.readContract({ address: dep.deedNFT, abi, functionName: "nextId" });

  // 0. every route before connecting
  for (const [path, h1] of [["/", "My positions"], ["/market", "Market"], ["/rescue", "Rescue"], ["/position/1", "Deed #1"]]) {
    await owner.goto(BASE + path, { waitUntil: "domcontentloaded" });
    try {
      await owner.getByRole("heading", { level: 1, name: h1 }).waitFor({ timeout: 45000 });
      step(`route ${path} renders without a wallet`, true);
    } catch (e) {
      step(`route ${path} renders without a wallet`, false, e.message.split("\n")[0]);
    }
    await settle(owner, 1500);
    await shot(owner, `anon${path.replace(/\//g, "_") || "_home"}`);
  }

  // 1. connect
  try {
    await connect(owner);
    step("owner wallet connects through the Connect modal", true);
  } catch (e) {
    await shot(owner, "connect-fail");
    step("owner wallet connects through the Connect modal", false, e.message.split("\n")[0]);
    throw e;
  }
  await connect(taker);
  step("second wallet connects", true);

  // 2. My Positions shows the Deeds the wallet holds, numbers match the chain
  await owner.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await owner.getByText(REST ? "Deed #3" : "Deed #2", { exact: true }).first().waitFor({ timeout: 90000 });
  await settle(owner);
  await shot(owner, "my-positions");
  const bodyText = await owner.locator("main").innerText();
  step(REST ? "My Positions lists the Deed the wallet still holds" : "My Positions lists Deed #1 and #2", REST ? /Deed #3/.test(bodyText) : /Deed #1/.test(bodyText) && /Deed #2/.test(bodyText));
  step("create form shows a live ICR preview", /Resulting ICR\s*\d/.test(bodyText), (bodyText.match(/Resulting ICR\s*[\d.,]+%/) ?? [""])[0]);

  let r;
  let id3 = (await pub.readContract({ address: dep.deedNFT, abi, functionName: "nextId" })) - 1n;
  if (!REST) {
  // a listing left over from an earlier run would block the list step below, so clear it first
  const lst = await pub.readContract({ address: dep.market, abi: parseAbi(["function listings(uint256) view returns (address,uint64,uint256,uint256,bytes32)"]), functionName: "listings", args: [1n] });
  if (lst[0] !== "0x0000000000000000000000000000000000000000" && (await ownerOf(1)).toLowerCase() === wallets.owner.address.toLowerCase()) {
    await handle("owner", "eth_sendTransaction", [{ to: dep.market, data: "0x" + "40e58ee5" + (1).toString(16).padStart(64, "0"), gas: "0x7a120" }]);
    await settle(owner, 4000);
  }

  // 3. manage Deed #1
  await owner.goto(BASE + "/position/1", { waitUntil: "domcontentloaded" });
  await owner.getByRole("heading", { name: "Manage" }).waitFor({ timeout: 60000 });
  await shot(owner, "position-1");
  await fill(owner, "Amount (BTC for collateral, MUSD for repay)", "0.00005");
  r = await tx(owner, "Add collateral");
  step("add collateral from the UI", r.verdict === "ok", r.text);
  await fill(owner, "Amount (BTC for collateral, MUSD for repay)", "0.00001");
  r = await tx(owner, "Withdraw collateral");
  step("withdraw collateral from the UI", r.verdict === "ok", r.text);
  await fill(owner, "Amount (BTC for collateral, MUSD for repay)", "0.01");
  r = await tx(owner, "Repay MUSD");
  step("repay MUSD from the UI (approve then repay)", r.verdict === "ok", r.text);
  await fill(owner, "Amount (BTC for collateral, MUSD for repay)", "5");
  r = await tx(owner, "Withdraw collateral");
  step("an impossible withdrawal shows an error, not a crash", r.verdict === "err", r.text.slice(0, 140));
  await shot(owner, "position-1-error");

  // 4. list Deed #1, the other wallet buys it
  await owner.goto(BASE + "/position/1", { waitUntil: "domcontentloaded" });
  await owner.getByRole("heading", { name: "Sell at a fixed price" }).waitFor({ timeout: 60000 });
  await fill(owner, "Price (MUSD)", "50");
  await fill(owner, "Promised min ICR (%)", "140");
  await fill(owner, "Listing length (days)", "1");
  r = await tx(owner, "List for sale");
  step("list Deed #1 from the UI", r.verdict === "ok", r.text);

  await taker.goto(BASE + "/market", { waitUntil: "domcontentloaded" });
  await taker.getByText("Deed #1", { exact: true }).first().waitFor({ timeout: 90000 });
  await settle(taker);
  await shot(taker, "market");
  const mk = await taker.locator("main").innerText();
  step("Market shows the listing with price, ICR, rate and equity", /50\.00 MUSD/i.test(mk) && /ICR/i.test(mk) && /Implied equity/i.test(mk));
  r = await tx(taker, "Buy for 50.00 MUSD");
  step("buy the listing from the UI (approve then buy)", r.verdict === "ok", r.text);
  step("chain: Deed #1 now belongs to the buyer", (await ownerOf(1)).toLowerCase() === wallets.taker.address.toLowerCase());

  await owner.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await owner.getByRole("button", { name: /Claim .* \(market\)/ }).waitFor({ timeout: 60000 });
  await shot(owner, "proceeds");
  r = await tx(owner, (await owner.getByRole("button", { name: /Claim .* \(market\)/ }).first().innerText()).trim());
  step("seller claims the proceeds from the UI", r.verdict === "ok", r.text);

  // 5. open a position from the UI, aimed at ~118% so it is under the rescue line
  const price = await pub.readContract({ address: dep.priceFeed, abi, functionName: "fetchPrice" });
  const coll = (Number(1.18 * 2001.8) / (Number(price) / 1e18)).toFixed(5);
  await owner.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await owner.getByRole("heading", { name: "Open a position" }).waitFor({ timeout: 60000 });
  await fill(owner, "Collateral (BTC)", coll);
  await fill(owner, "Borrow (MUSD, min 1,800)", "1800");
  await settle(owner, 800);
  await shot(owner, "open-form");
  r = await tx(owner, "Open position");
  step(`open a position from the UI (${coll} BTC, 1800 MUSD)`, r.verdict === "ok", r.text);
  id3 = (await pub.readContract({ address: dep.deedNFT, abi, functionName: "nextId" })) - 1n;
  step("new Deed minted to the opener", id3 >= startNext && (await ownerOf(id3)).toLowerCase() === wallets.owner.address.toLowerCase(), `Deed #${id3}`);

  // 6. at-risk list and public rescue
  await taker.goto(BASE + "/rescue", { waitUntil: "domcontentloaded" });
  await taker.getByText(`Deed #${id3}`, { exact: true }).first().waitFor({ timeout: 90000 });
  await shot(taker, "rescue-atrisk");
  await tamper(taker, "skew");
  await taker.reload({ waitUntil: "domcontentloaded" });
  await taker.getByText(`Deed #${id3}`, { exact: true }).first().waitFor({ timeout: 90000 });
  await settle(taker, 3000);
  await shot(taker, "rescue-atrisk-paused");
  step(
    "price source out of range: the page says so and Start rescue is disabled",
    (await taker.getByText(GUARD_MESSAGE, { exact: true }).first().isVisible()) &&
      (await taker.getByRole("button", { name: "Start rescue auction", exact: true }).first().isDisabled()),
  );
  await taker.unroute(RPC_GLOB);
  await taker.reload({ waitUntil: "domcontentloaded" });
  await taker.getByText(`Deed #${id3}`, { exact: true }).first().waitFor({ timeout: 90000 });
  r = await tx(taker, "Start rescue auction");
  step("anyone starts a rescue auction from the At risk list", r.verdict === "ok", r.text);
  await taker.reload({ waitUntil: "domcontentloaded" });
  await taker.getByRole("button", { name: "Bid at current price" }).first().waitFor({ timeout: 90000 });
  const p1 = await taker.locator(".big").first().innerText();
  await taker.waitForTimeout(6000);
  const p2 = await taker.locator(".big").first().innerText();
  await shot(taker, "rescue-live");
  step("live auction price counts down on screen", p1 !== p2, `${p1} -> ${p2}`);
  const timeLeft = await taker.locator("main").innerText();
  step("auction card shows floor, time left and target ICR", /Floor/i.test(timeLeft) && /Time left/i.test(timeLeft) && /Winner leaves ICR/i.test(timeLeft));

  // 7. owner side of a third party auction: cancel is refused until the position is healthy again
  await owner.goto(BASE + `/position/${id3}`, { waitUntil: "domcontentloaded" });
  await owner.getByRole("heading", { name: "Top up during auction" }).waitFor({ timeout: 90000 });
  await shot(owner, "position-auction-owner");
  r = await tx(owner, "Cancel auction");
  step("owner cannot cancel a rescue while the ICR is under the line", r.verdict === "err", r.text.slice(0, 120));
  await owner.getByPlaceholder("BTC").fill("0.0035");
  r = await tx(owner, "Add collateral");
  step("owner tops up through the auction", r.verdict === "ok", r.text);
  r = await tx(owner, "Cancel auction");
  step("owner cancels once the ICR is back above the line", r.verdict === "ok", r.text);

  } // end of the steps skipped in REST mode

  // AUCTION_ONLY=1 with REST=1 runs just this section, for a chain that is already past the earlier steps
  if (!REST || process.env.AUCTION_ONLY === "1") {
  if (REST) {
    // put Deed #3 back under the public line, so the Start button has something to guard
    await owner.goto(BASE + `/position/${id3}`, { waitUntil: "domcontentloaded" });
    await owner.getByRole("heading", { name: "Manage" }).waitFor({ timeout: 60000 });
    await fill(owner, "Amount (BTC for collateral, MUSD for repay)", "0.0035");
    r = await tx(owner, "Withdraw collateral");
    step(`withdraw collateral from Deed #${id3} to bring it under the public rescue line`, r.verdict === "ok", r.text);
    await tamper(taker, "skew");
    await taker.goto(BASE + "/rescue", { waitUntil: "domcontentloaded" });
    await taker.getByText(`Deed #${id3}`, { exact: true }).first().waitFor({ timeout: 90000 });
    await settle(taker, 3000);
    await shot(taker, "rescue-atrisk-paused");
    step(
      "price source out of range: the page says so and Start rescue is disabled",
      (await taker.getByText(GUARD_MESSAGE, { exact: true }).first().isVisible()) &&
        (await taker.getByRole("button", { name: "Start rescue auction", exact: true }).first().isDisabled()),
    );
    await taker.unroute(RPC_GLOB);
  }

  // 8. owner started auction on Deed #2, other wallet wins it
  await owner.goto(BASE + "/position/2", { waitUntil: "domcontentloaded" });
  await owner.getByRole("heading", { name: "Rescue auction" }).waitFor({ timeout: 60000 });
  await fill(owner, "Floor (% of equity, 80 to 100)", "80");
  await fill(owner, "Duration (hours)", "1");
  r = await tx(owner, "Start auction");
  step("owner starts an auction on Deed #2", r.verdict === "ok", r.text);
  await taker.goto(BASE + "/rescue", { waitUntil: "domcontentloaded" });
  await taker.getByText("Deed #2", { exact: true }).first().waitFor({ timeout: 90000 });

  // 1) the page notices a skewed DEX price before anyone signs
  await tamper(taker, "skew");
  await taker.reload({ waitUntil: "domcontentloaded" });
  await taker.getByText("Deed #2", { exact: true }).first().waitFor({ timeout: 90000 });
  await settle(taker, 3000);
  await shot(taker, "rescue-bid-paused");
  step(
    "price source out of range: the page says so and Bid is disabled",
    (await taker.getByText(GUARD_MESSAGE, { exact: true }).first().isVisible()) &&
      (await taker.getByRole("button", { name: "Bid at current price", exact: true }).first().isDisabled()),
  );
  await taker.unroute(RPC_GLOB);

  // 2) the contract guard trips while the page still thought all was well: friendly text, not a raw revert
  await tamper(taker, "revert");
  await taker.reload({ waitUntil: "domcontentloaded" });
  await taker.getByText("Deed #2", { exact: true }).first().waitFor({ timeout: 90000 });
  r = await tx(taker, "Bid at current price");
  await shot(taker, "rescue-bid-guard-revert");
  step("a SpotDeviation revert on the top-up read shows the friendly message", r.verdict === "err" && r.text.includes(GUARD_MESSAGE), r.text.slice(0, 120));
  await taker.unroute(RPC_GLOB);
  await taker.reload({ waitUntil: "domcontentloaded" });
  await taker.getByText("Deed #2", { exact: true }).first().waitFor({ timeout: 90000 });

  r = await tx(taker, "Bid at current price");
  step("winner bids from the UI (approve, top-up, bid in one flow)", r.verdict === "ok" || r.verdict === "detached", r.text);
  step("chain: Deed #2 now belongs to the bidder", (await ownerOf(2)).toLowerCase() === wallets.taker.address.toLowerCase());
  } // end of the auction section

  // CLAIM=1 with REST=1 runs just the payout claim
  if (!REST || process.env.CLAIM === "1") {
  await owner.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await owner.getByRole("button", { name: /Claim .* \(auction\)/ }).waitFor({ timeout: 60000 });
  await shot(owner, "proceeds-auction");
  r = await tx(owner, (await owner.getByRole("button", { name: /Claim .* \(auction\)/ }).first().innerText()).trim());
  step("previous owner claims the auction payout", r.verdict === "ok", r.text);
  } // end of the claim step

  // 9. list and cancel
  await owner.goto(BASE + `/position/${id3}`, { waitUntil: "domcontentloaded" });
  await owner.getByRole("heading", { name: "Sell at a fixed price" }).waitFor({ timeout: 60000 });
  await settle(owner);
  if ((await owner.getByRole("button", { name: "Cancel listing", exact: true }).count()) === 0) {
    await fill(owner, "Price (MUSD)", "60");
    await fill(owner, "Promised min ICR (%)", "115");
    await fill(owner, "Listing length (days)", "1");
    r = await tx(owner, "List for sale");
    step(`list Deed #${id3} from the UI`, r.verdict === "ok", r.text);
    await owner.reload({ waitUntil: "domcontentloaded" });
    await owner.getByRole("button", { name: "Cancel listing", exact: true }).waitFor({ timeout: 60000 });
  } else {
    step(`Deed #${id3} is already listed by an earlier run, the page shows the listing and a Cancel button`, true);
  }
  step("a listed position greys out the vault actions", await owner.getByRole("button", { name: "Add collateral", exact: true }).isDisabled());
  r = await tx(owner, "Cancel listing");
  step("cancel the listing from the UI", r.verdict === "ok", r.text);
  step("chain: the cancelled Deed is unlocked", (await pub.readContract({ address: dep.deedNFT, abi, functionName: "lockedBy", args: [id3] })) === "0x0000000000000000000000000000000000000000");

  // 10. phone width
  const phone = await session(browser, "owner", { width: 390, height: 800 });
  await connect(phone);
  await phone.goto(BASE + "/market", { waitUntil: "domcontentloaded" });
  await settle(phone, 3000);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await shot(phone, "mobile-market");
  step("phone width has no horizontal scroll", overflow <= 1, `overflow ${overflow}px`);

  await browser.close();
}

main()
  .catch(async (e) => {
    step("script stopped early", false, e.message.split("\n")[0]);
    for (const [i, p] of pages.entries()) await p.screenshot({ path: `${SHOTS}/fail-${i}.png`, fullPage: true }).catch(() => {});
  })
  .finally(() => {
    const failed = results.filter((r) => !r.ok);
    const out = { results, txs, consoleErrors: [...new Set(consoleErrors)].slice(0, 40) };
    fs.writeFileSync(`${SHOTS}/ui-pass.json`, JSON.stringify(out, null, 2));
    console.log(`\n${results.length - failed.length}/${results.length} checks passed, ${txs.length} UI transactions, ${out.consoleErrors.length} distinct console errors`);
    process.exit(failed.length ? 1 : 0);
  });
