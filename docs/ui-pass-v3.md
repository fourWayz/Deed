# UI pass v3

Browser test of the frontend on the **v3 deployment** (Mezo testnet 31611, `deployments.json`, merged from `feat/contracts-v3`).
Headless Chromium, wallets bridged from Node (the page gets a plain EIP-1193 provider, signing happens in the script, keys come
from `.env` and are never printed). Script: `scripts/ui-pass-v3-live.mjs`. One new position, **Deed #4**, goes through its whole
life with every step clicked in the UI. The first pass (against v2) is kept as an appendix at the end.

## Release candidate pass (13 Nov 2026)

Second v3 pass, on the live indexer (`https://deed-lovat.vercel.app`, `NEXT_PUBLIC_INDEXER_URL`) and with two fresh positions. The
indexer now follows v3, so the chain-count workaround is gone: every stat comes from the indexer, and the chain scan runs only when
the API cannot be used (down, slow, wrong shape, or not following the current deployment). Raw results: `docs/ui-pass-v3-rc-a.json`
(Deed #5), `-rc-d.json` (Deed #6), `-rc-surplus.json`, `-rc-surplus6.json`, `-rc-stats.json`.

**Short version: open, borrow, refinance, list, buy and the claims ran green on two fresh positions. The rescue start, bid and close
did not run on a fresh position, because a testnet redemption bot redeemed both positions within 3 to 4 blocks of the withdraw that
made them rescuable.** That is a result about the testnet, not a UI fault, but it means the rescue-start, bid and close buttons were
not clicked again in this pass. Their last UI run is Deed #4 in the section below.

### What the two fresh positions did

| Step | Deed #5 | Deed #6 |
| --- | --- | --- |
| open from the wizard (0.04 BTC, 1800 MUSD) | `0xc0077aabec468bc01d10aa03bcb4b2ce2fb5f9dc2045486e0278e8ef7dfceba0` | `0x18d59a7bab84088e81594d4ed21161c5d26f0d3c8a4b60ac6b10725e8969f17b` |
| borrow 50 MUSD | `0x69048317747e1334a5ad5777341d78f158d50a6325b7d70c9a66978d9c7b7ed4` | `0x274847e313f262afd0267075edbd69231a568bf61caea88c18151aa1830c8794` |
| refinance | `0xf5b6554d11a04f3229ae62a0f5b5256d0b82c036a0207d642aca4e45163c87f1` | `0x85ee171effcdf2f870759e18a04160d667d5ccbd4633d168214a9807f5936a78` |
| list for 50 MUSD, default ICR untouched (137% on #5) | `0x18a4b2c45219decb21e0d44e4c5d6f1115e9b2bb4f2649c2758858acf9dd9883` | `0xe2b4428ad35d528c5db4bdd9e7bd3a7ef9cef8946f3aa4ece836f528aaa0fb1e` |
| **buyer approves MUSD for the market** | `0xc7ca732e3230d2c6e2c84d69d56d61b2113dad534f48093397073fd25657d30b` | `0xfb8803c03c6b3a9417367e23fdcd0aa87cb9d5878ccc1588dd6ea90b2ccd32df` |
| buy | `0xc1d5cfce334edb7e927b83c26a9f19fe7ecde31e1353dfb4a31b62b0608d1a3b` | `0x59dcb23e6e0de23d4ada6b78a3397772c6015979dd83f08e05f30e589a55d624` |
| seller claims 49.75 MUSD | `0x3fce76c02d87ec4873f2998a06f2fbb9e6d70a75df090983f4a9987f310e0f24` | `0x12d2a83f80c86431072babae70ccc76ffb8213e465cc09c6700e13788fcda0bd` |
| buyer withdraws collateral to 117% ICR | `0x786874fd432c0f182118c9b2627e2058a897b464d98a7868d7fb175cb4a14202` (block 16757667) | `0x3d593e7e7f531c94a2169faea5227a5aaca2abf9d78eac02c7c413341f48f68a` (block 16758318) |
| **redeemed in full by a third party** (not ours) | `0x6571a3bc16550cfdb58e196751c8f83d7621f10dabdb646ba47bc24db19a0cc3` (block 16757670, 3 blocks later) | `0x7731a6138212cf50933c4acf21d93d6af501ef0c6ad4f95d45c5d0469f9a1863` (block 16758322, 4 blocks later) |
| holder claims the surplus from the UI | `0x8317e853b7166aee98f97eddef6e9dc6948467939198526082c5ce7afb5e4c79` | `0x4b849f5b48b123f74e8362a8e2d4e432a3b424ad1079eace05ba1557d4d29168` |

Every transaction of the pass is in this table, including the buyer's approval, because the script now writes each hash to the log
and to the results file the moment it is sent. The redemptions come from `0xd13f…6c67`, the same address `docs/demo.md` records
redeeming Deed #3.

### The surplus claim now has a real run

This was the one path that could not be tested before. Both positions were redeemed completely, so the holder had surplus, and the
UI paid it out: the position page said "Closed by a redemption" and offered **Claim 0.00803 BTC** (the lens amount); after the click
the lens surplus was 0 and the wallet had received 0.008033 of the 0.008033 BTC (less gas); after a reload the page said
"Nothing to claim" with the button disabled. The same sequence passed on Deed #6 (0.008001 BTC). So the "claim surplus that pays out"
item moves from "could not test" to tested, twice.

### The three assertions that never had a green run

| Assertion | Result |
| --- | --- |
| market card shows the buyer's fee line and the equity comparison | **green** on Deed #5 and Deed #6 (`You pay 50.00 MUSD. 0.25 MUSD of it is the protocol fee…`) |
| wizard step 3 shows "is listed" | **green** on Deed #5 and Deed #6 |
| auction card shows floor, time left, winner target ICR and the bid fee line | **still no green run.** It needs a live rescue auction, and both fresh positions were redeemed before one could start. |

The wizard and market failures from the first v3 pass were test bugs (the page text was right); the new runs show that.

### Why the rescue could not run, and what was tried

The bot redeems the lowest-ICR trove in the system within a few blocks, and a position pushed under 120% is the lowest. The
sorted list's bottom today is a crowd of other users' troves at about 120% (lowest 119.89%), so there is nothing below 117% to
absorb it. Deed #4 survived the same 117% step earlier, so the bot is not constant. What was tried: the rescue page opened and
connected before the withdraw and the start click straight after it (still too slow, the lens read right after the withdraw
already said "redeemed"), and a retry on a second fresh position. What was not tried: a withdraw target just above the lowest other
trove (`RESCUE_ICR=119.93` is in the script), because it needs about 0.03 BTC moved from one test wallet to the other so the
opener has the 0.05 BTC the wizard asks for, and that transfer was blocked by the session's permission check. I did not look for a way around it.

### Stats, indexer and labels

- **Totals source.** Landing and Activity read `/stats` and `/activity` from the indexer. The page says "Totals come from the Deed
  indexer" and "Last synced N ago" (from `lastSyncedAt`). v2 shows as "Earlier deployment (v2): 3 positions, 1,889.22 MUSD volume",
  which matches an independent v2 chain scan.
- **Label.** "Testnet activity from the team's test wallets." sits on every stats block until a wallet outside
  `NEXT_PUBLIC_TEAM_WALLETS` shows up in the indexer's positions or activity. That rule has a unit test (`lib/outsider.test.ts`);
  the label going away has not been seen in a browser because no outside wallet exists yet.
- **Against `indexer/scripts/chain-scan.mjs`.** At the start of the session, indexer `/stats` and the scan matched on every field
  (7 positions, 12 listings, 4 sales, 5 auctions, 4 rescues, 2 wallets, volume 3126.730579642058144555, fees 6.187563853191175201).
  During the pass **the indexer's sync stalled at block 16755791 (13:57 UTC on 13 Nov, still there about 4.5 hours later when the pass ended)**, while
  the chain moved on with Deeds #5 and #6. The scan then read 9 positions, volume 3226.73 and fees 6.6876, the indexer 7, 3126.73
  and 6.19; the difference is exactly the two 50 MUSD sales. So the "pages equal chain-scan" check could not be satisfied at the
  end, and the pass compared the pages with the indexer's own `/stats` (they matched) and recorded the gap here. The indexer's
  GitHub Actions cron needs a look.
- **Behind note.** Because a stalled sync makes every total too low, the page now says "The indexer is behind, so the newest
  activity is not in these totals yet" when the last sync is older than 30 minutes.
- **Behind note, verified.** A re-run of the stats phase on the rebuilt app (`-rc-stats2.json`, 11 of 11) showed the note with a sync 5 hours old; the
  fresh-sync case is covered only by the assertion's other branch, not seen live.
- **Indexer down.** With the API blocked, the page counted this deployment from the chain (6 positions, 1,337.51 MUSD, fees 6.69),
  equal to an independent scan, and said the indexer did not answer.

## Earlier v3 pass (Deed #4)

Three runs, because the script was resumed after test bugs, not app bugs, stopped it. Raw logs: `docs/ui-pass-v3-live-run1.log`,
`docs/ui-pass-v3-live-run2.json`, `docs/ui-pass-v3-live-run3.json`.

| Run | Phases | Passed | Failed |
| --- | --- | --- | --- |
| 1 | routes, landing, empty wallet, open, borrow, refinance, list, buy, claim | 39 | 4, all test bugs, see below |
| 2 | Recovery Mode, rescue, bid, claims, close, closed states, stats | 23 | 4, all test bugs, see below |
| 3 | closed states, error states, stats and indexer fallback, activity | 10 | 0 |

The failures and what they were:

- Run 1: the wizard "is listed" check ran before the page refreshed; the market card check matched `Equity vs price` but the page
  uppercases it with CSS; the buy and claim buttons were counted as failed because their card disappears after a success
  (the chain checks right after them passed). The script then crashed while rewriting a DeedLens struct for the Recovery Mode simulation.
- Run 2: the auction card check had the same uppercase problem (`Floor`, `Time left`, `Winner leaves ICR`); three checks ran before
  positions finished loading; my independent v2 event scan used the v3 event signatures and found no v2 sales.
- All were fixed in the script. Run 3 re-ran the phases that failed for timing or scan reasons and passed. **The market-card and the
  wizard-listed checks from run 1 and the auction-card check from run 2 were not re-run**, because the position had moved on and their
  state no longer exists. The page text that those checks matched is in the logs (`You pay 549.59 MUSD. 2.75 MUSD of it is the
  protocol fee...`), and the actions behind them were checked on chain, but there is no green run of those three exact assertions.

## Every transaction of Deed #4, from the UI

Hashes recovered from chain events (run 1's own record was lost when the script crashed). Gas limit sent by the page through
`useSafeWrite` was 700,000 on each transaction run 2 recorded (796,172 on the bid, which carries BTC).

| Step | Transaction |
| --- | --- |
| open from the wizard, 0.04 BTC and 1800 MUSD | `0x12e854e7e852e276decc875930647a9b71b44dcce72d80015067f6f587842d77` |
| borrow 50 MUSD | `0xd46d3e7d6a357615227c7f06b990303e160eb7c0584a6cfcd1654d57d4b3a4b6` |
| refinance | `0xbcdd35a384bd30d8213c7cf596ffa451d0528ad5d320e63d3da8a497b4eb9adc` |
| list for 50 MUSD with the untouched default ICR (142%) | `0x2acf3f411ecf608d8fa8db48ae46811039aee048042d8e9a97b5e298d149ac4b` |
| buy (a second wallet) | `0x4e4b1a1ed640725bef6bcbb0c3a4f5a42431436c1224f92a703795f12d561a61` |
| seller claims the 49.75 MUSD | `0x3331189ed6cda67b596386ca27494591a7072ebe130598637fefec0b0b99c0ac` |
| buyer withdraws collateral to 117% ICR | `0x328d1c26959bacbec1e188f3988bec65f705292b1ef04d5a023a24fec7adc59c` |
| a stranger starts the rescue auction | `0x09632ba8b6829cf1c3754f9912a996ba760b6f4fea346a48ac8e7ca0ece47cdf` |
| bidder approves MUSD | `0x03f97b3832ad726b1e05a861eda96ecdc35efdbf2787c2ad057e89a724e1f834` |
| bid (price 549.49 MUSD plus a BTC top-up, position ends at 150.36%) | `0xa49404f2d20c31f839be358984a47af010a6166dd29bacd8f2ddec02134507d9` |
| old owner claims the auction proceeds, 546.74 MUSD | `0x25b0ab511658c8dfcb21b73255f2c2fb0edb5973b2f39605cbc7a54ff7921593` |
| new holder approves the entire debt | `0x574ac49e2ed49c05e9630da1523d1348498309ae4168a652f90b30e965e22c90` |
| close | `0x7ff8e9f12195d3c01d7c40400c4127b92c7fd840e9f52ac027a381bfc64d9a76` |

The buyer's MUSD approval for the market purchase is not listed: its hash was only in run 1's lost record.

## What was checked against the chain, not just the page

- Borrow: wallet received exactly 50 MUSD and the entire debt rose by 50.05 (the 0.1% fee).
- Fee preview equals the contract: `feeFor(50) = 0.25`. Sale: seller credited 49.75, treasury 0.25.
- Rescue: price 549.4903, seller +546.7428, treasury +2.7475, which is exactly 0.5% and adds up to what the bidder paid.
- Close: panel said 1,852.22 MUSD (entire debt less the 200 MUSD deposit), DeedLens said 1,852.221; status became 2 and 0.04321 BTC
  came back to the wallet.
- The list form default ICR was 142% for a position at 142.68%, and the contract accepted it.
- Position page entire debt equals DeedLens (2001.80), and the breakdown rows add up to it.
- Stats (landing and activity) equal an independent event scan of v3: 4 positions, 2 wallets, 1,237.51 MUSD volume, 6.19 MUSD fees.
  Earlier deployment line equals an independent v2 scan: 3 positions, 1,889.22 MUSD volume, 0.00 fees.

## Other checks that passed

Every route at 1280px and 390px with no sideways scroll; RPC blocked shows a readable error with Retry; landing shows the fee rates and
treasury read from the contracts; wizard for an empty wallet (step 1 open, 2 and 3 locked) and a funded one (steps advance by themselves
after each transaction); empty states; the under-collateralised open form is disabled; closed and redeemed positions say
"Nothing to claim" with a disabled button; a position held by someone else shows no actions; activity lists recent transactions with
explorer links, newest first, with this run's sale and rescue.

Recovery Mode is **simulated**: the real system sits near 256% TCR. The test rewrites DeedLens' `system()` and `position()` answers
at the RPC (`recoveryMode` true, TCR 130%, `canWithdraw`, `canBorrow`, `canRefinance` false, `canClose` false and then true). With
that the banner and the disabled buttons follow the lens flags in both variants and fit at 390px. This proves the page follows those
lens fields. It does not prove the lens computes them correctly during a real Recovery Mode (the contracts session has fork tests for that).

## Could not be tested, and why

- **A claim that pays out surplus** is no longer on this list: the release candidate pass claimed real surplus through the UI on two positions (see above). The earlier
  v3 pass could not, which is why this entry stays in its history.
- **Close with pending redistribution debt.** It needs another trove to be liquidated while this one is open, which cannot be caused
  here. The close panel uses the lens's entire debt, which includes pending, and the contracts session has fork tests for it
  (`test/Redistribution.t.sol`). The breakdown's "pending" row was 0.00 in every live check.
- **The indexer with v3 in it, against the chain scan at the end.** The indexer is live and follows v3 (release candidate pass). Pages matched its
  `/stats`, and at the start of the session it matched `chain-scan.mjs` on every field. At the end its sync had stalled 4.5 hours, so the final
  equality with the scan could not hold and was not shown (details above).
- **Rescue start, bid and close on a fresh position** in the release candidate pass: both fresh positions were redeemed by a third party first.
- **The auction-card assertion** has still never had a green run.
- **The team label disappearing** in a browser: only the unit test covers it, no outside wallet exists yet.
- **Stale oracle.** The oracle is fresh on testnet, the stale branch was not triggered.
- **Price source guard.** The TWAP source was in range during the pass, so the "price source out of range" pause was not seen on v3.
  The same page code was tested by RPC rewriting in the v2 pass.
- **The Vercel preview itself.** Not deployed. See below.
- **Real browsers and wallets.** Headless Chromium and a bridged signer only. No MetaMask or WalletConnect, no phone.
- Demo video is still a placeholder.

## Vercel preview

`scripts/preview-build-check.sh` builds from a clean copy of `frontend/` with only `.env.example` (no `.env.local`, no `node_modules`) and
passed: all 9 routes built. Nothing was deployed and no Vercel account was touched. There is no Vercel CLI or linked project here.
Settings, preview-only env vars and the deploy commands are in `docs/vercel-preview.md`.

## Test environment notes

- The headless Chromium needed `libnss3`, `libnspr4` and `libasound2`, unpacked into a temp directory with `LD_LIBRARY_PATH`. Nothing was
  installed system wide.
- The session was interrupted between runs 2 and 3; the app server, the local indexer copy and the temp libraries were recreated and
  run 3 resumed from phase 7 on the same chain state.
- The treasury address is the deployer wallet, so the test wallets' balances were not the only ones moving.
- Screenshots from runs 1 and 2 were lost with the temp directory. `docs/ui-pass-v3/v3-*.png` come from run 3,
  `docs/ui-pass-v3/v2-pass/` from the first pass.

---

## Appendix: pass 1, against the v2 deployment (superseded)

Browser test of the frontend as it was before the v3 switch, against the **v2 deployment** (Mezo testnet 31611, addresses from `deployments.json`).
Headless Chromium, wallets bridged from Node (the page gets a plain EIP-1193 provider, signing happens in the script, keys
come from `.env` and are never printed). Script: `scripts/ui-pass-v2-archive.mjs` (no longer runs), raw results: `docs/ui-pass-v3-on-v2.json`.
Final run: **46 of 46 checks passed**, 2 real transactions sent.

## What was run live on chain

Both go through the page's `useSafeWrite` (the page sent an explicit gas limit of 700,000 on each, see `pageGas` in the json).

| Action | Transaction |
| --- | --- |
| list Deed #2 from the UI | `0xb859161a3c9827da6de94811b565af81c0b69b48523d65117003e410203904fd` |
| cancel that listing from the UI | `0x1f22568051232b4abeb7bd7b4c232e4f6689398727d86893f7411ac9b751933c` |

Earlier runs of the same script (while I fixed test bugs) sent a few more list and cancel transactions that are not in the
json, which only keeps the last run. Deed #2 ends unlisted.

## Checked and passing

- Every route (`/`, `/positions`, `/market`, `/rescue`, `/activity`, `/start`, `/position/1`) renders at 1280px and at 390px with
  no sideways scroll.
- Landing: problem sentence, track, the four target users, how it works, safety rules, fee disclosure, video placeholder.
- Live stats on the landing page match an independent scan of the chain events done in the test script: 3 positions, 2 wallets,
  volume 1,889.22 MUSD, fees 0.00 MUSD.
- Activity page: 12 recent transactions, each linking to a transaction on the explorer.
- Position page: entire debt equals TroveManager's `getEntireDebtAndColl` (2,002.84 vs 2,002.8362), and the breakdown rows
  (principal, interest, pending) add up to it. Health gauge renders.
- Fee preview on list and on the market card shows "no fee" on this deployment.
- Borrow preview shows the borrowing fee and the new ICR.
- Empty states (wallet with nothing), and the wizard for an empty wallet (step 1 open, 2 and 3 locked) and for a holder
  (step 2 done, step 3 shows the list form).
- RPC blocked: Market shows "Could not load positions: HTTP request failed." with a Retry button.
- An impossible withdrawal shows a sentence ("The contract refused this action: Arithmetic operation resulted in underflow or
  overflow."), not a selector.

## Recovery Mode: simulated, not observed

The real system is at about 259% TCR, nowhere near Recovery Mode (150%), so it cannot be triggered on chain. The test rewrites the
`checkRecoveryMode` and `getTCR` reads at the RPC to say 130%. With that:
the banner explains what is blocked; withdraw, borrow and refinance are disabled; add collateral and repay stay enabled; close
is disabled, which follows Mezo's `mintList` rule read live. The banner also fits at 390px. This proves the page reacts to those
two reads, not that the reads are right during a real Recovery Mode.

## Not tested, or not built

- **DeedLens.** No lens is deployed (the v3 contracts are still in progress on another branch). The page reads Recovery Mode from
  TroveManager directly, which is what `DeedLens.system()` does. A code path that uses `NEXT_PUBLIC_LENS` exists but has never
  run, and its ABI is copied from unmerged code.
- **Indexer.** None exists yet. Stats are read from chain events in 10,000-block windows (the RPC refuses more), which takes a
  few seconds and grows with the chain. Not wired to any indexer.
- **Fees.** The v2 contracts have no fee. The `feeFor` read and the fee lines for a non-zero fee are written against the in-progress
  v3 contracts and were never run. Switched on only by `NEXT_PUBLIC_VAULT_V3=1`.
- **Borrow and refinance transactions.** The v2 vault has neither function, so the buttons are disabled with an explanation. The
  v3 calls (`borrow`, `refinance`) are untested.
- **Open a position from the wizard, and the wizard's list step as a transaction.** The two test wallets hold about 0.004 and
  0.006 BTC, and a position needs roughly 0.03 BTC. The create flow was last exercised live by the earlier `ui-pass.mjs` run, not by this one.
- **Buy, bid, close, repay, claim surplus and claim proceeds as transactions** were not repeated in this pass. Deed #3 is closed
  and shows its surplus state ("Mezo is holding 0 …"), so there was no surplus to claim.
- Demo video is a placeholder, `NEXT_PUBLIC_DEMO_VIDEO` takes an mp4 or Vimeo player url but neither has been tried.
- Real mobile browsers and real wallets (MetaMask, WalletConnect). Only headless Chromium at 390px.
- The fee, lens and v3 switches are env only. Contract addresses are env only as asked.

## Test environment notes

- The headless Chromium needed `libnss3`, `libnspr4` and `libasound2` which were not installed; I unpacked them into a temp directory and
  pointed `LD_LIBRARY_PATH` at it. Nothing was installed system wide.
- The Mezo RPC timed out for a few minutes during the work, which broke one run; reruns were clean.

## Screenshots

`docs/ui-pass-v3/v2-pass/`: `m_.png` (landing at 390px), `m_recovery.png`, `recovery-banner.png`, `d_activity.png`, `wizard-empty.png`.
In full-page captures the sticky nav floats over the content, that is the capture, not the layout.
