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
