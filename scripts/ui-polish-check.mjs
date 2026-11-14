// UI polish check: layout, focus, motion and the new components, against SIMULATED chain reads.
//   cd scripts && CHROME=<headless chromium> node ui-polish-check.mjs     (frontend served on http://localhost:3111)
//
// No transaction is ever sent: the bridged wallet refuses eth_sendTransaction. Position, listing, auction and pending-debt
// reads are rewritten at the RPC so every state of the position page, the market and the rescue page can be looked at even
// when the chain has no open position. So this checks the interface, it does not test the contracts. Results go to
// docs/ui-polish-check.json.
import fs from "node:fs";
import { chromium } from "playwright-core";
import { createPublicClient, decodeFunctionData, decodeFunctionResult, encodeFunctionResult, formatUnits, http, parseAbi, toFunctionSelector } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const dep = JSON.parse(fs.readFileSync(new URL("../deployments.json", import.meta.url)));
const BASE = process.env.UI_BASE ?? "http://localhost:3111";
const RPC = process.env.MEZO_TESTNET_RPC ?? "https://rpc.test.mezo.org";
const pub = createPublicClient({ transport: http(RPC, { retryCount: 6, retryDelay: 1500 }) });
const viewer = privateKeyToAccount(generatePrivateKey()); // a throwaway wallet, nothing on it, never signs
const A = "0x00000000000000000000000000000000000a0001";
const B = "0x00000000000000000000000000000000000a0002";
const C = "0x00000000000000000000000000000000000a0003";
const ZERO = "0x0000000000000000000000000000000000000000";

const results = [];
const notes = [];
const consoleErrors = [];
const step = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -  " + detail : ""}`);
  fs.writeFileSync(new URL("../docs/ui-polish-check.json", import.meta.url), JSON.stringify({ base: BASE, simulated: true, results, notes, consoleErrors: [...new Set(consoleErrors)].slice(0, 30) }, null, 2));
};

// ---------- simulated reads ----------
const lensAbi = parseAbi([
  "function position(uint256) view returns ((address vault, address holder, address lockedBy, uint8 status, uint256 collateral, uint256 principal, uint256 interest, uint256 debt, uint256 icr, uint16 rate, uint256 collateralValue, uint256 equity, uint256 surplus, uint256 price, uint256 tcr, bool recoveryMode, bool priceStale, bool canClose, bool canWithdraw, bool canBorrow, bool canRefinance))",
]);
const listingsAbi = parseAbi(["function listings(uint256) view returns (address seller, uint64 expiry, uint256 price, uint256 minICR, bytes32 snapshot)"]);
const auctionsAbi = parseAbi(["function auctions(uint256) view returns (address seller, bool byOwner, uint64 start, uint64 duration, uint256 startPrice, uint256 floorPrice)"]);
const tmAbi = parseAbi(["function getEntireDebtAndColl(address borrower) view returns (uint256 coll, uint256 principal, uint256 interest, uint256 pendingColl, uint256 pendingPrincipal, uint256 pendingInterest)"]);
const e18 = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;
const now = () => Math.floor(Date.now() / 1000);
const vaultOf = (id) => `0x00000000000000000000000000000000000b00${String(id).padStart(2, "0")}`;

// id -> what the page should see. Debt figures already include any pending share, like the real lens.
const SCENE = {
  1: { holder: A, icr: 1.42, principal: 1850, interest: 30, listed: true },
  2: { holder: B, icr: 1.17, principal: 1850, interest: 30 },
  3: { holder: C, icr: 1.12, principal: 1850, interest: 30, auction: true },
  4: { holder: viewer.address, icr: 1.35, principal: 1870, interest: 33, pending: [20, 3] },
  5: { holder: viewer.address, icr: 1.05, principal: 1850, interest: 30 },
  6: { holder: viewer.address, icr: 1.8, principal: 1850, interest: 30 },
};

const MC = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
]);
const idArg = (cd) => Number(BigInt("0x" + cd.slice(10, 74)));
const mocks = [
  {
    to: dep.lens, sel: toFunctionSelector("position(uint256)"),
    fn: (cd, real) => {
      const sc = SCENE[idArg(cd)];
      if (!sc) return real;
      const p = decodeFunctionResult({ abi: lensAbi, functionName: "position", data: real });
      const principal = e18(sc.principal), interest = e18(sc.interest), debt = principal + interest;
      const collateral = (e18(sc.icr) * debt) / p.price;
      const value = (collateral * p.price) / 10n ** 18n;
      return encodeFunctionResult({
        abi: lensAbi, functionName: "position",
        result: {
          ...p, vault: vaultOf(idArg(cd)), holder: sc.holder, lockedBy: sc.listed ? dep.market : sc.auction ? dep.auction : ZERO, status: 1,
          collateral, principal, interest, debt, icr: (collateral * p.price) / debt, rate: 100, collateralValue: value, equity: value - debt, surplus: 0n,
          recoveryMode: false, priceStale: false, canClose: true, canWithdraw: true, canBorrow: true, canRefinance: true,
        },
      });
    },
  },
  {
    to: dep.market, sel: toFunctionSelector("listings(uint256)"),
    fn: (cd, real) => (idArg(cd) === 1
      ? encodeFunctionResult({ abi: listingsAbi, functionName: "listings", result: [A, BigInt(now() + 190000), e18(2000), e18(1.4), "0x" + "00".repeat(32)] })
      : real),
  },
  {
    to: dep.auction, sel: toFunctionSelector("auctions(uint256)"),
    fn: (cd, real) => (idArg(cd) === 3
      ? encodeFunctionResult({ abi: auctionsAbi, functionName: "auctions", result: [C, false, BigInt(now() - 1500), 21600n, e18(600), e18(350)] })
      : real),
  },
  {
    to: dep.troveManager, sel: toFunctionSelector("getEntireDebtAndColl(address)"),
    fn: (cd, real) => {
      const vault = "0x" + cd.slice(34, 74);
      const id = Object.keys(SCENE).find((k) => vaultOf(k).toLowerCase() === vault.toLowerCase());
      if (!id) return real;
      const [pp, pi] = SCENE[id].pending ?? [0, 0];
      return encodeFunctionResult({ abi: tmAbi, functionName: "getEntireDebtAndColl", result: [0n, e18(SCENE[id].principal), e18(SCENE[id].interest), 0n, e18(pp), e18(pi)] });
    },
  },
];
const find = (to, cd) => mocks.find((m) => m.to.toLowerCase() === (to ?? "").toLowerCase() && cd.startsWith(m.sel));

async function installMocks(page) {
  await page.route("**/rpc.test.mezo.org/**", async (route) => {
    let body;
    try { body = JSON.parse(route.request().postData() ?? ""); } catch { return route.continue(); }
    const items = Array.isArray(body) ? body : [body];
    const plan = new Map();
    for (const it of items) {
      if (it.method !== "eth_call") continue;
      const p0 = it.params?.[0] ?? {};
      const data = p0.data ?? p0.input ?? "";
      if (data.startsWith("0x82ad56cb")) {
        const calls = decodeFunctionData({ abi: MC, data }).args[0];
        const hits = calls.flatMap((c, n) => (find(c.target, c.callData) ? [[n, c.callData, find(c.target, c.callData)]] : []));
        if (hits.length) plan.set(it.id, { multi: hits });
      } else if (find(p0.to, data)) {
        plan.set(it.id, { direct: [data, find(p0.to, data)] });
      }
    }
    if (plan.size === 0) return route.continue();
    const real = await route.fetch();
    const json = await real.json();
    const out = Array.isArray(json) ? json : [json];
    for (const o of out) {
      const pl = plan.get(o.id);
      if (!pl) continue;
      if (pl.direct) {
        o.result = pl.direct[1].fn(pl.direct[0], o.result ?? "0x");
        delete o.error;
        continue;
      }
      if (o.result === undefined) continue;
      const res = decodeFunctionResult({ abi: MC, functionName: "aggregate3", data: o.result }).map((r) => ({ ...r }));
      for (const [n, cd, m] of pl.multi) { res[n].returnData = m.fn(cd, res[n].returnData); res[n].success = true; }
      o.result = encodeFunctionResult({ abi: MC, functionName: "aggregate3", result: res });
    }
    await route.fulfill({ response: real, json: Array.isArray(json) ? out : out[0] });
  });
}

// ---------- browser plumbing ----------
let browser;
let approved = false;
async function wallet(method, params) {
  switch (method) {
    case "eth_requestAccounts": approved = true; return [viewer.address];
    case "eth_accounts": return approved ? [viewer.address] : [];
    case "eth_chainId": return "0x7b7b";
    case "net_version": return "31611";
    case "wallet_switchEthereumChain": case "wallet_addEthereumChain": return null;
    case "wallet_getPermissions": case "wallet_requestPermissions": return [{ parentCapability: "eth_accounts" }];
    case "eth_sendTransaction": throw new Error("This QA script never sends a transaction.");
    default: return pub.request({ method, params });
  }
}
async function session(width, height, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: opts.reduced ? "reduce" : "no-preference", hasTouch: width < 700 });
  await ctx.exposeFunction("__walletRequest", wallet);
  await ctx.addInitScript(() => {
    const ls = {};
    window.ethereum = {
      isMetaMask: true,
      request: ({ method, params }) => window.__walletRequest(method, params ?? []),
      on: (e, f) => ((ls[e] ||= []).push(f), window.ethereum),
      removeListener: (e, f) => ((ls[e] = (ls[e] || []).filter((x) => x !== f)), window.ethereum),
    };
    // layout shift score for the page, ignoring shifts right after input
    window.__cls = 0;
    window.__shifts = [];
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => {
        if (e.hadRecentInput) return;
        window.__cls += e.value;
        window.__shifts.push({ v: +e.value.toFixed(3), t: Math.round(e.startTime), n: (e.sources || []).slice(0, 2).map((x) => (x.node ? `${x.node.nodeName.toLowerCase()}.${String(x.node.className || "").slice(0, 24)}` : "?")) });
      })).observe({ type: "layout-shift", buffered: true });
    } catch {}
  });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 200)));
  page.on("pageerror", (e) => consoleErrors.push("pageerror " + e.message.slice(0, 200)));
  await installMocks(page);
  return page;
}
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
const loaded = (page) => page.waitForFunction(() => !document.querySelector(".card-skel, .skeleton, [aria-label='Loading']"), null, { timeout: 90000 }).catch(() => {});
const go = async (page, path) => {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 60000 });
  await loaded(page);
  await page.waitForTimeout(1800);
};
const text = (page) => page.locator("main").innerText();
const num = (s) => Number((s ?? "").replace(/[^\d.]/g, ""));

// PART=6 runs only that section (1 layout, 2 shell, 3 position, 4 market and rescue, 5 focus, 6 motion)
const part = (n) => !process.env.PART || process.env.PART.split(",").includes(String(n));
const ROUTES = ["/", "/positions", "/market", "/rescue", "/activity", "/start", "/position/4", "/position/5", "/position/1"];

async function main() {
  browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });

  // ----- 1. horizontal scroll and tap targets at three widths -----
  if (part(1)) for (const [w, h] of [[390, 844], [768, 1024], [1440, 900]]) {
    const page = await session(w, h);
    await connect(page);
    const bad = [];
    const small = [];
    for (const r of ROUTES) {
      await go(page, r);
      const o = await page.evaluate(() => {
        const over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const wide = [...document.querySelectorAll("body *")].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > window.innerWidth + 1 && getComputedStyle(e).position !== "fixed"; }).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 30)}`);
        return { over, wide };
      });
      if (o.over > 1) bad.push(`${r} ${o.over}px (${o.wide.join(", ")})`);
      if (w === 390) {
        const s = await page.evaluate(() =>
          [...document.querySelectorAll("button, a.btn, .chip, .nav-link, .bn-link, input, a.brand")]
            .filter((e) => !e.classList.contains("copy") && e.offsetParent !== null)
            .map((e) => ({ e, b: e.getBoundingClientRect() }))
            .filter(({ b }) => b.height > 0 && (b.height < 43.5 || b.width < 43.5))
            .map(({ e, b }) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 20)} ${Math.round(b.width)}x${Math.round(b.height)} "${(e.innerText || e.getAttribute("aria-label") || "").slice(0, 18)}"`),
        );
        if (s.length) small.push(`${r}: ${[...new Set(s)].slice(0, 4).join("; ")}`);
      }
    }
    step(`no horizontal scroll at ${w}px on ${ROUTES.length} routes`, bad.length === 0, bad.join(" | "));
    if (w === 390) step("390px: every button, chip, nav link and input is at least 44px each way (copy buttons extend theirs with a pseudo-element)", small.length === 0, small.join(" | "));
    await page.context().close();
  }

  // ----- 2. nav, shell, footer, network pill -----
  if (part(2)) {
    const m = await session(390, 844);
    await connect(m);
    await go(m, "/market");
    const vis = await m.evaluate(() => ({ bottom: getComputedStyle(document.querySelector(".bottom-nav")).display, links: getComputedStyle(document.querySelector(".links")).display, pill: document.querySelector(".net-pill")?.getAttribute("title") }));
    step("390px: bottom nav shown, top links hidden, network pill present", vis.bottom !== "none" && vis.links === "none" && /31611/.test(vis.pill ?? ""), JSON.stringify(vis));
    const d = await session(1440, 900);
    await connect(d);
    await go(d, "/market");
    const vd = await d.evaluate(() => ({ bottom: getComputedStyle(document.querySelector(".bottom-nav")).display, active: [...document.querySelectorAll(".nav-link.active")].map((e) => e.textContent), pill: document.querySelector(".net-pill")?.textContent, foot: document.querySelectorAll(".foot-link").length, current: document.querySelector('.nav-link[aria-current="page"]')?.textContent }));
    step("1440px: bottom nav hidden, Market is the active route (aria-current), pill says Mezo testnet 31611, footer lists the contracts", vd.bottom === "none" && vd.active.join() === "Market" && vd.current === "Market" && /Mezo testnet · 31611/.test(vd.pill ?? "") && vd.foot >= 6, JSON.stringify(vd));
    await d.context().close();
    await m.context().close();
  }

  // ----- 3. position page states (simulated) -----
  if (part(3)) {
    const page = await session(1440, 900);
    await connect(page);
    for (const [id, tone, re] of [[4, "good", /points above the 120% rescue line/], [5, "bad", /under the 110% liquidation line/], [2, "warn", /above liquidation, .* under the 120% rescue line/]]) {
      await go(page, `/position/${id}`);
      const n = await page.locator(".gauge-note").first();
      const cls = await n.getAttribute("class");
      const t = await n.innerText();
      const label = await page.locator(".gauge").getAttribute("aria-label");
      step(`position #${id} gauge: ${tone} zone, the distance is also written out, aria-label carries it`, cls.includes(tone) && re.test(t) && /Health: .*percent/.test(label ?? ""), t);
    }
    await go(page, "/position/4");
    const t4 = await text(page);
    const segs = await page.locator(".stackbar > span").evaluateAll((els) => els.map((e) => parseFloat(e.style.width)));
    const rows = (await page.locator(".breakdown > div b").allInnerTexts()).map(num);
    const debt = num(await page.locator(".health .big").innerText());
    step("position #4: debt split bar has three parts that add up to 100%, rows add up to the entire debt", segs.length === 3 && Math.abs(segs.reduce((a, b) => a + b, 0) - 100) < 0.5 && Math.abs(rows[0] + rows[1] + rows[2] - debt) < 0.02, `bar ${segs.map((x) => x.toFixed(1)).join("/")}%, rows ${rows.slice(0, 3).join(" + ")} vs ${debt}`);
    const dis = page.getByRole("button", { name: "Withdraw collateral", exact: true });
    const why = await dis.locator("xpath=following-sibling::div[contains(@class,'why')]").first().innerText().catch(() => "");
    step("a disabled action says why (Withdraw with no amount typed)", (await dis.isDisabled()) && /Enter an amount/.test(why), why);
    await page.getByText("Price (MUSD)", { exact: true }).locator("xpath=following-sibling::input").first().fill("50");
    await page.waitForTimeout(1500);
    const rc = await page.locator(".receipt").first().innerText().catch(() => "");
    const feeText = await page.locator(".fee").first().innerText();
    step("list form fee preview renders as a receipt (price, fee, you receive) and keeps the sentence", /Price/.test(rc) && /0\.25 MUSD/.test(rc) && /49\.75 MUSD/.test(rc) && /49\.75 MUSD/.test(feeText), rc.replace(/\s+/g, " "));
    // copy button
    const cp = page.locator(".copy").first();
    await cp.click();
    const copied = await page.waitForFunction(() => document.querySelector(".copy.copied") && /Copied/.test(document.body.innerText), null, { timeout: 3000 }).then(() => true, () => false);
    step("copy button confirms with a check mark and 'Copied'", copied);

    // transaction status: the wallet refuses to send, so the write ends in the failure state
    await page.getByText("Amount (BTC for collateral, MUSD for repay)", { exact: true }).locator("xpath=following-sibling::input").first().fill("0.001");
    await page.getByRole("button", { name: "Add collateral", exact: true }).click();
    const err = page.locator(".txline.err").first();
    await err.waitFor({ timeout: 60000 });
    const et = (await err.innerText()).replace(/\s+/g, " ");
    const steps = await err.locator(".tx-steps li").count();
    step("failed write: shared status shows the 3 steps, a plain message (no raw selector), Retry and Dismiss, inside a live region", steps === 3 && !/0x[0-9a-fA-F]{8}\b/.test(et) && (await err.getByRole("button", { name: "Retry" }).count()) === 1 && (await err.getByRole("button", { name: "Dismiss" }).count()) === 1 && (await err.evaluate((e) => !!e.closest("[aria-live]"))), et.slice(0, 140));
    await err.getByRole("button", { name: "Retry" }).click();
    const again = await page.locator(".txline.err").first().waitFor({ timeout: 60000 }).then(() => true, () => false);
    step("Retry runs the write again (and it fails the same way here)", again);
    await page.locator(".txline.err").first().getByRole("button", { name: "Dismiss" }).click();
    step("Dismiss removes the status", (await page.locator(".txline.err").count()) === 0);
    await page.context().close();
  }

  // ----- 4. market chips, auction card, empty states (simulated) -----
  if (part(4)) {
    const page = await session(1440, 900);
    await connect(page);
    await go(page, "/market");
    const mt = await text(page);
    step("market shows the listed position with a buyer receipt and the equity comparison", /Deed #1/.test(mt) && /Included: protocol fee/.test(mt) && /equity vs price/i.test(mt) && /You pay 2,000\.00 MUSD\. 10\.00 MUSD of it is the protocol fee/.test(mt));
    const pressed = async (n) => page.getByRole("button", { name: n, exact: true }).getAttribute("aria-pressed");
    await page.getByRole("button", { name: "Lowest price", exact: true }).click();
    step("sort chip toggles aria-pressed", (await pressed("Lowest price")) === "true" && (await pressed("Newest")) === "false");
    await page.getByRole("button", { name: "Ends within a day", exact: true }).click();
    await page.waitForTimeout(400);
    step("a filter that matches nothing shows an honest empty state", /No listing matches/.test(await text(page)) && /Showing 0 of 1 listing/.test(await text(page)));
    await page.getByRole("button", { name: "All", exact: true }).click();
    step("clearing the filter brings the card back", /Showing 1 of 1 listing/.test(await text(page)));

    await go(page, "/rescue");
    const rt = await text(page);
    const clock = await page.locator(".countdown").first().innerText();
    step("auction card (simulated): floor, time left as a fixed-width clock, winner target ICR and the bid receipt", /floor/i.test(rt) && /time left/i.test(rt) && /\d\d:\d\d:\d\d/.test(clock) && /winner leaves icr/i.test(rt) && /Included: protocol fee/.test(rt), clock.replace(/\s+/g, " "));
    step("rescue page lists the at-risk position and offers Start rescue auction", /Deed #2/.test(rt) && (await page.getByRole("button", { name: "Start rescue auction", exact: true }).count()) >= 1);
    const p1 = (await page.locator(".price-tick").first().innerText()).trim();
    await page.waitForTimeout(2200);
    const p2 = (await page.locator(".price-tick").first().innerText()).trim();
    step("auction price ticks down as time passes", num(p2) < num(p1), `${p1} -> ${p2}`);
    await go(page, "/positions");
    const mine = await text(page);
    step("My positions lists the three simulated Deeds the viewer holds", [4, 5, 6].every((n) => new RegExp(`Deed #${n}\\b`).test(mine)) && (await page.locator(".reveal .card").count()) === 3, `${await page.locator(".reveal .card").count()} cards`);
    await page.context().close();
  }

  // ----- 5. focus order and focus rings, every page -----
  if (part(5)) {
    const page = await session(1440, 900);
    await connect(page);
    const report = {};
    for (const r of ROUTES) {
      await go(page, r);
      await page.evaluate(() => document.activeElement?.blur());
      await page.mouse.click(2, 2).catch(() => {});
      const seq = [];
      for (let i = 0; i < 70; i++) {
        await page.keyboard.press("Tab");
        const d = await page.evaluate(() => {
          const e = document.activeElement;
          if (!e || e === document.body) return null;
          const b = e.getBoundingClientRect();
          const cs = getComputedStyle(e);
          const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== "none");
          const name = (e.getAttribute("aria-label") || e.innerText || e.getAttribute("placeholder") || e.getAttribute("title") || e.tagName).replace(/\s+/g, " ").slice(0, 28);
          return { name, tag: e.tagName.toLowerCase(), top: Math.round(b.top + window.scrollY), left: Math.round(b.left), ring, inDialog: !!e.closest("[role=dialog]") };
        });
        if (!d) break;
        if (seq.length && seq[0].name === d.name && seq[0].top === d.top && i > 3) break;
        seq.push(d);
      }
      const noRing = seq.filter((s) => !s.ring).map((s) => s.name);
      // focus should move down the page (or across a row); a jump of more than 300px back up means the DOM order is off
      const jumps = seq.filter((s, i) => i > 0 && s.top < seq[i - 1].top - 300).map((s) => s.name);
      report[r] = { stops: seq.length, first: seq.slice(0, 3).map((s) => s.name), noRing, jumps };
      step(`tab order ${r}: ${seq.length} stops, starts at the skip link, every stop shows a focus ring, no jump back up the page`, seq.length > 5 && /Skip/.test(seq[0].name) && noRing.length === 0 && jumps.length === 0, JSON.stringify({ first: report[r].first, noRing, jumps }));
    }
    notes.push({ focusOrder: report });
    await page.context().close();
  }

  // ----- 6. motion: reduced motion, layout shift -----
  if (part(6)) {
    const run = async (reduced) => {
      const page = await session(1440, 900, { reduced });
      await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
      await page.getByText("Positions opened").first().waitFor({ timeout: 150000 });
      await page.waitForTimeout(1500);
      const loops = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations === Infinity).length);
      const stat = (await page.locator(".strip .stat .v").allInnerTexts()).join(" | ");
      const cls = await page.evaluate(() => window.__cls);
      await go(page, "/position/6");
      const dash = await page.locator(".gauge path").nth(3).evaluate((e) => ({ off: parseFloat(e.style.strokeDashoffset), len: parseFloat(e.getAttribute("stroke-dasharray")) }));
      await page.context().close();
      return { loops, stat, cls, dash };
    };
    const rm = await run(true);
    const nm = await run(false);
    step("reduced motion: no looping animation anywhere on the landing page, numbers and gauge are at their final values", rm.loops === 0 && !/^0\b/.test(rm.stat) && rm.dash.off < rm.dash.len, JSON.stringify(rm));
    step("normal motion: the only looping animation is the slow backdrop drift (plus shimmer while loading)", nm.loops <= 2, `${nm.loops} looping, stats ${nm.stat}`);
    notes.push({ layoutShift: { landing_reduced: rm.cls, landing_normal: nm.cls } });
    step("layout shift on the landing page stays small (CLS under 0.1)", rm.cls < 0.1 && nm.cls < 0.1, `reduced ${rm.cls.toFixed(3)}, normal ${nm.cls.toFixed(3)}`);
    for (const r of ["/market", "/position/4", "/activity"]) {
      const page = await session(1440, 900);
      await connect(page);
      await page.goto(BASE + r, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 60000 });
      await loaded(page);
      await page.waitForTimeout(3500);
      const cls = await page.evaluate(() => window.__cls);
      const shifts = await page.evaluate(() => window.__shifts);
      notes.push({ layoutShift: { [r]: cls, shifts } });
      step(`layout shift on ${r} is under 0.1 after data loads`, cls < 0.1, `${cls.toFixed(3)} ${cls < 0.1 ? "" : JSON.stringify(shifts)}`);
      await page.context().close();
    }
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed, ${failed} failed`);
  const errs = [...new Set(consoleErrors)].slice(0, 15);
  if (errs.length) console.log("console errors:\n" + errs.join("\n"));
}
main().catch(async (e) => {
  console.error("check crashed:", e.message.split("\n")[0]);
  step("script finished without crashing", false, e.message.split("\n")[0]);
  await browser?.close();
  process.exit(1);
});
