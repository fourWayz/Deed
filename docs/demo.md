# Demo script

Two wallets on Mezo testnet, each with some test BTC. Wallet B also needs MUSD to buy with (open its own position
first and keep the borrowed MUSD). Frontend running with the deployed addresses in `.env.local`.

## 1. Open a position (wallet A)

- My Positions, enter `0.1` BTC and `2000` MUSD. The form shows the ICR before you sign.
- Confirm. A new Deed appears under "Your Deeds". The vault holds the trove, the 2,000 MUSD is in wallet A.

Say: the trove belongs to a vault, and the Deed is the key to it.

## 2. List it (wallet A)

- Open the Deed, "Sell at a fixed price": price `1500` MUSD, min ICR `150`, 3 days. List.
- Point out the notice that the vault is frozen. Try "Withdraw collateral": it is disabled, and the contract
  would revert too.

## 3. Buy it (wallet B)

- Market tab. The listing shows collateral, debt, ICR, rate, equity vs price and the countdown.
- Click Buy. The app approves MUSD if needed, then sends `buy` with the snapshot hash it computed from the position.
- The Deed moves to wallet B. In My Positions wallet B now manages the vault; wallet A can't.
- Wallet A: "Sale proceeds waiting" appears, claim it. Payment is pulled, not pushed.

Optional proof of buyer protection: as wallet A, cancel a second listing, add 1 wei of collateral, relist at the same
price, then buy from B with the old page still open. The transaction reverts with `SnapshotMismatch`.

## 4. Rescue auction

On testnet the BTC price can't be crashed on demand, so use one of these:

- **Owner-started** (works any time): wallet B opens the Deed, "Rescue auction", floor 50%, 1 hour, Start.
- **Public rescue** (needs a position under the rescue line, 130% in the default deploy): open a position near the
  minimum collateral, for example `0.0225` BTC against `1800` MUSD at about 80k, and wait for the price to move,
  or use the local fork test `RescueAuction.t.sol` which drives the price.

Then:

- Rescue tab. The auction shows a live price counting down, the floor, time left and the ICR the winner must reach.
- Wallet A clicks "Bid at current price". The app computes the BTC top-up with `requiredTopUp`, approves MUSD,
  and sends the bid with the BTC.
- The Deed moves to wallet A, the position leaves above the safe ICR, wallet B claims the MUSD.
- If nobody bids, after the duration anyone can "End auction" and the Deed goes back to the seller.

---

# Live run on Mezo testnet

Run with `scripts/e2e.mjs` against the deployed contracts, two wallets (seller `0x522bC0c3919fF823173ca4145feEcE905F772ffE`,
buyer `0xeF05aCAdf5d3fF7e8E5F0BE2515F2BE351e225A6`). Every transaction below is on chain, links go to
`https://explorer.test.mezo.org/tx/<hash>`. Raw data: `docs/e2e-results-market.json`, `docs/e2e-results-rescue.json`.
Reverted rows are real transactions that were sent with a fixed gas limit so the failure is recorded on chain.

Oracle at start of the run: 81,200 MUSD per BTC. Tigris pool spot: 78,686 (3.1% under).

## Deploy

| Step | Tx |
| --- | --- |
| PairSpotPrice (wraps the Tigris pool) | `0x573a5db30fad7dccdad5a8855cb7eb8dceec76129c2cfedbb032c90212e1e533` |
| DeedNFT | `0xe247d59a3fb7cdd46cce2559ea687e8c638c21ad0bd0dce9d9455207a2181a62` |
| DeedFactory | `0x67112477897db81a5d744f169da0ff6c53ba5966dc697565114677c59d5c024a` |
| DeedMarket | `0x6ec4802453d9e20517508f2a26188f205caf28bcf16030955fa5224c9d6510a7` |
| RescueAuction | `0xdfa4407c66419d4a7b9e3ed5afac5e35ff68291fab15faa1e811ca99b02f0b49` |
| `DeedNFT.init` (same broadcast) | `0x10376c9e95efe8e7948b44fa66ab6123fd740df7f6869462f41f9991e327cecc` |

A second `init` reverts with `AlreadyInitialized` (`0x0dc149f0`) and a call from anyone but the deployer with `NotDeployer`
(`0x8b906c97`), both checked with `eth_call` against the live contract.

## Position A: fixed price market (Deed #1)

Opened with 0.039445 BTC against 1,800 MUSD (debt 2,001.80 MUSD with fee and gas compensation), ICR 159.99%.

| Step | Result | Tx |
| --- | --- | --- |
| seller opens position A through the factory | ok | `0xf76fa14d12ddede23ebb2f51aefce2fb6337a2f42d84ae739a682541ef893d6b` |
| seller sends 1,000 MUSD to buyer | ok | `0x08df62a58b8f917215c3e9c8e31446b0855b5246d6e37e30b5ccc097fe3cbab6` |
| **Expiry** seller lists with a 75 s expiry | ok | `0x06d81a7655c1202d4ee867dd59064d5d34a30be435fa2850c041af528ed85a23` |
| seller tries to transfer the listed Deed | reverts `Locked` | `0x4f38c3feb6ba1f17d5a5f203ada0b69fa4c3e1f563aaf71dc7a0c12713b5a4d8` |
| seller tries to withdraw from the listed vault | reverts `NotController` | `0x44939c3901f972c13cb6f32900a8fdfc9c7443c29b44e8b99917a5bdb3b5d09b` |
| buyer approves MUSD for the market | ok | `0x447f87f9080b07be30bb1bf8473100e07fb5754712131ab0fc8f291815935038` |
| buyer buys after expiry | reverts `Expired` | `0x77f78430e66e38f0b133abf581b8b40843a08dda92eceec125f7aea32105b7bc` |
| a stranger clears the expired listing | ok | `0xf988b3b815b5fe9c65de9846a16bd89819f44e3e18fd777322b653cad8ff65d1` |
| **Cancel** seller lists again (1 day) | ok | `0x70ca4f61c19c1f76df6fedb879139dfe7e173d0b72f5d6b643e31191aa90243f` |
| buyer cancels someone else's live listing | reverts `NotSeller` | `0x347e21a936faeb0868b1bfafeae0f592c55bef02e82980a9a0ad56c02b6611ed` |
| seller cancels | ok | `0x5931167365c7df3f049c2a0b28630bbac27123f8c989d87f504bb9e8a8915bfd` |
| buyer buys the cancelled listing | reverts `NotListed` | `0x977902e0c08c9b7d096e0a9ba8647068a960c8e6d7b051a432ef444d03f11fc2` |
| **Front-run** seller lists, buyer records the snapshot | ok | `0x467053183559454e374bd721a6510ab0f1ff053dd454d8fb0d74dec3e74e6aa4` |
| seller cancels | ok | `0x028fdd0cceeb6cc789808a82521b318f826818a59a07c6ac414c02eb1712ec02` |
| seller adds 0.0001 BTC of collateral | ok | `0xbf6f02fec0b49213d38b2808e112ffba8d77c81da5f61018c9a9c6590439857e` |
| seller relists at the same price | ok | `0x93f27e4785213f9c8ed606191f218f2bcd6afa9c049134f56a105526e678f096` |
| buyer buys with the snapshot they saw | reverts `SnapshotMismatch` | `0x9a2f885c1d5a3b2544b0529e9ef9668a9928276b167de14579e63acce5e14560` |
| buyer buys with `maxPrice` one wei too low | reverts `PriceTooHigh` | `0x25a1d407be1d633a692c55b4bf7897f76a343aa4cb45de5315014d653750b86b` |
| **Sale** buyer buys with the fresh snapshot (100 MUSD) | ok | `0x13712716bd1d2fd2bf61947383f87baf38c6c5e882a53c79c32bd87a001b3aaf` |
| seller claims the 100 MUSD | ok | `0xbe96de2d2b9448d2f829c7644f1c6b02b947ed6cb3791fb2b4d17b0b58ac2030` |
| old owner tries to withdraw | reverts `NotController` | `0x8cb221efe793c4328639043559f94f1c08803187fc63d93e512b211bf76d71d1` |
| new owner adds collateral | ok | `0x0b8f96800383655c55f3288b933e1b7e92c44a840022ada4ba0dfa819d673387` |

After the sale: `ownerOf(1)` is the buyer, the buyer's MUSD fell by exactly 100, the seller's rose by exactly 100.

## Position B: rescue auction (Deed #2)

Inputs and results, all read from the chain:

| | Before the bid | After the bid |
| --- | --- | --- |
| Collateral | 0.030926671269631068 BTC | 0.037002628983671257 BTC |
| Debt (principal + interest) | 2,001.800164295398364201 MUSD | 2,001.800242319853958011 MUSD |
| ICR | **125.56%** (rescue line 130%) | **150.22%** (safe line 150%) |
| Oracle price | 81,273.66 | 81,264.95 |

- Equity when the auction started: 710.73 MUSD (start price), floor 355.37 MUSD (50%), 6 hours.
- Bid after about 45 s: current price 705.11 MUSD, top-up sent 0.006075957714040189 BTC
  (`requiredTopUp` plus 1%).
- Seller payout: 704.99 MUSD, matches the seller's MUSD balance change exactly (the price had fallen a little more
  between quote and mining).
- Oracle pricing check: `equityOf` returned 711.651 MUSD, the oracle-based calculation gives 711.651 and a calculation
  with the DEX spot price would give 631.710. The contract uses the oracle; the DEX is only the deviation guard.

| Step | Result | Tx |
| --- | --- | --- |
| seller opens position B | ok | `0xeb0f9c3ff42557b5bcdc060b2b020f4e508cb0cf8c623ab289496626a868b94d` |
| buyer starts the rescue (anyone can, ICR under 130%) | ok | `0xf6df8ff0274777fe3b226f23f253979a9c1ad7ce94b7fa19d8152ac029125b8d` |
| seller touches the vault during the auction | reverts `NotController` | `0xbef023105136c4e6deeb91de8eed112d99f22b8beb3c8f9a0654963ee792e4da`, `0x51103bb98220997df5d7c38cc89abc4b9d61c181215250f1f4d210ae77f79224` |
| buyer approves MUSD for the auction | ok | `0xd344cda603fafe959289898a7588508dc03a7d63eb52a909307742d859913fdb` |
| buyer bids with half the needed top-up | reverts `StillRisky` | `0x85634216ac18da6bbe98a065df60e7d7348f4873783316c60575ddc74015e56c` |
| **buyer wins and tops up in one tx** | ok | `0xbe346c7859b16b5a9eb70c1ec9a2fe7bb75290aff998857bdda418a20dff8fcf` |
| seller claims the payout | ok | `0x051e01b100a0cc58e0c9955b7f115eb9d15f814c5fab1ede484cfa430b01bcca` |

Run notes: the first attempt of the rescue step failed in the script, not on chain. The "too small" bid was sent before
the buyer had approved MUSD, so it reverted on the allowance. The script was fixed to approve first and the run was resumed
from the already running auction. A second, mistaken resume also sent one extra 1,000 MUSD transfer from seller to buyer
(`0x3124590f3cebb2e980284baae1d61aa6b4e7ba864649b5352ddd12f00fd50090`) before it stopped.


---

# Browser pass

A real Chrome drove the production build of the frontend (served with the deployed addresses) through every route
and action. Each wallet is a plain EIP-1193 provider in the page whose signing happens in the Node test process, so no
key ever reaches the page. Scripts: `scripts/ui-pass.mjs`, `scripts/run-ui-pass.ps1`. Raw results:
`docs/ui-pass-full.json`, `docs/ui-pass-resume.json`. Screens were checked for the Market, Rescue (live countdown),
My Positions, position detail (error state, locked state) and a 390px phone width.

Run 1 (full): 26 of 29 checks passed. The 3 failures were test problems or findings listed below. Run 2 (resumed from the
chain state run 1 left, after the fixes): 13 of 13 passed. Transactions sent by the UI:

| Wallet | Call | Tx |
| --- | --- | --- |
| holder wallet `0xeF05…25A6` | market.cancel (clears a leftover listing before the run) | `0x0fec6165d0a3357fa10b23d8c84b4bf69bb257383cb550d576c85bcd28dcb8a4` |
| holder wallet `0xeF05…25A6` | vault.addCollateral | `0x96b784414d4824d81f5897d77e660a7375e74f3c9ea06f47b4658612c33a0c20` |
| holder wallet `0xeF05…25A6` | vault.withdraw | `0x8344f6eaf0615ca089dcab4311b05a7f3b645a20e18d90adb80b879d1f5d5b97` |
| holder wallet `0xeF05…25A6` | MUSD.approve (for the repay attempt) | `0x8ee73b74e69c893b66a64afff219b958d17452d63ca366d97f6efad36c45323b` |
| holder wallet `0xeF05…25A6` | market.list (Deed #1, 50 MUSD) | `0x020b0c6cadde78cc735199d90ddb8d6f451101a4999302dfe7e590b7081d3597` |
| second wallet `0x522b…2ffE` | market.buy (second wallet) | `0x49e7ae1eea881cba1d35db27b79b2645e6aaf3c9da0943f9bae547628c37358d` |
| holder wallet `0xeF05…25A6` | market.claim (seller proceeds) | `0xe7fac871c7b26f645880f02a91612d733161c1d7be7838216c218c1e92e4bfe3` |
| holder wallet `0xeF05…25A6` | factory.createPosition (new Deed #3, 0.02931 BTC / 1800 MUSD) | `0x0b171042abb2d367b31f5afc89db5ab55a066c934b4095ede63f2a563f77fc1e` |
| second wallet `0x522b…2ffE` | auction.startRescue (from the At risk list) | `0xb8391268f94a1f3cf752a13c1d189204b57db3dd2e2053bd9e77bf6b46ea4957` |
| holder wallet `0xeF05…25A6` | auction.topUp (holder adds BTC during the auction) | `0x6f0cec92199b748700762bf7d48d3968ba411b2b8a15457a844b94e592db293a` |
| holder wallet `0xeF05…25A6` | auction.cancel (allowed once ICR is back over the line) | `0x1f521a6a59fc016a3d0a9a85a571c5afa7a1978c2b02b8f62d0b45f02e30a8d3` |
| holder wallet `0xeF05…25A6` | auction.start (holder starts an auction on Deed #2) | `0x92832ded9f51a5b530d9a14c09930a62dcc77bc0a36133046a2c3c521e187c27` |
| second wallet `0x522b…2ffE` | MUSD.approve (bidder) | `0x95af86c593ba16a9721304149a573974959cb09e6825579a0fc2addfed3f73d8` |
| second wallet `0x522b…2ffE` | auction.bid (bidder wins Deed #2) | `0x835948d2d7021f4caabc1501cf4e0e5f0ff62bd8550c43bc77260d22950c1e68` |
| holder wallet `0xeF05…25A6` | auction.claim (previous holder takes the payout) | `0x57079b610965e0364a3cec543e449e4a5020985c42dcff7a3f0d2a1d7d8fbfa6` |

Resume run:

| Wallet | Call | Tx |
| --- | --- | --- |
| holder wallet `0xeF05…25A6` | market.list (Deed #3, 60 MUSD) | `0x87525af0aa72ab0c6ab89f4dc7db1a61cffa50153dcceac8fb33162bafbacd99` |
| holder wallet `0xeF05…25A6` | market.cancel | `0xfd8a92323a2a3e3a6991e024511330fee062eb098c5dd6b92daedaf36765a032` |

Checked and passing: all four routes render with no wallet; connect through the modal with an injected wallet; My Positions
shows the held Deeds with live numbers; add collateral, withdraw, repay (with approval), list, buy (with approval), claim
proceeds, open a position, start a rescue from the At risk list, the price counting down on screen, an owner top-up during
an auction, owner start/bid/claim on a second auction, cancel listing, locked-state notice and disabled actions, an
impossible withdrawal showing a readable error, and no horizontal scroll at 390px.

Findings fixed during the pass:

- **Out-of-gas on buy.** Mezo's RPC sometimes answers `eth_estimateGas` with just the 21k base cost. The first UI buy was sent
  with 28,506 gas and ran out of gas on chain (`0x1ca3f741543bb0798f05750c32ede482adc200d80eae40d057b3a056dc551195`).
  `scripts/estimate-probe.mjs` reproduces it. The frontend now simulates first, takes the largest of three estimates and
  never goes under a floor (`frontend/lib/useSafeWrite.ts`). `scripts/e2e.mjs` got the same treatment.
- **No way to connect an EVM wallet.** Mezo Passport's default wallet list is Bitcoin wallets and WalletConnect only. An
  injected wallet entry was added.
- **Raw error selectors** (for example `0x3d693ada`) were shown to users. Custom errors are now in the ABIs and map to plain
  messages.
- **The claim confirmation disappeared** with the panel after a successful claim. It stays now.

Not tested: a real browser-extension wallet (MetaMask, Unisat, OKX, Xverse) and the Passport Bitcoin sign-in, WalletConnect
(the `deed-dev` project id is a placeholder, the console shows 403 and 400 from WalletConnect for it, a real id from
cloud.walletconnect.com is needed), the "End auction" button (it only appears after the auction has run out, 1 hour at the
least), "Close position" and "Claim surplus" from the UI (destructive or needing a liquidation), Safari and Firefox.
