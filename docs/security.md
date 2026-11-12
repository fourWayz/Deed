# Security model

## Trust assumptions

- **No admin.** `DeedMarket`, `RescueAuction`, `DeedFactory`, `PositionVault` and `DeedLens` have no owner, no pause
  and no upgrade path. The only privileged step is `DeedNFT.init`, which the deployer calls once to register the
  factory, market and auction, in the same broadcast as the deploys. After that nobody can change them.
- **Fees are constants.** `DeedMarket` takes `feeBps` of the sale price and `RescueAuction` `feeBps` of the winning price.
  Both are constructor values, capped at 100 bps (1%) by the constructor, paid to an immutable `treasury`, and pulled
  with `claim()` like any other balance. There is no function that changes the rate, the treasury or the cap
  (`test_noAdminFunctionsInTheInterfaces`). The fee exists only on venue sales: a Deed can still be handed over with a
  plain ERC-721 transfer when it is not locked, and that route pays nothing.
- **Mezo is trusted.** BorrowerOperations, TroveManager, PriceFeed and MUSD are the live MUSD system. If they
  misbehave, Deed positions do too.
- **MUSD is a plain ERC-20.** Payments use `transferFrom` and `transfer`. The market and auction still follow
  checks-effects-interactions and carry a reentrancy guard, and tests run them with a token that calls back.

## Who can do what

| Action | Who |
| --- | --- |
| open, add collateral, repay, withdraw, borrow, refinance, close, claim surplus | the Deed holder, and only while no listing or auction holds the Deed |
| claim sale proceeds or fees | whoever is owed them, one `claim()` per venue |
| top up during an auction | the seller, through `RescueAuction.topUp` only |
| list, cancel a listing | the Deed holder; anyone can clear a listing after it expires |
| buy | anyone holding the MUSD |
| start a rescue auction | the holder at any time; anyone once ICR < `rescueICR` (120% in the deployed auction) |
| end an auction | the seller (under rules below); anyone after it expires |

A locked Deed cannot be moved by its holder, an approved operator or anyone else. Only the venue that took the lock
can release it, either back to the seller or to the new owner. `DeedNFT.settle` uses a plain internal transfer, so
a buyer contract gets no callback to reenter with.

## Buyer protection (fixed price market)

1. Listing locks the Deed. The vault checks the lock on every action, so the seller cannot withdraw, repay or
   re-borrow while listed.
2. A snapshot hash of `(collateral, principal, interestRate, minICR)` is stored at listing time, where collateral and
   principal are the **entire** amounts (pending redistribution included). `buy` takes the
   hash the buyer saw and reverts if it differs from the stored hash **or** from the hash of the live position.
3. `maxPrice` stops a cancel-and-relist at a higher price.
4. At settlement the live ICR is read from the Mezo `PriceFeed` and must be at least the seller's `minICR`.
5. Proceeds are credited to the seller and pulled with `claim()`.

Cancel, change the position, relist: the new snapshot differs, so a buyer holding the old hash reverts.
A partial redemption by a third party also changes the snapshot and makes the sale revert. That is a deliberate
fail-safe, the buyer just reads the new state and tries again.

**Principal, not total debt.** The spec asks for debt in the snapshot. Total debt grows every second through
interest, so a hash over it would never match. The snapshot uses the principal, which only moves on borrow or
repay. Accrued interest is covered by the `minICR` check against live debt.

**Pending redistribution.** v2 hashed the stored collateral and principal, which leave out rewards from other troves'
liquidations until the trove is touched. v3 hashes the entire amounts (`getEntireDebtAndColl`). Applying pending rewards
changes nothing economic, so it does not move the hash (`test_listing_snapshotSurvivesTouchWithoutNewRewards`,
`test_troveState_isEntireAndStableWhenPendingIsApplied`), while a new redistribution does, and `buy` reverts
`SnapshotMismatch` until the seller relists (`test_redistributionBetweenReadAndBuy_revertsAndTheBuyerRecovers`). Debt for
`closeTrove`, the ICR in the market and auction, the equity and the required top-up all come from the same entire numbers.

**Borrow and refinance.** `borrow` raises the principal and `refinance` changes the rate and adds a fee to the principal,
so both change the snapshot. Both are holder-only, refuse while the Deed is locked (listed or auctioned), and refuse in
Recovery Mode with `RecoveryModeActive`. Tests: `test_snapshot_coversBorrow`, `test_snapshot_coversRefinance`,
`test_sellerCannotBorrowAgainstAListedPosition`, `test_sellerCannotRefinanceBehindTheBuyersBack`, `test_borrow_frozenWhileAuctioned`.

## Rescue auction

- The start price is the owner's equity at the oracle price: `coll * price - (debt - 200 MUSD gas compensation)`.
  It falls linearly to a floor over the duration. After the duration the auction is over; bids revert and anyone
  can end it, which returns the Deed to the seller.
- The winner pays the current price to the previous owner and sends BTC with the bid. That BTC is added to the
  trove and the call reverts unless the live ICR is at least `safeICR`. A winner can never inherit a position
  that is still near liquidation.
- Owner-started auctions can be cancelled by the owner at any time. If someone else started the auction (the
  position was under `rescueICR`), the owner can top up through the auction and cancel only once the ICR is back
  above `rescueICR`. This stops the owner from stalling a rescue while the position stays risky.
- Every auction, whoever starts it, falls to a floor of at least **80% of the equity** at the start (`MIN_FLOOR_BPS`, and the
  default for a public start). A holder cannot be tricked into starting an auction with a lower floor either, the start call
  reverts. The most a stranger can take from an inattentive owner is therefore 20% of equity, and only once the position is
  under 120%, which is 10 points above the 110% liquidation line.
- If the trove is liquidated during an auction, `bid` reverts (`NotActive`). Once the auction runs out anyone can
  end it. A liquidation leaves no surplus in MUSD (see below), so there is nothing to claim.
- The fee is taken from the winning price at `bid`, `feeBps` rounded down. The seller is credited `price - fee` and the
  treasury `fee`, so the two add up to the price exactly. The floor is on the price, not on the seller's net, so the
  seller can receive up to 1% less than the floor.

### Oracle safety and manipulation assumptions

The Mezo `PriceFeed` is the price used for every decision. It reverts when its answer is older than 60 seconds,
and Deed lets that revert through, so a stale oracle blocks starting, bidding and the ICR check at settlement.

A second price is read from a DEX through `IPriceSource` and compared with the oracle. The auction rejects the
action when `|twap - oracle| > maxDeviationBps` of the oracle price. The DEX is a tripwire only, it never sets a
price.

**v3 uses a time weighted price.** The Tigris MUSD/BTC pool exposes `observations` and `currentCumulativePrices`
(`docs/mezo-notes.md`), so v3's source is `PairTwapPrice`: the ratio of the pool's time-averaged reserves between the
newest observation at least `minWindow` (1 hour) old and now. Reserves moved inside one block carry no weight, because the
cumulative values grow only with time. Tests: `test_oneBlockReserveSpike_doesNotMoveTheAverage` (a 50% reserve swing moves
the instant price and not the average), `test_shortSpike_movesTheAverageByItsTimeShare`,
`test_instantSourceIsCensorable_twapIsNot` (the same swing makes an auction on the instant source revert and not one on
the TWAP), `test_realDeviationStillBlocks` (a pool that really sits 20% off for hours is still refused), and a fork test
that reads the live pool and matches a hand computation from its observations.

What this does and does not protect against:

- Someone pushes the DEX price away from the oracle to make an auction start, or to change who can bid. A one-block swing
  no longer even reaches the guard. Moving the average takes a sustained move that costs the manipulator arbitrage losses
  for as long as it lasts.
- Someone manipulates the **oracle** (a compromised Chainlink-style feed). The DEX check only helps if the DEX did
  not move with it. Deed does not defend against a feed that is wrong and agreed with by the DEX.
- The average lags: after a real price move the check can refuse until the pool catches up, which pauses rescues and
  auction bids rather than mispricing them. The oracle value is what is used, so the worst case is a refused call.
  The pool must also have an observation at least `minWindow` old, otherwise `spotPrice()` reverts `NoObservation`.
- **What is priced from where.** Every number that decides money comes from the Mezo `PriceFeed`: the equity the
  auction starts at (`equityOf`), the ICR used to open a rescue, the ICR the winner must reach, and the ICR re-check
  on a market sale. The DEX is read through `IPriceSource.spotPrice()` in one place, `_oraclePrice()`, where it is
  compared with the oracle value and the call reverts with `SpotDeviation` when they differ by more than
  `maxDeviationBps`. Its value is never used in arithmetic. The live e2e run records the contract's `equityOf`
  next to an oracle-based and a spot-based calculation, and the contract matches the oracle one.
- **Why the testnet deviation limit is wider than 200 bps.** The code default and the mainnet recommendation are
  `DEVIATION_BPS=200`. The live testnet pool is not arbitraged against the oracle: it sat about 3.4% under it at the first
  deploy and about 8.8% over it (78.4k against 72.1k) when v3 was prepared, and the gap moves either way. A 200 bps limit
  on this pool would refuse every rescue, so the v3 testnet deployment uses the value recorded in `deployments.json`
  (`auctionParams.maxDeviationBps`), chosen from the gap measured at deploy time. It is a constructor value and cannot be
  changed afterwards. A mainnet pool with real arbitrage should be deployed with 200 or less.
- **Testnet price source.** The testnet deploy wraps the live Tigris MUSD/BTC volatile pool
  `0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9`. No mock source is used.
- The deployed deviation limit, window, fees and thresholds are constructor values and cannot be changed afterwards.
- Both prices are assumed to be MUSD per BTC with 18 decimals, and MUSD is treated as one dollar.

## Known limitations

- A partial redemption against a listed trove cancels nothing by itself, it only makes `buy` revert until the
  listing is cancelled and relisted.
- A third party can start a rescue auction once ICR < `rescueICR` (120%). The floor is 80% of equity over six
  hours, so an inattentive owner can lose value. The owner can top up through the auction to stop it.
- Positions with a liquidated trove cannot be sold or auctioned.
- Surplus collateral exists only after a redemption closes a trove completely. A liquidation leaves none in this MUSD
  version. The holder claims it with `claimSurplus`, which is frozen while the Deed is listed or auctioned, so a seller
  whose trove is redeemed to zero has to cancel first.
- A redistribution after listing makes `buy` revert until the seller relists. It is a fail-safe, but anyone who can
  trigger a liquidation can also force a relist.
- In Recovery Mode the holder cannot withdraw, borrow or refinance, and cannot close while BorrowerOperations can mint.
  Adding collateral, repaying and selling still work.
- The fee applies only to venue sales. Handing a Deed over with a plain ERC-721 transfer pays no fee.
- Hints are supplied by the caller. Bad hints cost gas or fail, they do not break accounting.
- Contracts are not audited.

## Review findings

A manual adversarial pass over every contract, backed by `test/Adversarial.t.sol` and the live runs in
`docs/demo.md`. It is not a formal audit and the 12-agent scanner was not run.

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| 1 | Mezo's RPC sometimes answers `eth_estimateGas` with only the 21k base cost. A wallet that trusts it sends a transaction that runs out of gas. Hit on the first UI purchase (`0x1ca3f741543bb0798f05750c32ede482adc200d80eae40d057b3a056dc551195`). | Medium for users, no fund risk | Found live, fixed in the app (`useSafeWrite`), reproducible with `scripts/estimate-probe.mjs`. Wallets that estimate on their own can still hit it. |
| 2 | Anyone could start a rescue auction once ICR was under 130%, with a 6 hour fall to a 50% floor. An owner who was away at 125% (well above the 110% liquidation line) could be bought out at up to half of their equity. | Medium, design trade-off | **Addressed in the second deployment.** A stranger can start only under 120% and the floor is 80% of equity, enforced for every auction. The most that can be taken is 20% of equity, from a position within 10 points of liquidation. Tests: `test_awayOwnerAt125_cannotBeRescuedByStranger`, `testFuzz_strangerAuctionNeverPaysUnderEightyPercent`, `test_noAuctionCanBeStartedWithAnythingBelowTheMinimumFloor`. A short owner-only window before the public start is still an option. |
| 3 | The owner's `cancel` on someone else's auction reads the oracle and the DEX guard. A stale oracle or a wide DEX gap blocks it until the auction runs out (at most 6 hours, then anyone can `end`). | Low | Accepted. |
| 4 | The market snapshot leaves out accrued unpaid interest and pending liquidation rewards. | Low | Covered by the `minICR` check against live numbers. Documented above. |
| 5 | The DEX guard reads instant reserves. A flash loan can move it. | Low | **Addressed in v3** with `PairTwapPrice`, a time weighted average from the pool's own observations. `test_instantSourceIsCensorable_twapIsNot`, `test_oneBlockReserveSpike_doesNotMoveTheAverage`. |
| 6 | `DeedNFT.init` accepts zero or equal venue addresses. | Info | Deployer only, one call. The deploy script passes the three real addresses. |
| 7 | `closeTrove` reverts in Mezo Recovery Mode, so a holder cannot exit through the vault then. | Info | Protocol rule, noted in `docs/mezo-notes.md`. v3 reports it as `RecoveryModeActive` and in `DeedLens`. Topping up and selling still work (`test_recoveryMode_holderCanStillExitBySale`). |
| 8 | Source code is not verified on the Mezo explorer. | Info | Explorer verifier rejected the submissions, see README. |
| 9 | `PositionVault.close()` computed the MUSD to pull from `getTroveDebt`, which leaves out pending redistribution. `closeTrove` applies it first and burns the entire debt, so a vault with pending rewards pulled too little and `closeTrove` reverted `Caller doesnt have enough mUSD`. A holder could not exit until someone touched the trove. | Medium, found reading `TroveManager` for v3 | **Fixed in v3.** `close()` uses `getEntireDebtAndColl`. Tests: `test_close_paysTheEntireDebtIncludingPendingRedistribution`, `testFuzz_closeAlwaysPaysEntireDebt`, `test_closeCannotBeFrontRunIntoAnUnderpayment`; fork: `test_realMusd_closePaysTheEntireDebtIncludingPending`, `test_realMusd_theOldAmountIsNotEnoughForCloseTrove`. Putting the old formula back makes three of them fail. |
| 10 | The market snapshot hashed stored collateral and principal, which move when pending rewards are applied and miss them until then. | Low | **Fixed in v3.** It hashes the entire amounts. `test_listing_snapshotSurvivesTouchWithoutNewRewards`, `test_redistributionBetweenReadAndBuy_revertsAndTheBuyerRecovers`. |
| 11 | `claimSurplus` wrapped `claimCollateral` in `try/catch`, so a claim with nothing to claim looked like success, and the holder could not tell. | Low | **Fixed in v3.** It reverts `NothingToClaim`, and `surplus()` shows the amount. `test_claimSurplus_secondClaimRevertsInsteadOfDoingNothing`, `test_formerHolderCannotClaimSurplusAfterTheSale`, `test_strangerCannotClaimOrTriggerSurplus`. |
| 12 | New `borrow` and `refinance` could let a seller change a position between the buyer reading it and buying it. | Medium if unguarded | Both are holder-only and frozen while listed or auctioned, and both move the snapshot. `test_sellerCannotBorrowAgainstAListedPosition`, `test_sellerCannotRefinanceBehindTheBuyersBack`, `test_borrowedToTheLimit_cannotListAboveTheRealIcr`. |
| 13 | New fee path: rounding, the cap, who gets paid, and whether anything can be stuck. | Medium if unguarded | Fee rounds down so `fee + proceeds == price` exactly; cap and non-zero treasury enforced in the constructors; balances are pull-based. `testFuzz_marketFeePlusProceedsEqualsPrice`, `testFuzz_auctionFeePlusProceedsEqualsPrice`, `test_marketFee_cannotBeDodgedByBuyingYourOwnListing`, `test_treasuryNeverClaiming_doesNotBlockTheSeller`, `test_noAdminFunctionsInTheInterfaces`, and the invariants `invariant_escrowEqualsClaimable`, `invariant_everyMusdIsAccountedFor`, `invariant_feesAreExactlyTheRuleAndNeverAboveOnePercent`. |
| 14 | `DeedLens` reads the oracle, which reverts when stale, and could brick a screen. It is also new surface. | Low | It never reverts on a stale oracle (`priceStale`), has no payable function and no state. `test_staleOracleDoesNotBrickTheLens`, `test_lensCannotReceiveFunds`. |
| 15 | The testnet DEX pool is far from the oracle, so a 200 bps guard cannot work on it. | Info, testnet only | Documented above: the testnet deploy uses a wider limit chosen from the measured gap, mainnet should use 200 or less. |

Properties attacked and found to hold: a stale MUSD allowance from a previous owner cannot be spent by the next one; a bid
sent after the owner cancels reverts and costs the bidder nothing; once an auction ends the venue hook and the lock are gone;
BTC donated to a vault goes to the holder on close; a stranger cannot start an owner auction; the public rescue cannot start
on a healthy position or while the DEX disagrees with the oracle; a winner always leaves above `safeICR`; the seller is paid
exactly what the bidder paid; a Deed is never in a listing and an auction at once.