// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IBorrowerOperations, ITroveManager, IPriceFeed, IMUSD} from "./interfaces/IMezo.sol";
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

    event Opened(address indexed controller, uint256 collateral, uint256 debt);
    event CollateralAdded(uint256 amount);
    event Repaid(uint256 amount);
    event Withdrawn(uint256 amount);
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
        borrowerOps.withdrawColl(amount, upperHint, lowerHint);
        _sendBTC(msg.sender, amount);
        emit Withdrawn(amount);
    }

    /// @notice Close the trove. Missing MUSD is pulled from the caller, everything left is swept back.
    function close() external onlyController nonReentrant {
        _requireOpen();
        uint256 needed = troveManager.getTroveDebt(address(this)) - GAS_COMPENSATION;
        uint256 have = musd.balanceOf(address(this));
        if (have < needed && !musd.transferFrom(msg.sender, address(this), needed - have)) revert TransferFailed();
        borrowerOps.closeTrove();
        closed = true;
        (uint256 btcOut, uint256 musdOut) = _sweep(msg.sender);
        emit Closed(btcOut, musdOut);
    }

    /// @notice Pull collateral left over after a liquidation or redemption and send it to the caller.
    function claimSurplus() external onlyController nonReentrant {
        try borrowerOps.claimCollateral() {} catch {}
        (uint256 btcOut,) = _sweep(msg.sender);
        emit SurplusClaimed(btcOut);
    }

    // --- views ---

    /// @notice Stored trove numbers. Principal only moves on borrow/repay, so unlike total debt it is
    /// stable between actions and safe to snapshot.
    function troveState() external view returns (uint8 status, uint256 coll, uint256 principal, uint16 rate) {
        address self = address(this);
        status = troveManager.getTroveStatus(self);
        coll = troveManager.getTroveColl(self);
        principal = troveManager.getTrovePrincipal(self);
        rate = troveManager.getTroveInterestRate(self);
    }

    /// @notice Live numbers including accrued interest and pending liquidation rewards.
    function liveState() external view returns (uint256 coll, uint256 debt) {
        (uint256 c, uint256 p, uint256 i,,,) = troveManager.getEntireDebtAndColl(address(this));
        return (c, p + i);
    }

    function currentICR() external view returns (uint256) {
        return troveManager.getCurrentICR(address(this), priceFeed.fetchPrice());
    }

    // --- internals ---

    function _requireOpen() internal view {
        if (!opened || closed) revert NotOpen();
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
