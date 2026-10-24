# Security model

## Trust assumptions

- **No admin.** `DeedMarket`, `RescueAuction`, `DeedFactory` and `PositionVault` have no owner, no fee, no pause
  and no upgrade path. The only privileged step is `DeedNFT.init`, which the deployer calls once to register the
  factory, market and auction. After that nobody can change them.
- **Mezo is trusted.** BorrowerOperations, TroveManager, PriceFeed and MUSD are the live MUSD system. If they
  misbehave, Deed positions do too.
- **MUSD is a plain ERC-20.** Payments use `transferFrom` and `transfer`. The market and auction still follow
  checks-effects-interactions and carry a reentrancy guard, and tests run them with a token that calls back.

## Who can do what

| Action | Who |
| --- | --- |
| open, add collateral, repay, withdraw, close, claim surplus | the Deed holder, and only while no listing or auction holds the Deed |
| top up during an auction | the seller, through `RescueAuction.topUp` only |
| list, cancel a listing | the Deed holder; anyone can clear a listing after it expires |
| buy | anyone holding the MUSD |
| start a rescue auction | the holder at any time; anyone once ICR < `rescueICR` |
| end an auction | the seller (under rules below); anyone after it expires |

A locked Deed cannot be moved by its holder, an approved operator or anyone else. Only the venue that took the lock
can release it, either back to the seller or to the new owner. `DeedNFT.settle` uses a plain internal transfer, so
a buyer contract gets no callback to reenter with.

## Buyer protection (fixed price market)

1. Listing locks the Deed. The vault checks the lock on every action, so the seller cannot withdraw, repay or
   re-borrow while listed.
2. A snapshot hash of `(collateral, principal, interestRate, minICR)` is stored at listing time. `buy` takes the
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

**Pending liquidation rewards** from other liquidations are not in the stored numbers until the trove is touched,
so they do not break the snapshot. They are included in the live ICR.

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
- If the trove is liquidated during an auction, `bid` reverts (`NotActive`). Once the auction runs out anyone can
  end it and the former owner calls `claimSurplus` on the vault.

### Oracle safety and manipulation assumptions

The Mezo `PriceFeed` is the price used for every decision. It reverts when its answer is older than 60 seconds,
and Deed lets that revert through, so a stale oracle blocks starting, bidding and the ICR check at settlement.

A second price is read from a DEX through `IPriceSource` and compared with the oracle. The auction rejects the
action when `|spot - oracle| > maxDeviationBps` of the oracle price. The DEX is a tripwire only, it never sets a
price.

What this does and does not protect against:

- Someone pushes the DEX price away from the oracle to make an auction start, or to change who can bid. The gap
  trips the check and the call reverts. They would have to move the DEX and the oracle together.
- Someone manipulates the **oracle** (a compromised Chainlink-style feed). The DEX check only helps if the DEX did
  not move with it. Deed does not defend against a feed that is wrong and agreed with by the DEX.
- `PairSpotPrice` reads current reserves, which can be moved inside one transaction with a flash loan. The check
  is therefore weaker against an attacker who moves the DEX *and* controls timing within the same block. The
  oracle value is what is used, so the attacker gains nothing by moving the DEX alone, it only makes the
  call revert. A time-weighted source can be plugged in by deploying another `IPriceSource`.
- **What is priced from where.** Every number that decides money comes from the Mezo `PriceFeed`: the equity the
  auction starts at (`equityOf`), the ICR used to open a rescue, the ICR the winner must reach, and the ICR re-check
  on a market sale. The DEX is read through `IPriceSource.spotPrice()` in one place, `_oraclePrice()`, where it is
  compared with the oracle value and the call reverts with `SpotDeviation` when they differ by more than
  `maxDeviationBps`. Its value is never used in arithmetic. The live e2e run records the contract's `equityOf`
  next to an oracle-based and a spot-based calculation, and the contract matches the oracle one.
- **Why `DEVIATION_BPS=1000` is a testnet setting.** The testnet Tigris pool is not arbitraged against the oracle: at
  deploy time it sat about 3.4% under it (spot near $78.7k, oracle near $81.4k) and the gap can move either way. With
  the 5% default, a modest drift would make every bid and rescue start revert. 10% keeps the demo usable while
  still catching a pool that is pushed far off (a 20% pump is rejected in `test_manipulatedSpot_blocksStart`).
  It is a constructor value, so this deploy keeps it for good.
- **What mainnet should use.** A liquid, arbitraged pool should track the oracle within well under 1%, so the limit
  should be tight, around 100 to 200 bps, and the source should be a time weighted price (for example a TWAP over
  several blocks from the pool's observations) instead of instant reserves, which a flash loan can move inside the
  transaction. A wider limit gives an attacker room to start or win an auction on a distorted DEX state, while too
  tight a limit pauses rescues whenever the pool lags. The limit and source should also be re-checked against
  the pool's depth before each deployment.
- **Testnet price source.** The testnet deploy wraps the live Tigris MUSD/BTC volatile pool
  `0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9` (from the Tigris PoolFactory
  `0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A`, which reported 33 pools when checked). That pool held about 102.6M MUSD
  and 1,303 BTC, a spot price near $78.7k against a Mezo oracle near $81.5k, so a gap of about 3.5% already exists on
  testnet. The deploy therefore sets the limit to 10% (`DEVIATION_BPS=1000`) instead of the 5% default. No mock source
  is used. On mainnet the limit should go back to something tight and the source should be time weighted.
- The deployed deviation limit and thresholds are constructor values and cannot be changed afterwards.
- Both prices are assumed to be MUSD per BTC with 18 decimals, and MUSD is treated as one dollar.

## Known limitations

- A partial redemption against a listed trove cancels nothing by itself, it only makes `buy` revert until the
  listing is cancelled and relisted.
- A third party can start a rescue auction once ICR < `rescueICR`. The default floor is 50% of equity over six
  hours, so an inattentive owner can lose value. The owner can top up through the auction to stop it.
- Positions with a liquidated trove cannot be sold or auctioned. Surplus collateral is claimed from the vault.
- The vault does not expose `refinance`, so a position keeps the interest rate it was opened with.
- Hints are supplied by the caller. Bad hints cost gas or fail, they do not break accounting.
- Contracts are not audited.

## Review findings

A manual adversarial pass over every contract, backed by `test/Adversarial.t.sol` and the live runs in
`docs/demo.md`. It is not a formal audit and the 12-agent scanner was not run.

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| 1 | Mezo's RPC sometimes answers `eth_estimateGas` with only the 21k base cost. A wallet that trusts it sends a transaction that runs out of gas. Hit on the first UI purchase (`0x1ca3f741543bb0798f05750c32ede482adc200d80eae40d057b3a056dc551195`). | Medium for users, no fund risk | Found live, fixed in the app (`useSafeWrite`), reproducible with `scripts/estimate-probe.mjs`. Wallets that estimate on their own can still hit it. |
| 2 | Anyone can start a rescue auction once ICR is under 130%, with a 6 hour fall to a 50% floor. An owner who is away at 125% (well above the 110% liquidation line) can be bought out at up to half of their equity. | Medium, design trade-off | Kept as specified. Mitigations if wanted: a higher default floor, a shorter fall, or a short owner-only window before the public start. The owner can top up through the auction and cancel. |
| 3 | The owner's `cancel` on someone else's auction reads the oracle and the DEX guard. A stale oracle or a wide DEX gap blocks it until the auction runs out (at most 6 hours, then anyone can `end`). | Low | Accepted. |
| 4 | The market snapshot leaves out accrued unpaid interest and pending liquidation rewards. | Low | Covered by the `minICR` check against live numbers. Documented above. |
| 5 | The DEX guard reads instant reserves. A flash loan can move it. | Low | It can only make calls revert, never set a price. Use a time weighted source on mainnet. |
| 6 | `DeedNFT.init` accepts zero or equal venue addresses. | Info | Deployer only, one call. The deploy script passes the three real addresses. |
| 7 | `closeTrove` reverts in Mezo Recovery Mode, so a holder cannot exit through the vault then. | Info | Protocol rule, noted in `docs/mezo-notes.md`. Topping up and selling still work. |
| 8 | Source code is not verified on the Mezo explorer. | Info | Explorer verifier rejected the submissions, see README. |

Properties attacked and found to hold: a stale MUSD allowance from a previous owner cannot be spent by the next one; a bid
sent after the owner cancels reverts and costs the bidder nothing; once an auction ends the venue hook and the lock are gone;
BTC donated to a vault goes to the holder on close; a stranger cannot start an owner auction; the public rescue cannot start
on a healthy position or while the DEX disagrees with the oracle; a winner always leaves above `safeICR`; the seller is paid
exactly what the bidder paid; a Deed is never in a listing and an auction at once.