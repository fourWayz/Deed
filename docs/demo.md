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

- **Owner-started** (works any time): wallet B opens the Deed, "Rescue auction", floor 80% (the lowest allowed), 1 hour, Start.
- **Public rescue** (needs a position under the public line, 120% in the deployed auction): open a position at about
  117% ICR, for example `0.029` BTC against `1800` MUSD at about 80k (`scripts/e2e.mjs` does exactly this and then
  rescues it), or use `RescueAuction.t.sol`, which drives the price.

Then:

- Rescue tab. The auction shows a live price counting down, the floor, time left and the ICR the winner must reach.
- Wallet A clicks "Bid at current price". The app computes the BTC top-up with `requiredTopUp`, approves MUSD,
  and sends the bid with the BTC.
- The Deed moves to wallet A, the position leaves above the safe ICR, wallet B claims the MUSD.
- If nobody bids, after the duration anyone can "End auction" and the Deed goes back to the seller.

---

# Live run on the second deployment

Run with `scripts/e2e.mjs` against the contracts in `deployments.json` (london build, public rescue under 120%, floor 80%).
Two wallets: seller `0x522bC0c3919fF823173ca4145feEcE905F772ffE`, buyer `0xeF05aCAdf5d3fF7e8E5F0BE2515F2BE351e225A6`. Raw data: `docs/e2e-results.json`.
Reverted rows are real transactions sent with a fixed gas limit so the failure has a hash. Every hash is on
`https://explorer.test.mezo.org/tx/<hash>`. The run passed on its first attempt, 31 transactions.

Oracle 80684.75204, Tigris pool spot 78685.92.

## Deploy

| Step | Tx |
| --- | --- |
| PairSpotPrice | `0x4df74512cd9cfb4640c659df793b4ef37a04f5becc28d65f6b523b82a726855b` |
| DeedNFT | `0x21117144244d548a8bd8bae169c7db1bb013e70fee2d6025ce25c095c9b8b472` |
| DeedFactory | `0xa2e62948bc44f3a1fe6c02e9fce961947f454456440beaba183a013c6cf68be2` |
| DeedMarket | `0x5f29d196a6d05f63071f920b6e404c6715b547d295d20ae33d15c03e6e375084` |
| RescueAuction | `0x204c86713ea6f4cdff3381556dec1ef8c7706974c3ae3e6ee00fc607b450b74a` |
| DeedNFT.init (same broadcast) | `0x0dd54e0f94e5e89959cecf85e2019c05757b7a7def971eb3d1e8257534a4cc04` |

A second `init` reverts with `AlreadyInitialized` (`0x0dc149f0`), a stranger with `NotDeployer` (`0x8b906c97`), both checked with
`eth_call` on the live contract. Auction settings read back from the chain: public start under 120%, safe ICR 150%, floor
80% (`MIN_FLOOR_BPS` and `DEFAULT_FLOOR_BPS` both 8000), DEX limit 1000 bps.

## Rescue auction numbers (Deed #2)

| | Before the bid | After the bid |
| --- | --- | --- |
| Collateral | 0.029009747051688633 BTC | 0.037277837041676534 BTC |
| Debt (principal + interest) | 2001.8 MUSD | 2001.80008753963310525 MUSD |
| ICR | **116.99%** (public line 120%) | **150.33%** (safe line 150%) |
| Oracle price | 80729.88558 | 80724.50318 |

- Equity at the start: 539.93 MUSD, floor 431.95 MUSD, which is exactly 80%. The script asserts it.
- The winner topped up 0.008268089989987901 BTC and paid 539.48 MUSD. The seller was paid 539.41 MUSD (the price had fallen a little more between quote and mining), matching the seller balance change exactly.
- `equityOf` returned 540.154 MUSD, the oracle based figure is 540.154 and a spot based figure would be 480.859. The contract prices from the oracle.

## All transactions

| Result | Step | Tx |
| --- | --- | --- |
| ok | seller opens position A (market flow) | `0x65846d8d885c6ec9d1a68d6f8d512594fdab507b9db51bbd6755ea6381b67ca1` |
| ok | seller sends 1000 MUSD to buyer | `0x0e03ae5fb7784c0caebc2780dbf15d88f0a2b39bf701de2dc737345eb09964ce` |
| reverts `Healthy` | a stranger cannot start a public rescue on a healthy position (about 145%, the line is 120%) | `0x4bbce9f2719c8a415c8e871c24642e6f7b91f485617bc8e64e2a2b36c25ff0d5` |
| reverts `BadParams` | the holder cannot start an auction with a floor under 80% of equity | `0x8d1f9ec1e0db036a9b5fd4142eaeb4bebf2705caca8a140417f5c25e6748ca95` |
| ok | seller lists A with a 75s expiry | `0x8e9dcb3ab5b29b5dd031e545d7f393c38ef6ff0067a5f55e57faa48f22cf62ee` |
| reverts `Locked` | seller cannot move a listed Deed | `0x12d7d9eea2c8981d1c046923b61bb555d21ac9a1e03378a2374eca367c47fafa` |
| reverts `NotController` | seller cannot withdraw from a listed vault | `0x182ed57207400ec63d2d972acf66d6f1f3aed964a9154bfbdb99ed6807667658` |
| ok | buyer approves MUSD for market | `0x9574e68ed24053cbb9eb1b4e64c1a22f0ea05160d5f1a9047334639501b0ff02` |
| reverts `Expired` | buyer tries to buy an expired listing | `0xbc8a3d10966c752ba22e54d3bec894e48bf0add1522199fa3998d16293c18b8b` |
| ok | buyer (a stranger) clears the expired listing | `0x609dad4b326512aafb9028150a7404316c7242d5a9ce2b0ce0871c00f0e548aa` |
| ok | seller lists A again (1 day) | `0xaeef28233d90de1b6fbfb73ce7acf77db33d46bceb42e8648bad88e7233ed558` |
| reverts `NotSeller` | buyer cannot cancel someone else's live listing | `0x75e028a21b759542cc6dd23a054b346e48255f95f616038ef820565f810595af` |
| ok | seller cancels the listing | `0x0bf3e6b49d7d16a41b44cb32042a9f3760830ab6c31e36c6ed8c6f6d6143409b` |
| reverts `NotListed` | buyer cannot buy a cancelled listing | `0x9c10347e62d972614c1b86beedf6562dff363720ece5d6a7b4b3203e6ff741f7` |
| ok | seller lists A (buyer will inspect this one) | `0x6c5d85a8f94131faad0e93f8320b6545ea9364461b4425bb0cfe59838b0ff8f9` |
| ok | seller cancels, quietly | `0x98a34b90eeea89c7369afc5ff27526271363653e8acc4bda9d2f772dd613b172` |
| ok | seller adds collateral while unlisted | `0x0f1ad618b991a3f1cafc675efcb1ed36d7f6707ad359302f711c6035e8e460e8` |
| ok | seller relists A at the same price | `0x1b4d59fe4c8b873cb1b51d30a3111aaccb288d90106ba9003c49ffde2d147902` |
| reverts `SnapshotMismatch` | buyer's purchase with the hash they saw is rejected | `0xb4bc01692c7006b55d80fe2b55d1fc44c5d61093d2e3da62b6fd419674c4f33d` |
| reverts `PriceTooHigh` | buyer's purchase with a too low max price is rejected | `0x0b3d44a885e980a5ed69108eba587bb057405ede7b68fce6378caa260d36803c` |
| ok | buyer buys A with the fresh snapshot | `0xbb246a80a735398532dee7da85c6544ada56650d3873cdc54e3ab8da59829e52` |
| ok | seller claims the sale proceeds | `0x15e3bbc4f9d67a28d0cb693271878ffce41e94049eab7f2fe16388f7818e45f5` |
| reverts `NotController` | old owner can no longer touch the vault | `0xec6757e60972735885663c342a439ef0e3eddc194355ab3e38ef9452bfec823a` |
| ok | new owner adds collateral to the vault | `0xc2902389237b373b65ae82c076274db572e0b7d31ccc40fcc79b5c281401679e` |
| ok | seller opens position B (rescue flow) | `0x56a43238f76ae97f3d2024d0c43d305b056e1c3d989f9bca273b33ef6b26be15` |
| ok | buyer starts the rescue auction (anyone can, ICR is under the line) | `0x34f28d15e59187265e86037b2b0ec6c43e50efd060a27a1c7b6cf724159c833f` |
| reverts `NotController` | seller cannot touch the vault during the auction | `0x08fef23cb8ffadc24f223607d62d3d5f99d824e095cf76e5b7c8ec1a25fa397f` |
| ok | buyer approves MUSD for auction | `0x892d179ebe5e4cf05a80fa42fd99949bbf8c675bf7620213c6e7c4e5cf3c6e7c` |
| reverts `StillRisky` | buyer cannot win with a top-up that is too small | `0xf6766155f42d87263158e5ebb03be528eba9a42e3a9fa7f1aaa4557f448bcd1b` |
| ok | buyer wins the auction and tops up in the same tx | `0x590116137db5d5980aee6c4f150a461aeeb6f85af52482f7cddc7fb2437731f5` |
| ok | seller claims the auction payout | `0xef72fa3f1ff94c561346a79761e2a685ce5b3feb6f8c599f3bd630715f284bff` |


# Second deployment: browser pass

A real Chrome drove the production build (served with the second deployment's addresses) through every route and action,
same bridge as before: the page gets a plain EIP-1193 provider and every signature happens in the Node test process.
Scripts: `scripts/ui-pass.mjs`, `scripts/run-ui-pass.ps1`. Raw results: `docs/ui-pass-run1.json`, `-run2.json`, `-run3.json`.
The test chain state moves forward between runs (Deeds change hands), so the later runs resume from where the earlier ones left
the chain: run 2 runs the auction section only (`REST=1 AUCTION_ONLY=1`), run 3 the payout claim, list/cancel and phone width
(`REST=1 CLAIM=1`).

**Run 1, 25 of 28 checks passed.** Everything worked up to the auction section, then:
  - price source out of range: the page says so and Start rescue is disabled
  - owner starts an auction on Deed #2: Those auction settings are outside the allowed range.
  - script stopped early: locator.waitFor: Timeout 90000ms exceeded.
  - The first failure was my test, not the page: the app reads through Multicall3, so the interceptor that fakes a skewed DEX
    price never matched. It now opens the multicall and changes only the inner call.
  - **The second failure was a real bug the rescue change introduced**: the "Start auction" form still defaulted the floor to
    50%, and the contract now rejects anything under 80%. The form now reads `MIN_FLOOR_BPS` from the chain, defaults to it,
    labels the field with the range and disables the button with a message when the inputs are out of range.

Transactions sent by the UI in run 1:

| Wallet | Call | Tx |
| --- | --- | --- |
| holder wallet `0xeF05…25A6` | vault.addCollateral | `0x72b6c14ad0deb4b160b752042d1526037ed1e8394aa46c14de8e5886dac3b2e3` |
| holder wallet `0xeF05…25A6` | vault.withdraw | `0x0f73bf655df5ae82a1bfd477adc6fd4d5cf98bd4ca7d1cbf4707309e42e667eb` |
| holder wallet `0xeF05…25A6` | MUSD.approve | `0x6da0c5808603154037508c75d0d8294bd24e2befed5919e4883ca9dc467651da` |
| holder wallet `0xeF05…25A6` | vault.0xc883b2e5 | `0x594123c575c01bcdf9dbf84af7b97d03479d00b0f9a6a679d230fc44e5c81ce3` |
| holder wallet `0xeF05…25A6` | market.list | `0xd90ef9f3bf2a3c77aedd7bb99208fc0ad316b367f4ea8fcb77370a4ea920652a` |
| second wallet `0x522b…2ffE` | MUSD.approve | `0xf52dcf210e395a62d6ba1f55f5ad1b07a68932a04050c5457c949685bc281924` |
| second wallet `0x522b…2ffE` | market.buy | `0xb7ce7fae80bccc5401e038f35022ede35f207d3ec765c6c1203f74e568fc7282` |
| holder wallet `0xeF05…25A6` | market.claim | `0x196dcfc3595013682a3dff9509603df1963605b6e204b12fc1db4d609af5bd92` |
| holder wallet `0xeF05…25A6` | factory.createPosition | `0xdf37aa8f04892a10ad79437df71a87a7184014ea9bc9388fc36102ca0928ead7` |
| second wallet `0x522b…2ffE` | auction.startRescue | `0x38f157006fce6a4d0b8961cc0ec8623bb1d6cb6f757350bb431f3e71379930ca` |
| holder wallet `0xeF05…25A6` | auction.topUp | `0x0e9b3e35d09854f302166470b07f6ed9d28ac506ea61aa6179f913c5841e5138` |
| holder wallet `0xeF05…25A6` | auction.cancel | `0xed24f6383f87b0e8ef7109824faea92a4e21b52d7180a71379a386e5450a4610` |

**Run 2, 13 of 14 checks passed.** The owner started the auction and the guard checks ran. The failure is the script losing the card it was
watching once the bid won the auction (the card disappears, which is the expected result); the chain showed Deed #2 with the
bidder and the payout waiting. `tx()` now reports that case and the step checks the chain.

| Wallet | Call | Tx |
| --- | --- | --- |
| holder wallet `0xeF05…25A6` | vault.withdraw | `0x7f979cd94c8f4508600608cf91a37f1d0f22a1fed9bc0d345799dbd767cbdbb9` |
| holder wallet `0xeF05…25A6` | auction.start | `0x626ccf5edfa1da75716bc92a0296035638211e7d585d9883f5c0852a8f63edd2` |
| second wallet `0x522b…2ffE` | MUSD.approve | `0x7da6894b397f2de70bcfa9a5b003bd32747ed644b990840d999e56de395e075c` |
| second wallet `0x522b…2ffE` | auction.bid | `0x708610cb902938f6472ca7136a9799665800ebc171cbe23db0db52e98ff454c0` |

**Run 3, 14 of 14 checks passed.**

| Wallet | Call | Tx |
| --- | --- | --- |
| holder wallet `0xeF05…25A6` | auction.claim | `0xd423b56a1fcd39c932aff22bca46b85e1605c3523e58c74acc606a0bc4a06267` |
| holder wallet `0xeF05…25A6` | market.list | `0xb80420c0e4629b22b36699dfb68222e909e20917cea4754f8fce71e633252168` |
| holder wallet `0xeF05…25A6` | market.cancel | `0x8ae086445fef97b78ec1ad6cae921ed87aa39b5ed5f6e663f3994eb9d34f4da9` |

## When the DEX price source is out of range

Checked in the browser by changing what the page receives from the RPC, with the chain untouched:

- The DEX spot price returned 30% lower than real. The Rescue page shows **"Price source out of range, try again shortly."**
  and both **Bid at current price** and **Start rescue auction** are disabled. (Screens: the banner, the dimmed buttons.)
- The contract guard tripping while the page still thought all was well, simulated as a `SpotDeviation` revert on the
  `requiredTopUp` read: the page shows the same sentence under the button, not a raw revert.
- The same text is used for a `SpotDeviation` revert on any action (`frontend/lib/format.ts`). The in-range test is a pure
  function with unit tests (`npm test` in `frontend/`, 4 passing).

WalletConnect: runs 1 to 3 used the placeholder project id `deed-dev`, which is where the 403 and 400 entries in the JSON come
from. After a real project id was configured, a fresh load of all four routes and of the connect modal showed no failing
requests and no page errors. A WalletConnect session itself (QR code, phone wallet) was not tested.

Not tested: a real browser-extension wallet (MetaMask, Unisat, OKX, Xverse) and Passport's Bitcoin sign-in; the "End auction" button (only appears after the auction has run out, an hour at
least); "Close position" and "Claim surplus" from the UI; Safari and Firefox. The guard is checked by faking the RPC, the real
pool never moved far enough to trip it.

---

# First deployment: live run (superseded)

The first deployment (cancun build, 130% public line, 50% floor) is still on chain at the addresses in `deployments.json` under `previousDeployment`. These are its results.


Run with `scripts/e2e.mjs` against the deployed contracts, two wallets (seller `0x522bC0c3919fF823173ca4145feEcE905F772ffE`,
buyer `0xeF05aCAdf5d3fF7e8E5F0BE2515F2BE351e225A6`). Every transaction below is on chain, links go to
`https://explorer.test.mezo.org/tx/<hash>`. Raw data: `docs/first-deployment/e2e-results-market.json`, `docs/first-deployment/e2e-results-rescue.json`.
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

# First deployment: browser pass (superseded)

A real Chrome drove the production build of the frontend (served with the deployed addresses) through every route
and action. Each wallet is a plain EIP-1193 provider in the page whose signing happens in the Node test process, so no
key ever reaches the page. Scripts: `scripts/ui-pass.mjs`, `scripts/run-ui-pass.ps1`. Raw results:
`docs/first-deployment/ui-pass-full.json`, `docs/first-deployment/ui-pass-resume.json`. Screens were checked for the Market, Rescue (live countdown),
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
