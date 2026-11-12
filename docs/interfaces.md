# Interfaces (v3, frozen)

The ABIs in `abis/*.json` are generated from the contracts with `forge inspect <Name> abi --json`. This file says what
changed against v2 and what each external function does. Anything that reads or writes the chain (frontend, SDK,
indexer, keeper) should build on these. **Frozen** means: if a signature has to change, `abis/` and this file change in
the same commit and the change is called out in the commit message.

## What changed since v2

| Contract | Change |
| --- | --- |
| `PositionVault` | new `borrow`, `refinance`, `surplus`; `close` now pays the entire debt including pending redistribution; `claimSurplus` reverts `NothingToClaim` instead of silently doing nothing; `troveState` returns entire collateral and principal (pending redistribution included); new errors `RecoveryModeActive`, `NothingToClaim`; new events `Borrowed`, `Refinanced` |
| `DeedMarket` | constructor takes `treasury_` and `feeBps_`; `Sold` has a new `fee` field; new `feeFor`, `treasury`, `feeBps`, `MAX_FEE_BPS`; new error `BadParams`; `claim()` pays the treasury too |
| `RescueAuction` | constructor takes `treasury_` and `feeBps_`; `Won` has a new `fee` field; new `feeFor`, `treasury`, `feeBps`, `MAX_FEE_BPS`; `claim()` pays the treasury too |
| `DeedLens` | new, read-only |
| `PairTwapPrice` | new `IPriceSource`, the price guard for v3 (`spotPrice()` is now a time weighted price) |
| `DeedNFT`, `DeedFactory` | unchanged |

Semantics that matter to callers:

- **Fees.** `fee = price * feeBps / 10000`, rounded down. The seller gets `price - fee`. Both go to `claimable[...]` and
  are pulled with `claim()`. `feeBps <= 100` (1%) and the treasury is immutable. `quote`: use `feeFor(price)` on either venue.
- **Entire debt.** Everywhere a vault, venue or lens reports collateral or debt it means: stored amount + accrued
  interest + pending redistribution. `PositionVault.troveState()` leaves interest out (principal only) so a sale snapshot stays stable.
- **Frozen vault.** `borrow`, `refinance`, `close`, `claimSurplus` and every other holder action revert `NotController`
  while a listing or auction holds the Deed.
- **Recovery Mode.** `withdraw`, `borrow`, `refinance` revert `RecoveryModeActive`; `close` reverts it while Mezo's
  BorrowerOperations can still mint. `addCollateral` and `repay` keep working.
- **Surplus.** `claimSurplus` only has something to pull after a redemption closed the whole trove. `surplus()` shows how much.
- **Deploy order** is unchanged: `PairTwapPrice`, `DeedNFT`, `DeedFactory`, `DeedMarket`, `RescueAuction`, `DeedLens`, then `DeedNFT.init(factory, market, auction)` in the same broadcast.

Constructors:

- `DeedMarket(deed, factory, troveManager, priceFeed, musd, treasury, feeBps)`
- `RescueAuction(deed, factory, troveManager, priceFeed, spotSource, musd, rescueICR, safeICR, maxDeviationBps, treasury, feeBps)`
- `DeedLens(deed, factory, borrowerOps, troveManager, priceFeed, musd)`
- `PairTwapPrice(pair, musd, minWindowSeconds)`

`DeedLens.position(tokenId)` returns one struct: `vault, holder, lockedBy, status, collateral, principal, interest, debt,
icr, rate, collateralValue, equity, surplus, price, tcr, recoveryMode, priceStale, canClose, canWithdraw, canBorrow,
canRefinance`. When the Mezo oracle is stale (older than 60 s) the lens does not revert: `priceStale` is true and `price`,
`tcr`, `icr`, `collateralValue`, `equity` are 0.

## External functions and events


### DeedNFT

constructor:

- `constructor()`

functions:

- `approve(address,uint256)` nonpayable
- `auction()` view returns `(address)`
- `balanceOf(address)` view returns `(uint256)`
- `deployer()` view returns `(address)`
- `factory()` view returns `(address)`
- `getApproved(uint256)` view returns `(address)`
- `init(address,address,address)` nonpayable
- `initialized()` view returns `(bool)`
- `isApprovedForAll(address,address)` view returns `(bool)`
- `lock(uint256)` nonpayable
- `lockedBy(uint256)` view returns `(address)`
- `market()` view returns `(address)`
- `mint(address)` nonpayable returns `(uint256)`
- `name()` view returns `(string)`
- `nextId()` view returns `(uint256)`
- `ownerOf(uint256)` view returns `(address)`
- `safeTransferFrom(address,address,uint256)` nonpayable
- `safeTransferFrom(address,address,uint256,bytes)` nonpayable
- `setApprovalForAll(address,bool)` nonpayable
- `settle(uint256,address)` nonpayable
- `supportsInterface(bytes4)` view returns `(bool)`
- `symbol()` view returns `(string)`
- `tokenURI(uint256)` view returns `(string)`
- `transferFrom(address,address,uint256)` nonpayable
- `unlock(uint256)` nonpayable

events:

- `Approval(address,address,uint256)`
- `ApprovalForAll(address,address,bool)`
- `Initialized(address,address,address)`
- `Lock(uint256,address)`
- `Transfer(address,address,uint256)`
- `Unlock(uint256)`

errors:

- `AlreadyInitialized()`
- `AlreadyLocked()`
- `ERC721IncorrectOwner(address,uint256,address)`
- `ERC721InsufficientApproval(address,uint256)`
- `ERC721InvalidApprover(address)`
- `ERC721InvalidOperator(address)`
- `ERC721InvalidOwner(address)`
- `ERC721InvalidReceiver(address)`
- `ERC721InvalidSender(address)`
- `ERC721NonexistentToken(uint256)`
- `Locked()`
- `NotDeployer()`
- `NotFactory()`
- `NotLocker()`
- `NotVenue()`


### DeedFactory

constructor:

- `constructor(address deed_,address borrowerOps_,address troveManager_,address priceFeed_,address musd_)`

functions:

- `borrowerOps()` view returns `(address)`
- `createPosition(uint256,address,address)` payable returns `(uint256,address)`
- `deed()` view returns `(address)`
- `musd()` view returns `(address)`
- `priceFeed()` view returns `(address)`
- `troveManager()` view returns `(address)`
- `vaultOf(uint256)` view returns `(address)`

events:

- `PositionCreated(uint256,address,address,uint256,uint256)`

errors:

- `TransferFailed()`


### PositionVault

constructor:

- `constructor(address deed_,uint256 tokenId_,address borrowerOps_,address troveManager_,address priceFeed_,address musd_)`

functions:

- `GAS_COMPENSATION()` view returns `(uint256)`
- `addCollateral(address,address)` payable
- `borrow(uint256,address,address)` nonpayable
- `borrowerOps()` view returns `(address)`
- `claimSurplus()` nonpayable
- `close()` nonpayable
- `closed()` view returns `(bool)`
- `currentICR()` view returns `(uint256)`
- `deed()` view returns `(address)`
- `liveState()` view returns `(uint256,uint256)`
- `musd()` view returns `(address)`
- `open(uint256,address,address)` payable
- `opened()` view returns `(bool)`
- `priceFeed()` view returns `(address)`
- `refinance(address,address)` nonpayable
- `repay(uint256,address,address)` nonpayable
- `surplus()` view returns `(uint256)`
- `tokenId()` view returns `(uint256)`
- `topUpFromVenue(address,address)` payable
- `troveManager()` view returns `(address)`
- `troveState()` view returns `(uint8,uint256,uint256,uint16)`
- `withdraw(uint256,address,address)` nonpayable

events:

- `Borrowed(uint256)`
- `Closed(uint256,uint256)`
- `CollateralAdded(uint256)`
- `Opened(address,uint256,uint256)`
- `Refinanced(uint16,uint16)`
- `Repaid(uint256)`
- `SurplusClaimed(uint256)`
- `Withdrawn(uint256)`

errors:

- `AlreadyOpened()`
- `NotController()`
- `NotOpen()`
- `NothingToClaim()`
- `RecoveryModeActive()`
- `Reentrancy()`
- `TransferFailed()`


### DeedMarket

constructor:

- `constructor(address deed_,address factory_,address troveManager_,address priceFeed_,address musd_,address treasury_,uint256 feeBps_)`

functions:

- `MAX_FEE_BPS()` view returns `(uint256)`
- `MCR()` view returns `(uint256)`
- `buy(uint256,bytes32,uint256)` nonpayable
- `cancel(uint256)` nonpayable
- `claim()` nonpayable
- `claimable(address)` view returns `(uint256)`
- `deed()` view returns `(address)`
- `factory()` view returns `(address)`
- `feeBps()` view returns `(uint256)`
- `feeFor(uint256)` view returns `(uint256)`
- `list(uint256,uint256,uint64,uint256)` nonpayable
- `listings(uint256)` view returns `(address,uint64,uint256,uint256,bytes32)`
- `musd()` view returns `(address)`
- `priceFeed()` view returns `(address)`
- `snapshot(address,uint256)` view returns `(bytes32)`
- `treasury()` view returns `(address)`
- `troveManager()` view returns `(address)`

events:

- `Cancelled(uint256,address)`
- `Claimed(address,uint256)`
- `Listed(uint256,address,uint256,uint64,uint256,bytes32)`
- `Sold(uint256,address,address,uint256,uint256)`

errors:

- `AlreadyListed()`
- `BadExpiry()`
- `BadMinICR()`
- `BadParams()`
- `BadPrice()`
- `Expired()`
- `IcrTooLow(uint256,uint256)`
- `NotActive()`
- `NotExpired()`
- `NotListed()`
- `NotOwner()`
- `NotSeller()`
- `NothingToClaim()`
- `PriceTooHigh()`
- `Reentrancy()`
- `SnapshotMismatch()`
- `TransferFailed()`


### RescueAuction

constructor:

- `constructor(address deed_,address factory_,address troveManager_,address priceFeed_,address spotSource_,address musd_,uint256 rescueICR_,uint256 safeICR_,uint256 maxDeviationBps_,address treasury_,uint256 feeBps_)`

functions:

- `DEFAULT_DURATION()` view returns `(uint256)`
- `DEFAULT_FLOOR_BPS()` view returns `(uint256)`
- `GAS_COMPENSATION()` view returns `(uint256)`
- `MAX_DURATION()` view returns `(uint256)`
- `MAX_FEE_BPS()` view returns `(uint256)`
- `MCR()` view returns `(uint256)`
- `MIN_DURATION()` view returns `(uint256)`
- `MIN_FLOOR_BPS()` view returns `(uint256)`
- `auctions(uint256)` view returns `(address,bool,uint64,uint64,uint256,uint256)`
- `bid(uint256,uint256,address,address)` payable
- `cancel(uint256)` nonpayable
- `claim()` nonpayable
- `claimable(address)` view returns `(uint256)`
- `currentPrice(uint256)` view returns `(uint256)`
- `deed()` view returns `(address)`
- `end(uint256)` nonpayable
- `equityOf(uint256)` view returns `(uint256)`
- `factory()` view returns `(address)`
- `feeBps()` view returns `(uint256)`
- `feeFor(uint256)` view returns `(uint256)`
- `maxDeviationBps()` view returns `(uint256)`
- `musd()` view returns `(address)`
- `priceFeed()` view returns `(address)`
- `requiredTopUp(uint256)` view returns `(uint256)`
- `rescueICR()` view returns `(uint256)`
- `safeICR()` view returns `(uint256)`
- `spotSource()` view returns `(address)`
- `start(uint256,uint256,uint64)` nonpayable
- `startRescue(uint256)` nonpayable
- `topUp(uint256,address,address)` payable
- `treasury()` view returns `(address)`
- `troveManager()` view returns `(address)`

events:

- `Claimed(address,uint256)`
- `Ended(uint256,address)`
- `Started(uint256,address,bool,uint256,uint256,uint64)`
- `Won(uint256,address,address,uint256,uint256,uint256)`

errors:

- `AlreadyRunning()`
- `BadParams()`
- `Expired()`
- `Healthy(uint256,uint256)`
- `NoEquity()`
- `NotActive()`
- `NotAllowed()`
- `NotExpired()`
- `NotOwner()`
- `NotRunning()`
- `NotSeller()`
- `NothingToClaim()`
- `PriceTooHigh(uint256)`
- `Reentrancy()`
- `SpotDeviation(uint256,uint256)`
- `StillRisky(uint256,uint256)`
- `TransferFailed()`


### DeedLens

constructor:

- `constructor(address deed_,address factory_,address borrowerOps_,address troveManager_,address priceFeed_,address musd_)`

functions:

- `GAS_COMPENSATION()` view returns `(uint256)`
- `borrowerOps()` view returns `(address)`
- `deed()` view returns `(address)`
- `factory()` view returns `(address)`
- `musd()` view returns `(address)`
- `position(uint256)` view returns `((address,address,address,uint8,uint256,uint256,uint256,uint256,uint256,uint16,uint256,uint256,uint256,uint256,uint256,bool,bool,bool,bool,bool,bool))`
- `priceFeed()` view returns `(address)`
- `system()` view returns `(uint256,uint256,bool,bool)`
- `troveManager()` view returns `(address)`

errors:

- `UnknownDeed()`


### PairTwapPrice

constructor:

- `constructor(address pair_,address musd_,uint256 minWindow_)`

functions:

- `MAX_STEPS()` view returns `(uint256)`
- `minWindow()` view returns `(uint256)`
- `musdIsToken0()` view returns `(bool)`
- `pair()` view returns `(address)`
- `spotPrice()` view returns `(uint256)`

errors:

- `BadParams()`
- `NoObservation()`

