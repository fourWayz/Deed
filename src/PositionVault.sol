// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IBorrowerOperations, ITroveManager, IPriceFeed, IMUSD, ICollSurplusPool} from "./interfaces/IMezo.sol";
import {DeedNFT} from "./DeedNFT.sol";

/// @notice Owns exactly one MUSD trove. The holder of the matching Deed is the only one who can act,
/// and not at all while a listing or auction has locked the Deed.
contract PositionVault {
    uint256 public constant GAS_COMPENSATION = 200e18;

    DeedNFT public immutable deed;
    uint256 public immutable tokenId;
    IBorrowerOperations public immutable borrowerOps;
    ITroveManager public immutable troveManager;
    IPriceFeed public immutable priceFeed;
    IMUSD public immutable musd;

    bool public opened;
    bool public closed;
    uint256 private _status = 1;

    error NotController();
    error Reentrancy();
    error AlreadyOpened();
    error NotOpen();
    error TransferFailed();
    error RecoveryModeActive();
    error NothingToClaim();

    event Opened(address indexed controller, uint256 collateral, uint256 debt);
    event CollateralAdded(uint256 amount);
    event Repaid(uint256 amount);
    event Withdrawn(uint256 amount);
    event Borrowed(uint256 amount);
    event Refinanced(uint16 oldRate, uint16 newRate);
    event Closed(uint256 btcOut, uint256 musdOut);
    event SurplusClaimed(uint256 btcOut);

    modifier onlyController() {
        if (deed.ownerOf(tokenId) != msg.sender || deed.lockedBy(tokenId) != address(0)) revert NotController();
        _;
    }

    modifier nonReentrant() {
        if (_status != 1) revert Reentrancy();
        _status = 2;
        _;
        _status = 1;
    }

    constructor(
        DeedNFT deed_,
        uint256 tokenId_,
        IBorrowerOperations borrowerOps_,
        ITroveManager troveManager_,
        IPriceFeed priceFeed_,
        IMUSD musd_
    ) {
        deed = deed_;
        tokenId = tokenId_;
        borrowerOps = borrowerOps_;
        troveManager = troveManager_;
        priceFeed = priceFeed_;
        musd = musd_;
    }

    /// @dev Collateral and surplus come back as plain native transfers.
    receive() external payable {}

    // --- controller actions ---

    /// @notice Open the trove with msg.value as collateral. Borrowed MUSD goes to the caller.
    function open(uint256 debtAmount, address upperHint, address lowerHint)
        external
        payable
        onlyController
        nonReentrant
    {
        if (opened) revert AlreadyOpened();
        opened = true;
        borrowerOps.openTrove{value: msg.value}(debtAmount, upperHint, lowerHint);
        _sendMUSD(msg.sender, debtAmount);
        emit Opened(msg.sender, msg.value, debtAmount);
    }

    function addCollateral(address upperHint, address lowerHint) external payable onlyController nonReentrant {
        _requireOpen();
        borrowerOps.addColl{value: msg.value}(upperHint, lowerHint);
        emit CollateralAdded(msg.value);
    }

    /// @notice Lets the venue that locked the Deed add collateral, so an auction can top the position up.
    function topUpFromVenue(address upperHint, address lowerHint) external payable nonReentrant {
        if (deed.lockedBy(tokenId) != msg.sender) revert NotController();
        _requireOpen();
        borrowerOps.addColl{value: msg.value}(upperHint, lowerHint);
        emit CollateralAdded(msg.value);
    }

    /// @notice Repay with MUSD pulled from the caller (needs allowance).
    function repay(uint256 amount, address upperHint, address lowerHint) external onlyController nonReentrant {
        _requireOpen();
        if (!musd.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        borrowerOps.repayMUSD(amount, upperHint, lowerHint);
        emit Repaid(amount);
    }

    function withdraw(uint256 amount, address upperHint, address lowerHint) external onlyController nonReentrant {
        _requireOpen();
        _requireNormalMode();
        borrowerOps.withdrawColl(amount, upperHint, lowerHint);
        _sendBTC(msg.sender, amount);
        emit Withdrawn(amount);
    }

    /// @notice Borrow more MUSD against the same trove. The MUSD goes to the caller, the fee is added to the debt.
    function borrow(uint256 amount, address upperHint, address lowerHint) external onlyController nonReentrant {
        _requireOpen();
        // in Recovery Mode a debt increase has to improve the ICR, which a pure borrow never does
        _requireNormalMode();
        borrowerOps.withdrawMUSD(amount, upperHint, lowerHint);
        _sendMUSD(msg.sender, amount);
        emit Borrowed(amount);
    }

    /// @notice Move the trove to the current system interest rate. The fee is added to the debt.
    function refinance(address upperHint, address lowerHint) external onlyController nonReentrant {
        _requireOpen();
        _requireNormalMode();
        (,,, uint16 oldRate) = _troveState();
        borrowerOps.refinance(upperHint, lowerHint);
        (,,, uint16 newRate) = _troveState();
        emit Refinanced(oldRate, newRate);
    }

    /// @notice Close the trove. Missing MUSD is pulled from the caller, everything left is swept back.
    function close() external onlyController nonReentrant {
        _requireOpen();
        // closeTrove only refuses in Recovery Mode while BorrowerOperations can still mint
        if (musd.mintList(address(borrowerOps))) _requireNormalMode();
        // MUSD applies pending redistribution before it burns the debt, and getTroveDebt leaves that out,
        // so the amount to pay comes from the entire debt
        uint256 needed = _entireDebt() - GAS_COMPENSATION;
        uint256 have = musd.balanceOf(address(this));
        if (have < needed && !musd.transferFrom(msg.sender, address(this), needed - have)) revert TransferFailed();
        borrowerOps.closeTrove();
        closed = true;
        (uint256 btcOut, uint256 musdOut) = _sweep(msg.sender);
        emit Closed(btcOut, musdOut);
    }

    /// @notice Pull collateral left in the CollSurplusPool and send everything the vault holds to the caller.
    /// MUSD only accounts surplus when a redemption closes a trove completely. A liquidation leaves none.
    function claimSurplus() external onlyController nonReentrant {
        if (surplus() == 0) revert NothingToClaim();
        borrowerOps.claimCollateral();
        (uint256 btcOut,) = _sweep(msg.sender);
        emit SurplusClaimed(btcOut);
    }

    // --- views ---

    /// @notice Trove numbers that a sale snapshot can hash: collateral and principal including pending
    /// redistribution, so applying the pending rewards to the trove does not change them. Interest is left
    /// out because it grows every second.
    function troveState() external view returns (uint8 status, uint256 coll, uint256 principal, uint16 rate) {
        return _troveState();
    }

    /// @notice Live numbers including accrued interest and pending redistribution.
    function liveState() external view returns (uint256 coll, uint256 debt) {
        (uint256 c, uint256 p, uint256 i,,,) = troveManager.getEntireDebtAndColl(address(this));
        return (c, p + i);
    }

    function currentICR() external view returns (uint256) {
        return troveManager.getCurrentICR(address(this), priceFeed.fetchPrice());
    }

    /// @notice Collateral waiting in the CollSurplusPool for this vault.
    function surplus() public view returns (uint256) {
        return ICollSurplusPool(troveManager.collSurplusPool()).getCollateral(address(this));
    }

    // --- internals ---

    function _requireOpen() internal view {
        if (!opened || closed) revert NotOpen();
    }

    function _requireNormalMode() internal view {
        if (troveManager.checkRecoveryMode(priceFeed.fetchPrice())) revert RecoveryModeActive();
    }

    function _troveState() internal view returns (uint8 status, uint256 coll, uint256 principal, uint16 rate) {
        address self = address(this);
        status = troveManager.getTroveStatus(self);
        (coll, principal,,,,) = troveManager.getEntireDebtAndColl(self);
        rate = troveManager.getTroveInterestRate(self);
    }

    function _entireDebt() internal view returns (uint256) {
        (, uint256 p, uint256 i,,,) = troveManager.getEntireDebtAndColl(address(this));
        return p + i;
    }

    function _sweep(address to) internal returns (uint256 btcOut, uint256 musdOut) {
        musdOut = musd.balanceOf(address(this));
        if (musdOut > 0) _sendMUSD(to, musdOut);
        btcOut = address(this).balance;
        if (btcOut > 0) _sendBTC(to, btcOut);
    }

    function _sendBTC(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _sendMUSD(address to, uint256 amount) internal {
        if (!musd.transfer(to, amount)) revert TransferFailed();
    }
}
