// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IBorrowerOperations, ITroveManager, IPriceFeed, IMUSD, ICollSurplusPool} from "./interfaces/IMezo.sol";
import {DeedNFT} from "./DeedNFT.sol";
import {DeedFactory} from "./DeedFactory.sol";

/// @notice Read-only. Everything a screen needs about one position, and about the system, in one call.
/// Debt and collateral are the entire amounts: stored values plus accrued interest plus pending redistribution.
contract DeedLens {
    uint256 public constant GAS_COMPENSATION = 200e18;

    DeedNFT public immutable deed;
    DeedFactory public immutable factory;
    IBorrowerOperations public immutable borrowerOps;
    ITroveManager public immutable troveManager;
    IPriceFeed public immutable priceFeed;
    IMUSD public immutable musd;

    struct PositionView {
        address vault;
        address holder;
        // venue holding the Deed, zero when the vault is free to act
        address lockedBy;
        // 0 none, 1 active, 2 closed by owner, 3 closed by liquidation, 4 closed by redemption
        uint8 status;
        uint256 collateral;
        uint256 principal;
        uint256 interest;
        // principal + interest, includes the 200 MUSD gas compensation
        uint256 debt;
        uint256 icr;
        uint16 rate;
        uint256 collateralValue;
        // what the holder keeps after closing: collateral value minus debt, gas compensation excluded
        uint256 equity;
        // collateral waiting in the CollSurplusPool
        uint256 surplus;
        uint256 price;
        uint256 tcr;
        bool recoveryMode;
        // the Mezo oracle refused to answer (older than 60 seconds), so price, tcr and icr are zero
        bool priceStale;
        // what Mezo allows right now, ignoring whether a listing or auction has frozen the vault
        bool canClose;
        bool canWithdraw;
        bool canBorrow;
        bool canRefinance;
    }

    error UnknownDeed();

    constructor(
        DeedNFT deed_,
        DeedFactory factory_,
        IBorrowerOperations borrowerOps_,
        ITroveManager troveManager_,
        IPriceFeed priceFeed_,
        IMUSD musd_
    ) {
        deed = deed_;
        factory = factory_;
        borrowerOps = borrowerOps_;
        troveManager = troveManager_;
        priceFeed = priceFeed_;
        musd = musd_;
    }

    function position(uint256 tokenId) external view returns (PositionView memory v) {
        address vault = factory.vaultOf(tokenId);
        if (vault == address(0)) revert UnknownDeed();
        v = _position(vault, tokenId);
    }

    /// @notice Oracle price, system TCR and whether Recovery Mode is on.
    function system() external view returns (uint256 price, uint256 tcr, bool recoveryMode, bool priceStale) {
        return _system();
    }

    function _position(address vault, uint256 tokenId) internal view returns (PositionView memory v) {
        v.vault = vault;
        v.holder = deed.ownerOf(tokenId);
        v.lockedBy = deed.lockedBy(tokenId);
        v.status = troveManager.getTroveStatus(vault);
        (v.price, v.tcr, v.recoveryMode, v.priceStale) = _system();
        v.surplus = ICollSurplusPool(troveManager.collSurplusPool()).getCollateral(vault);
        v.rate = troveManager.getTroveInterestRate(vault);

        (v.collateral, v.principal, v.interest,,,) = troveManager.getEntireDebtAndColl(vault);
        v.debt = v.principal + v.interest;

        if (v.status != 1) return v;

        if (!v.priceStale) {
            v.icr = troveManager.getCurrentICR(vault, v.price);
            v.collateralValue = v.collateral * v.price / 1e18;
            uint256 owed = v.debt > GAS_COMPENSATION ? v.debt - GAS_COMPENSATION : 0;
            v.equity = v.collateralValue > owed ? v.collateralValue - owed : 0;
        }

        // the rules in BorrowerOperations: no collateral withdrawal, no refinance and no pure borrow in
        // Recovery Mode, and closing is refused there while BorrowerOperations is on the mint list
        v.canWithdraw = !v.priceStale && !v.recoveryMode;
        v.canBorrow = v.canWithdraw;
        v.canRefinance = v.canWithdraw;
        v.canClose = !v.priceStale && !(v.recoveryMode && musd.mintList(address(borrowerOps)));
    }

    function _system() internal view returns (uint256 price, uint256 tcr, bool recoveryMode, bool priceStale) {
        try priceFeed.fetchPrice() returns (uint256 p) {
            price = p;
            tcr = troveManager.getTCR(p);
            recoveryMode = troveManager.checkRecoveryMode(p);
        } catch {
            priceStale = true;
        }
    }
}
