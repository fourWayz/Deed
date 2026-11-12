# Video script (100 seconds)

Five beats of the on-chain flow plus an open and a close: open, list, buy, rescue, fees. Record on the live app with two
wallets on Mezo testnet. Numbers come from [docs/demo.md](demo.md). Hashes to flash on screen are in the same file, open
the explorer at `https://explorer.test.mezo.org/tx/<hash>`.

The hashes and numbers below are from the recorded live run, not from the take you film. A new take makes new
transactions (Deed #2 is already sold), so either quote the run's hashes as "from the live run" or swap in the new ones.

Before recording: both wallets funded from the faucet, wallet B holding MUSD, no listing left open from earlier runs.

**Fee beat caveat.** The deployed contracts have no fee, so beat 6 cannot show a fee being paid. Two honest options: (a) once
the Wave 2 market is deployed (TODO), show a real `Sold` event with a fee value and the treasury balance; (b) until then,
show the `MAX_FEE_BPS = 100` line in the source and the zero-fee sale, and say the fee is built but not deployed. Do not
mock a fee transaction.

| Time | Beat | Screen to show | Voice over | Proof on screen |
| --- | --- | --- | --- | --- |
| 0:00 to 0:10 | Problem | Title card, then the Mezo MUSD page or a trove with a wallet address on it | A Mezo loan is stuck to the wallet that opened it. You cannot sell it, and nobody can rescue it for you. | none needed |
| 0:10 to 0:25 | 1. Open | My Positions, enter 0.1 BTC and 2000 MUSD, the form shows the ICR, sign. A new Deed appears under Your Deeds | The loan lives in its own vault. The Deed is the key to it. | an open transaction in the explorer. The recorded e2e run's is `0x65846d8d885c6ec9d1a68d6f8d512594fdab507b9db51bbd6755ea6381b67ca1` (0.036 BTC against 1,800 MUSD, so the amounts differ from the ones typed in the form) |
| 0:25 to 0:40 | 2. List | Open the Deed, Sell at a fixed price, price and min ICR, List. Show the frozen notice, click Withdraw collateral, it is disabled | Listing locks the Deed. The seller cannot pull the collateral out from under the buyer. | the `Locked` and `NotController` reverts: `0x12d7d9eea2c8981d1c046923b61bb555d21ac9a1e03378a2374eca367c47fafa` and `0x182ed57207400ec63d2d972acf66d6f1f3aed964a9154bfbdb99ed6807667658` |
| 0:40 to 0:55 | 3. Buy | Switch to wallet B. Market tab, the listing with collateral, debt, ICR, equity vs price. Click Buy. The Deed moves, wallet A sees Sale proceeds waiting and claims | The buyer sends a snapshot of what they looked at. If the position changed, the sale reverts. | `buy` tx `0xbb246a80a735398532dee7da85c6544ada56650d3873cdc54e3ab8da59829e52`, and the `SnapshotMismatch` revert `0xb4bc01692c7006b55d80fe2b55d1fc44c5d61093d2e3da62b6fd419674c4f33d` |
| 0:55 to 1:15 | 4. Rescue | Rescue tab. A position at 116.99% ICR on the At risk list, Start rescue, the price counting down from 539.93 MUSD toward the 431.95 floor, Bid at current price | A position under 120% can be rescued by anyone. The winner pays the owner and adds BTC in the same transaction. | the `bid` tx `0x590116137db5d5980aee6c4f150a461aeeb6f85af52482f7cddc7fb2437731f5`, the ICR going 116.99% to 150.33% |
| 1:15 to 1:30 | 5. Result | Deed #2 now owned by the bidder. Old owner claims 539.41 MUSD | The owner got paid at oracle-based equity, the DEX only guards the price. | `equityOf` 540.154 vs a spot-based 480.859, from the e2e results |
| 1:30 to 1:40 | 6. Fees and close | See the caveat above. Then the address table from the README and the repo link | Fees are capped at one percent in the contract, with no owner to change them. | `MAX_FEE_BPS = 100` in the source, or a real `Sold` event once deployed (TODO) |

## Timing and cuts

- The table totals about 100 seconds. If it runs long, cut the countdown shot in beat 4 first, then the claim in beat 3.
- Keep the two reverts. They are the proof the rules are on chain and not in the page.
- Do not show the keeper, SDK, MCP or indexer. None of them is running (TODO). Mention Wave 2 only as "built next".
- Nothing recorded here may use a private key, a seed phrase or a `.env` file. Show wallet addresses only.

## Open items

- Demo video URL: TODO.
- Whether the fee beat uses a real deployed fee: TODO, depends on the Wave 2 deploy.
