# UI pass v3

Browser test of the v3 frontend against the **v2 deployment** (Mezo testnet 31611, addresses from `deployments.json`).
Headless Chromium, wallets bridged from Node (the page gets a plain EIP-1193 provider, signing happens in the script, keys
come from `.env` and are never printed). Script: `scripts/ui-pass-v3.mjs`, raw results: `docs/ui-pass-v3.json`.
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

`docs/ui-pass-v3/`: `m_.png` (landing at 390px), `m_recovery.png`, `recovery-banner.png`, `d_activity.png`, `wizard-empty.png`.
In full-page captures the sticky nav floats over the content, that is the capture, not the layout.
