// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IBorrowerOperations, ITroveManager, IPriceFeed, IMUSD} from "./interfaces/IMezo.sol";
import {DeedNFT} from "./DeedNFT.sol";
import {PositionVault} from "./PositionVault.sol";

/// @notice Deploys a vault, opens its trove and hands the Deed and the borrowed MUSD to the caller.
contract DeedFactory {
    DeedNFT public immutable deed;
    IBorrowerOperations public immutable borrowerOps;
    ITroveManager public immutable troveManager;
    IPriceFeed public immutable priceFeed;
    IMUSD public immutable musd;

    mapping(uint256 => address) public vaultOf;

    error TransferFailed();

    event PositionCreated(uint256 indexed tokenId, address indexed vault, address indexed owner, uint256 collateral, uint256 debt);

    constructor(
        DeedNFT deed_,
        IBorrowerOperations borrowerOps_,
        ITroveManager troveManager_,
        IPriceFeed priceFeed_,
        IMUSD musd_
    ) {
        deed = deed_;
        borrowerOps = borrowerOps_;
        troveManager = troveManager_;
        priceFeed = priceFeed_;
        musd = musd_;
    }

    /// @param debtAmount MUSD to borrow, msg.value is the BTC collateral.
    function createPosition(uint256 debtAmount, address upperHint, address lowerHint)
        external
        payable
        returns (uint256 tokenId, address vault)
    {
        // the factory holds the Deed only until the trove is open
        tokenId = deed.mint(address(this));
        PositionVault v = new PositionVault(deed, tokenId, borrowerOps, troveManager, priceFeed, musd);
        vault = address(v);
        vaultOf[tokenId] = vault;

        v.open{value: msg.value}(debtAmount, upperHint, lowerHint);
        if (!musd.transfer(msg.sender, debtAmount)) revert TransferFailed();
        deed.transferFrom(address(this), msg.sender, tokenId);

        emit PositionCreated(tokenId, vault, msg.sender, msg.value, debtAmount);
    }
}
