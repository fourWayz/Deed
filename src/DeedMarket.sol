// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITroveManager, IPriceFeed, IMUSD} from "./interfaces/IMezo.sol";
import {DeedNFT} from "./DeedNFT.sol";
import {DeedFactory} from "./DeedFactory.sol";
import {PositionVault} from "./PositionVault.sol";

/// @notice Fixed price sales of positions, paid in MUSD.
/// Listing locks the Deed, so the seller cannot touch the vault until the sale ends.
/// The buyer names the exact position state they expect and the sale reverts if it differs.
/// No owner, no fee, no admin functions.
contract DeedMarket {
    uint256 public constant MCR = 1.1e18;

    struct Listing {
        address seller;
        uint64 expiry;
        uint256 price;
        uint256 minICR;
        bytes32 snapshot;
    }

    DeedNFT public immutable deed;
    DeedFactory public immutable factory;
    ITroveManager public immutable troveManager;
    IPriceFeed public immutable priceFeed;
    IMUSD public immutable musd;

    mapping(uint256 => Listing) public listings;
    // sale proceeds wait here until the seller pulls them
    mapping(address => uint256) public claimable;

    uint256 private _status = 1;

    error NotOwner();
    error NotListed();
    error AlreadyListed();
    error BadPrice();
    error BadExpiry();
    error BadMinICR();
    error NotActive();
    error NotSeller();
    error Expired();
    error NotExpired();
    error SnapshotMismatch();
    error PriceTooHigh();
    error IcrTooLow(uint256 icr, uint256 minICR);
    error NothingToClaim();
    error TransferFailed();
    error Reentrancy();

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price, uint64 expiry, uint256 minICR, bytes32 snapshot);
    event Cancelled(uint256 indexed tokenId, address indexed by);
    event Sold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price);
    event Claimed(address indexed seller, uint256 amount);

    modifier nonReentrant() {
        if (_status != 1) revert Reentrancy();
        _status = 2;
        _;
        _status = 1;
    }

    constructor(DeedNFT deed_, DeedFactory factory_, ITroveManager troveManager_, IPriceFeed priceFeed_, IMUSD musd_) {
        deed = deed_;
        factory = factory_;
        troveManager = troveManager_;
        priceFeed = priceFeed_;
        musd = musd_;
    }

    /// @param minICR lowest collateral ratio the seller promises at settlement, between MCR and the current ICR.
    function list(uint256 tokenId, uint256 price, uint64 expiry, uint256 minICR) external nonReentrant {
        if (deed.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (listings[tokenId].seller != address(0)) revert AlreadyListed();
        if (price == 0) revert BadPrice();
        if (expiry <= block.timestamp) revert BadExpiry();
        if (minICR < MCR) revert BadMinICR();

        PositionVault vault = _vault(tokenId);
        (uint8 status,,,) = vault.troveState();
        if (status != 1) revert NotActive();
        uint256 icr = troveManager.getCurrentICR(address(vault), priceFeed.fetchPrice());
        if (icr < minICR) revert BadMinICR();

        bytes32 snap = snapshot(vault, minICR);
        listings[tokenId] = Listing(msg.sender, expiry, price, minICR, snap);
        deed.lock(tokenId);
        emit Listed(tokenId, msg.sender, price, expiry, minICR, snap);
    }

    /// @notice Seller can cancel any time, anyone can clear a listing once it has expired.
    function cancel(uint256 tokenId) external nonReentrant {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (msg.sender != l.seller && block.timestamp <= l.expiry) revert NotSeller();
        delete listings[tokenId];
        deed.unlock(tokenId);
        emit Cancelled(tokenId, msg.sender);
    }

    /// @param expectedSnapshot the hash the buyer computed from the position they looked at.
    /// @param maxPrice highest price the buyer accepts, guards against a cancel and relist.
    function buy(uint256 tokenId, bytes32 expectedSnapshot, uint256 maxPrice) external nonReentrant {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (block.timestamp > l.expiry) revert Expired();
        if (l.price > maxPrice) revert PriceTooHigh();

        PositionVault vault = _vault(tokenId);
        if (expectedSnapshot != l.snapshot || snapshot(vault, l.minICR) != l.snapshot) revert SnapshotMismatch();

        // reverts on a stale oracle, which is the safe way to fail
        uint256 icr = troveManager.getCurrentICR(address(vault), priceFeed.fetchPrice());
        if (icr < l.minICR) revert IcrTooLow(icr, l.minICR);

        delete listings[tokenId];
        claimable[l.seller] += l.price;

        if (!musd.transferFrom(msg.sender, address(this), l.price)) revert TransferFailed();
        deed.settle(tokenId, msg.sender);
        emit Sold(tokenId, l.seller, msg.sender, l.price);
    }

    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        if (!musd.transfer(msg.sender, amount)) revert TransferFailed();
        emit Claimed(msg.sender, amount);
    }

    /// @notice Hash of what a buyer is paying for. Debt here is the principal, since total debt grows every
    /// second and would never match; accrued interest is covered by the ICR check instead.
    function snapshot(PositionVault vault, uint256 minICR) public view returns (bytes32) {
        (, uint256 coll, uint256 principal, uint16 rate) = vault.troveState();
        return keccak256(abi.encode(coll, principal, rate, minICR));
    }

    function _vault(uint256 tokenId) internal view returns (PositionVault) {
        return PositionVault(payable(factory.vaultOf(tokenId)));
    }
}
