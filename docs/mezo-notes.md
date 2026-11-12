# Mezo / MUSD research notes

Source of truth is the contract code in `mezo-org/musd` (`solidity/contracts`, solc 0.8.24).
Where the docs or other buildathon repos disagree with the code, the code wins. Addresses below
were checked live against `https://rpc.test.mezo.org` (chain id 31611).

## Testnet addresses (checked on chain)

| contract | address |
| --- | --- |
| MUSD | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` |
| BorrowerOperations | `0xCdF7028ceAB81fA0C6971208e83fa7872994beE5` |
| TroveManager | `0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0` |
| PriceFeed | `0x86bCF0841622a5dAC14A313a15f96A95421b9366` |
| SortedTroves | `0x722E4D24FD6Ff8b0AC679450F3D91294607268fA` |
| HintHelpers | `0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6` |
| InterestRateManager | `0xD4D6c36A592A2c5e86035A6bca1d57747a567f37` |

`BorrowerOperations` reports the TroveManager, PriceFeed, SortedTroves, MUSD and InterestRateManager
addresses above, and `HintHelpers.troveManager()` matches. Live reads at research time:
`minNetDebt = 1800e18`, `borrowingRate = 1e15` (0.1%), `interestRate = 100` (1%), SortedTroves size 297,
`fetchPrice() ~ 81,611e18`.

## Can a contract own a trove?

Yes. A trove is keyed by `msg.sender` (`openTrove` calls `_openTrove(msg.sender, msg.sender, ...)`).
There is no EOA check. The vault is the borrower of record and also the `_recipient` of the borrowed
MUSD and of released collateral, so the vault needs a `receive()` and must forward funds itself.
`XachP/mezo-lifeline` does exactly this (`LifelineVault`); the pattern is reused here.

## Collateral is native BTC

Collateral is the chain's native asset (18 decimals), sent as `msg.value`. There is no collateral ERC-20.
`openTrove(uint256 debtAmount, address upperHint, address lowerHint) payable`.

## Calls the vault needs

| action | call |
| --- | --- |
| open | `openTrove{value: coll}(debtAmount, upperHint, lowerHint)` |
| add collateral | `addColl{value: x}(upperHint, lowerHint)` |
| withdraw collateral | `withdrawColl(amount, upperHint, lowerHint)` (collateral is sent to the vault) |
| borrow more | `withdrawMUSD(amount, upperHint, lowerHint)` (MUSD minted to the vault) |
| repay | `repayMUSD(amount, upperHint, lowerHint)` (burns from `msg.sender`, so the vault must hold the MUSD; no allowance involved) |
| close | `closeTrove()` (burns `debt - 200e18` from `msg.sender`, returns all collateral to the vault) |
| refinance | `refinance(upperHint, lowerHint)` |
| claim surplus | `claimCollateral()` (after a liquidation or redemption left surplus) |

## Hints

Hints are `SortedTroves` neighbours, ordered by NICR (`coll * 1e20 / principal`, not price based).
A bad hint only costs gas, `SortedTroves` falls back to a search, but a bad hint on a long list can
run out of gas. Off-chain, use `HintHelpers.getApproxHint(nicr, numTrials, seed)` then
`SortedTroves.findInsertPosition(nicr, hint, hint)` to get `(upper, lower)`. `HintHelpers.computeNominalCR`
gives the NICR for a coll/debt pair. `address(0)` hints are accepted and work on a short list.

## Minimum debt, gas compensation, fees

- `minNetDebt` is governable (starts at `1800e18`, hard floor `50e18`, changes need a 7 day delay).
  Net debt = requested debt + borrowing fee. Opening and any repayment must leave net debt >= `minNetDebt`.
- `MUSD_GAS_COMPENSATION = 200e18`. It is added to the trove debt on open and minted to the GasPool.
  Total trove debt = principal + interest; to close you pay `debt - 200e18`, the gas pool burns the rest.
  So real equity = `coll * price - (debt - 200e18)`.
- Borrowing fee: `borrowingRate` (0.1% now, governable) of the borrowed amount, minted to PCV, added to debt.
  It is charged on open and on every debt increase, except in Recovery Mode or for fee-exempt accounts.

## Interest rate

Interest is simple, not compounding. `InterestRateManager.interestRate()` (uint16, basis points,
`100 = 1%`) is read at `openTrove` and stored per trove with `setTroveInterestRate`. An existing trove
**keeps its rate** when governance changes the global rate. Only `refinance()` moves a trove to the current
rate (fee: `refinancingFeePercentage` = 20% of the borrowing fee on the net debt). Accrued interest is
tracked in `interestOwed`, added on every touch (`updateSystemAndTroveInterest`). The live value is
`getEntireDebtAndColl` (interest accrues every second).

Consequence for Deed: total debt moves every second, so the market snapshot must use the **principal**
(only changes on borrow/repay) and the rate, not total debt.

## Thresholds

- `MCR = 1.1e18` (110%). Liquidation happens in `batchLiquidateTroves` only for `ICR < MCR`.
  Unlike classic Liquity there is no separate Recovery Mode liquidation branch in this TroveManager
  (the other buildathon repo assumes there is, the code says no).
- `CCR = 1.5e18` (150%). Recovery Mode is `TCR < CCR`. In Recovery Mode: no collateral withdrawal,
  a debt increase needs ICR >= CCR and an ICR improvement, open needs ICR >= CCR. `closeTrove` reverts in
  Recovery Mode while BorrowerOperations is on the MUSD mint list (`canMint`), and also needs the post-close
  TCR to stay >= CCR. Repaying and topping up collateral stay allowed.
- Normal mode adjustments need new ICR >= MCR and new TCR >= CCR.

### What Recovery Mode restricts (read from `BorrowerOperations.sol`, checked on the fork)

| action | Recovery Mode | revert string |
| --- | --- | --- |
| `addColl` | allowed | |
| `repayMUSD` | allowed | |
| `withdrawColl` | blocked | `Collateral withdrawal not permitted Recovery Mode` |
| `withdrawMUSD` | allowed only if the new ICR >= 150% **and** above the old ICR. A pure borrow lowers the ICR, so it always reverts | `Cannot decrease your Trove's ICR in Recovery Mode` |
| `refinance` | blocked | `Operation not permitted during Recovery Mode` |
| `closeTrove` | blocked while BorrowerOperations is on the MUSD mint list (`MUSD.mintList(BO)`, true on testnet); allowed otherwise, subject to the post-close TCR | `Operation not permitted during Recovery Mode` |
| `openTrove` | needs ICR >= CCR, no borrowing fee | |
| liquidation | no separate Recovery Mode branch, ICR < MCR only | |

The vault turns the blocked ones into one clear error, `RecoveryModeActive`, before calling MUSD, and `DeedLens` exposes
`canClose / canWithdraw / canBorrow / canRefinance`. `test_realMusd_recoveryModeBlocksMatchTheVaultErrors` calls the
real BorrowerOperations as the vault and shows it refuses exactly what the vault refuses.
- `maxBorrowingCapacity` is set at open to `coll * price / 1.1` and only goes down on collateral withdrawal;
  a debt increase must fit under it.

## Price feed

`PriceFeed.fetchPrice()` reads one Chainlink-style aggregator and **reverts when the answer is more than
60 seconds old** (`MAX_PRICE_DELAY = 60`). It returns BTC/USD scaled to 18 decimals, which is also the
MUSD/BTC price since MUSD is treated as $1. There is no fallback oracle. Local forks cannot run the oracle
(it needs a chain precompile), so fork tests mock `fetchPrice`. Reads with plain `cast call` work.

## Useful views

`TroveManager`: `getTroveStatus` (1 = active), `getTroveColl`, `getTrovePrincipal`, `getTroveInterestOwed`,
`getTroveDebt` (principal + interest, includes the 200 gas comp), `getTroveInterestRate`,
`getTroveMaxBorrowingCapacity`, `getCurrentICR(addr, price)` (includes pending redistribution rewards),
`getEntireDebtAndColl(addr)` (coll, principal, interest, pendingColl, pendingPrincipal, pendingInterest;
the first three already include pending), `checkRecoveryMode(price)`, `getTCR(price)`.
Stored `getTroveColl` / `getTrovePrincipal` ignore pending rewards, which only change when the trove is
touched, so they are stable between actions.

### Pending redistribution, checked in `TroveManager.sol`

When a trove is liquidated and the Stability Pool cannot absorb it, its collateral and debt are redistributed to every
trove in proportion to stake. They are not written to each trove: `L_Collateral`, `L_Principal`, `L_Interest` grow and a
trove's share is `stake * (L - snapshot)`.

| view / operation | pending redistribution |
| --- | --- |
| `getTroveDebt` | **left out**: principal + interest owed + accrued interest, nothing else |
| `getTroveColl`, `getTrovePrincipal` | left out (stored values) |
| `getCurrentICR` | **included** (`_getCurrentTroveAmounts`) |
| `getEntireDebtAndColl` | **included** in its first three outputs; the last three show the pending part |
| `closeTrove` | first calls `updateSystemAndTroveInterest`, which applies the pending rewards, then burns `debt - 200e18` with the **entire** debt |
| redemption | applies the pending rewards to each trove it touches before redeeming |

So `getTroveDebt(vault) - 200e18` under-counts what `closeTrove` burns whenever a redistribution is pending, and a vault
that pulled only that much would make `closeTrove` revert with `Caller doesnt have enough mUSD`. The vault now uses the
entire debt from `getEntireDebtAndColl`. The market snapshot hashes the entire collateral and entire principal, which do
not change when the pending rewards are applied, and every ICR in Deed (market, auction, lens, vault) is the entire ICR.
Fork tests: `test/fork/V3Fork.t.sol`.

### Surplus (`claimCollateral`), checked in `CollSurplusPool.sol` and `TroveManager.sol`

`accountSurplus` is called in exactly one place, `_redeemCloseTrove`: a **redemption that takes a trove's whole net
debt** closes it (`closedByRedemption`, status 4) and the remaining collateral waits in the `CollSurplusPool`. A
**liquidation leaves no surplus** in this version, even though the comment on `claimCollateral` still mentions one.
`claimCollateral()` sends the pool balance to `msg.sender` (the vault) and reverts with `No collateral available to
claim` when there is none. The vault used to hide that revert with a `try/catch`; it now reverts `NothingToClaim`
and exposes `surplus()`.

## Things that matter for the design

1. The vault must be the only holder of the trove and must forward every payout. After a liquidation the
   leftover collateral sits in `CollSurplusPool` and is claimed with `claimCollateral()` from the vault.
2. Anyone can touch a trove's economics without the owner: partial redemptions lower coll and principal,
   and liquidations of others add pending rewards. A sale snapshot has to fail if a redemption hits the trove.
3. Debt is not static, price is stale after 60s. Any settlement check reads `fetchPrice()` and will revert
   on a stale oracle, which is the safe failure.
4. Mezo testnet has no price source besides this feed in the MUSD repo. A second (DEX) price needs its own
   adapter, see `docs/security.md`.

## Tigris pool (the DEX price)

The MUSD/BTC volatile pool `0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9` is a Velodrome fork. It exposes
`observationLength()` (3,028 when checked), `observations(i)` (timestamp and cumulative reserves, written on a swap when
at least `periodSize` = 1,800 s have passed) and `currentCumulativePrices()`. `PairTwapPrice` averages the reserves between
the newest observation at least one hour old and now. The testnet pool lags the oracle: it was about 3.4% under it at the
first deploy and about 8.8% over it (78.4k against 72.1k) when v3 was prepared, so it is not a usable 200 bps reference.
