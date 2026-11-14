# Video script (100 seconds)

Five beats of the on-chain flow plus an open and a close: open, list, buy, rescue, fees. Record on the live app with two
wallets on Mezo testnet. Numbers come from [docs/demo.md](demo.md). Hashes to flash on screen are in the same file, open
the explorer at `https://explorer.test.mezo.org/tx/<hash>`.

The hashes and numbers below are from the recorded live run, not from the take you film. A new take makes new
transactions (Deed #2 is already sold), so either quote the run's hashes as "from the live run" or swap in the new ones.

**Beat 4 and 5 are a replay, not a live run.** They show the rescue that already ran on v3 (Deed #2), taken from `docs/demo.md` on
`feat/contracts-v3` (the v3 run). Show its transactions in the explorer and say "from the recorded run" on screen. Do not stage
a new rescue on camera and present it as live: a fresh position at the rescue line may be redeemed before an auction can start (see
Q&A).

Before recording: both wallets funded from the faucet, wallet B holding MUSD, no listing left open from earlier runs.

**Fee beat caveat.** The Wave 1 contracts used in beats 1 to 3 have no fee. The v3 run in the contracts branch's `docs/demo.md`
records a 50 bps fee: a 100 MUSD sale paid the seller 99.5 and the treasury 0.5, and the rescue below paid 538.02 MUSD
as seller 535.33 plus fee 2.69. TODO: v3 is not in this branch's `deployments.json` or README address table yet, so confirm
the deployment and merge before showing v3 addresses. Do not mock a fee transaction.

| Time | Beat | Screen to show | Voice over | Proof on screen |
| --- | --- | --- | --- | --- |
| 0:00 to 0:10 | Problem | Title card, then the Mezo MUSD page or a trove with a wallet address on it | A Mezo loan is stuck to the wallet that opened it. You cannot sell it, and nobody can rescue it for you. | none needed |
| 0:10 to 0:25 | 1. Open | My Positions, enter 0.1 BTC and 2000 MUSD, the form shows the ICR, sign. A new Deed appears under Your Deeds | The loan lives in its own vault. The Deed is the key to it. | an open transaction in the explorer. The recorded e2e run's is `0x65846d8d885c6ec9d1a68d6f8d512594fdab507b9db51bbd6755ea6381b67ca1` (0.036 BTC against 1,800 MUSD, so the amounts differ from the ones typed in the form) |
| 0:25 to 0:40 | 2. List | Open the Deed, Sell at a fixed price, price and min ICR, List. Show the frozen notice, click Withdraw collateral, it is disabled | Listing locks the Deed. The seller cannot pull the collateral out from under the buyer. | the `Locked` and `NotController` reverts: `0x12d7d9eea2c8981d1c046923b61bb555d21ac9a1e03378a2374eca367c47fafa` and `0x182ed57207400ec63d2d972acf66d6f1f3aed964a9154bfbdb99ed6807667658` |
| 0:40 to 0:55 | 3. Buy | Switch to wallet B. Market tab, the listing with collateral, debt, ICR, equity vs price. Click Buy. The Deed moves, wallet A sees Sale proceeds waiting and claims | The buyer sends a snapshot of what they looked at. If the position changed, the sale reverts. | `buy` tx `0xbb246a80a735398532dee7da85c6544ada56650d3873cdc54e3ab8da59829e52`, and the `SnapshotMismatch` revert `0xb4bc01692c7006b55d80fe2b55d1fc44c5d61093d2e3da62b6fd419674c4f33d` |
| 0:55 to 1:15 | 4. Rescue (replay) | Explorer pages for the recorded v3 run, with a caption "recorded run, v3, Deed #2". The rescue start, then the bid. The Rescue tab can illustrate the idea but is not shown as this run | A position under 120% can be rescued by anyone. The winner pays the owner and adds BTC in the same transaction. | start `0x54d55873d048d6cfc2410c402184a9b28f22b5b9f00fa5cbf28aae36cdd7cdbf`, bid `0x8d6d412367d36476f4a62b101b87fb1651e757b65c27e031a5a23be19a38b872`, ICR 116.98% to 150.70% |
| 1:15 to 1:30 | 5. Result (replay) | The seller's claim and the treasury's claim from the same recorded run | The owner was paid from oracle-based equity, the price guard only checks it. | seller claim `0x3c47461f7f4859faeb7949974dd81657d1fb4d3e3bf58f9302626d54d4911aee` (535.33 MUSD), treasury claim `0x469033a71f617501f69ae34c58dccf45898c21f1b716f5f7147d623828c0c0d9` (2.69 MUSD), price paid 538.02 MUSD |
| 1:30 to 1:40 | 6. Fees and close | The recorded v3 sale: `0x483b9614a273e6a14f0ebb31b6bc4fce8b5ab498fa961efb38eb5c9c17da1f44` (100 MUSD, seller 99.5, treasury 0.5), then the address table and the repo link | Fees are capped at one percent in the contract, with no owner to change them. | the `Sold` fee in that transaction, `MAX_FEE_BPS = 100` in the v3 source |

## Timing and cuts

- The table totals about 100 seconds. If it runs long, cut the countdown shot in beat 4 first, then the claim in beat 3.
- Keep the two reverts. They are the proof the rules are on chain and not in the page.
- Do not film a new rescue and call it live. Keep beats 4 and 5 as the recorded run with the caption.
- Do not show the keeper, SDK, MCP or indexer. None of them is running (TODO). Mention Wave 2 only as "built next".
- Nothing recorded here may use a private key, a seed phrase or a `.env` file. Show wallet addresses only.

## Q&A notes

- **Does a rescue always get to run?** No. Three times on testnet a position that had just become the lowest-ICR trove was redeemed
  in full within a few blocks, before a rescue auction could run: Deed #3 `0x69783574d2229eba5ad2444e1da5c43832688a00b227a9ba906d3afc3233f3ec`
  (v3 `docs/demo.md`), Deed #5 `0x6571a3bc16550cfdb58e196751c8f83d7621f10dabdb646ba47bc24db19a0cc3` and Deed #6
  `0x7731a6138212cf50933c4acf21d93d6af501ef0c6ad4f95d45c5d0469f9a1863` (`docs/ui-pass-v3.md`). The holder claimed the surplus through the
  vault, but there was no rescue. Deed #4 at 117% was not redeemed, so it is not constant.
- **Who redeemed them?** We do not know and do not say. The transactions are on chain, the sender is not identified in our docs.
- **What is the fix?** Redemption-queue-aware rescue, on the README roadmap. Not designed or built.
- **So is the rescue demo real?** The rescue shown is a real run, replayed from its hashes. It was not repeated for the video.

## Open items

- Demo video URL: TODO.
- Whether the fee beat uses a real deployed fee: TODO, depends on the Wave 2 deploy.
