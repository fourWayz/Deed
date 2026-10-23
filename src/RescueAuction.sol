// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITroveManager, IPriceFeed, IMUSD} from "./interfaces/IMezo.sol";
import {IPriceSource} from "./interfaces/IPriceSource.sol";
import {DeedNFT} from "./DeedNFT.sol";
import {DeedFactory} from "./DeedFactory.sol";
import {PositionVault} from "./PositionVault.sol";

/// @notice Dutch auction for positions close to liquidation.
/// The price falls linearly from the position's equity to a floor. The winner pays MUSD to the old
/// owner and must add enough BTC in the same transaction to leave the position above `safeICR`.
/// No owner, no fee, no admin functions.
contract RescueAuction {
    uint256 public constant MCR = 1.1e18;
    uint256 public constant GAS_COMPENSATION = 200e18;
    uint256 public constant MIN_DURATION = 1 hours;
    uint256 public constant MAX_DURATION = 7 days;
    // used when someone other than the owner starts an auction
    uint256 public constant DEFAULT_DURATION = 6 hours;
    uint256 public constant DEFAULT_FLOOR_BPS = 5_000;

    struct Auction {
        address seller;
        bool byOwner;
        uint64 start;
        uint64 duration;
        uint256 startPrice;
        uint256 floorPrice;
    }

    DeedNFT public immutable deed;
    DeedFactory public immutable factory;
    ITroveManager public immutable troveManager;
    IPriceFeed public immutable priceFeed;
    IPriceSource public immutable spotSource;
    IMUSD public immutable musd;
    // anyone can start an auction below this ICR
    uint256 public immutable rescueICR;
    // the winner must leave the position at or above this ICR
    uint256 public immutable safeICR;
    // largest gap allowed between the Mezo oracle and the DEX price
    uint256 public immutable maxDeviationBps;

    mapping(uint256 => Auction) public auctions;
    mapping(address => uint256) public claimable;

    uint256 private _status = 1;

    error NotOwner();
    error NotSeller();
    error NotRunning();
    error AlreadyRunning();
    error NotActive();
    error NoEquity();
    error BadParams();
    error Healthy(uint256 icr, uint256 rescueICR);
    error NotAllowed();
    error NotExpired();
    error Expired();
    error PriceTooHigh(uint256 price);
    error StillRisky(uint256 icr, uint256 safeICR);
    error SpotDeviation(uint256 oracle, uint256 spot);
    error NothingToClaim();
    error TransferFailed();
    error Reentrancy();

    event Started(uint256 indexed tokenId, address indexed seller, bool byOwner, uint256 startPrice, uint256 floorPrice, uint64 duration);
    event Ended(uint256 indexed tokenId, address indexed by);
    event Won(uint256 indexed tokenId, address indexed seller, address indexed winner, uint256 price, uint256 topUp);
    event Claimed(address indexed seller, uint256 amount);

    modifier nonReentrant() {
        if (_status != 1) revert Reentrancy();
        _status = 2;
        _;
        _status = 1;
    }

    constructor(
        DeedNFT deed_,
        DeedFactory factory_,
        ITroveManager troveManager_,
        IPriceFeed priceFeed_,
        IPriceSource spotSource_,
        IMUSD musd_,
        uint256 rescueICR_,
        uint256 safeICR_,
        uint256 maxDeviationBps_
    ) {
        if (rescueICR_ <= MCR || safeICR_ <= rescueICR_ || maxDeviationBps_ == 0 || maxDeviationBps_ > 5_000) {
            revert BadParams();
        }
        deed = deed_;
        factory = factory_;
        troveManager = troveManager_;
        priceFeed = priceFeed_;
        spotSource = spotSource_;
        musd = musd_;
        rescueICR = rescueICR_;
        safeICR = safeICR_;
        maxDeviationBps = maxDeviationBps_;
    }

    // --- starting ---

    /// @notice Owner starts an auction with their own floor and duration.
    function start(uint256 tokenId, uint256 floorBps, uint64 duration) external nonReentrant {
        if (deed.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (floorBps > 10_000 || duration < MIN_DURATION || duration > MAX_DURATION) revert BadParams();
        _start(tokenId, msg.sender, true, floorBps, duration);
    }

    /// @notice Anyone can start with default settings once the position is under `rescueICR`.
    function startRescue(uint256 tokenId) external nonReentrant {
        address seller = deed.ownerOf(tokenId);
        PositionVault vault = _vault(tokenId);
        uint256 price = _oraclePrice();
        uint256 icr = troveManager.getCurrentICR(address(vault), price);
        if (icr >= rescueICR) revert Healthy(icr, rescueICR);
        _start(tokenId, seller, false, DEFAULT_FLOOR_BPS, uint64(DEFAULT_DURATION));
    }

    function _start(uint256 tokenId, address seller, bool byOwner, uint256 floorBps, uint64 duration) internal {
        if (auctions[tokenId].seller != address(0)) revert AlreadyRunning();
        PositionVault vault = _vault(tokenId);
        (uint8 status,,,) = vault.troveState();
        if (status != 1) revert NotActive();

        uint256 equity = _equity(vault, _oraclePrice());
        if (equity == 0) revert NoEquity();
        uint256 floorPrice = equity * floorBps / 10_000;

        auctions[tokenId] = Auction(seller, byOwner, uint64(block.timestamp), duration, equity, floorPrice);
        deed.lock(tokenId);
        emit Started(tokenId, seller, byOwner, equity, floorPrice, duration);
    }

    // --- seller side ---

    /// @notice Seller adds BTC to the locked position. Hints are for the trove list.
    function topUp(uint256 tokenId, address upperHint, address lowerHint) external payable nonReentrant {
        Auction memory a = auctions[tokenId];
        if (a.seller == address(0)) revert NotRunning();
        if (msg.sender != a.seller) revert NotSeller();
        _vault(tokenId).topUpFromVenue{value: msg.value}(upperHint, lowerHint);
    }

    /// @notice Seller stops their own auction any time. An auction someone else started can be stopped
    /// once the position is back above `rescueICR`.
    function cancel(uint256 tokenId) external nonReentrant {
        Auction memory a = auctions[tokenId];
        if (a.seller == address(0)) revert NotRunning();
        if (msg.sender != a.seller) revert NotSeller();
        if (!a.byOwner) {
            uint256 icr = troveManager.getCurrentICR(address(_vault(tokenId)), _oraclePrice());
            if (icr < rescueICR) revert NotAllowed();
        }
        _end(tokenId);
    }

    /// @notice Anyone can close an auction after its duration has passed. The Deed goes back to the seller.
    function end(uint256 tokenId) external nonReentrant {
        Auction memory a = auctions[tokenId];
        if (a.seller == address(0)) revert NotRunning();
        if (block.timestamp < uint256(a.start) + a.duration) revert NotExpired();
        _end(tokenId);
    }

    function _end(uint256 tokenId) internal {
        delete auctions[tokenId];
        deed.unlock(tokenId);
        emit Ended(tokenId, msg.sender);
    }

    // --- bidding ---

    /// @notice Buy the position at the current price. msg.value is added to the trove as collateral
    /// and must be enough to leave it at or above `safeICR`.
    function bid(uint256 tokenId, uint256 maxPrice, address upperHint, address lowerHint)
        external
        payable
        nonReentrant
    {
        Auction memory a = auctions[tokenId];
        if (a.seller == address(0)) revert NotRunning();
        if (block.timestamp >= uint256(a.start) + a.duration) revert Expired();

        uint256 price = currentPrice(tokenId);
        if (price > maxPrice) revert PriceTooHigh(price);

        PositionVault vault = _vault(tokenId);
        (uint8 status,,,) = vault.troveState();
        if (status != 1) revert NotActive();

        delete auctions[tokenId];
        claimable[a.seller] += price;

        if (!musd.transferFrom(msg.sender, address(this), price)) revert TransferFailed();
        if (msg.value > 0) vault.topUpFromVenue{value: msg.value}(upperHint, lowerHint);

        uint256 oraclePrice = _oraclePrice();
        uint256 icr = troveManager.getCurrentICR(address(vault), oraclePrice);
        if (icr < safeICR) revert StillRisky(icr, safeICR);

        deed.settle(tokenId, msg.sender);
        emit Won(tokenId, a.seller, msg.sender, price, msg.value);
    }

    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        if (!musd.transfer(msg.sender, amount)) revert TransferFailed();
        emit Claimed(msg.sender, amount);
    }

    // --- views ---

    /// @notice Linear fall from the start price to the floor, then flat.
    function currentPrice(uint256 tokenId) public view returns (uint256) {
        Auction memory a = auctions[tokenId];
        if (a.seller == address(0)) revert NotRunning();
        uint256 elapsed = block.timestamp - a.start;
        if (elapsed >= a.duration) return a.floorPrice;
        return a.startPrice - (a.startPrice - a.floorPrice) * elapsed / a.duration;
    }

    /// @notice BTC needed to bring the position to `safeICR` at the oracle price (0 if already there).
    function requiredTopUp(uint256 tokenId) external view returns (uint256) {
        (uint256 coll, uint256 debt) = _vault(tokenId).liveState();
        uint256 price = _oraclePrice();
        uint256 needed = (safeICR * debt + price - 1) / price;
        return needed > coll ? needed - coll : 0;
    }

    function equityOf(uint256 tokenId) external view returns (uint256) {
        return _equity(_vault(tokenId), _oraclePrice());
    }

    // --- internals ---

    /// @dev Mezo oracle price, checked against the DEX. Reverts on a stale oracle or a wide gap.
    function _oraclePrice() internal view returns (uint256 price) {
        price = priceFeed.fetchPrice();
        uint256 spot = spotSource.spotPrice();
        uint256 gap = spot > price ? spot - price : price - spot;
        if (gap * 10_000 > price * maxDeviationBps) revert SpotDeviation(price, spot);
    }

    /// @dev What the owner would keep after closing: collateral value minus debt, gas compensation excluded.
    function _equity(PositionVault vault, uint256 price) internal view returns (uint256) {
        (uint256 coll, uint256 debt) = vault.liveState();
        uint256 value = coll * price / 1e18;
        uint256 owed = debt - GAS_COMPENSATION;
        return value > owed ? value - owed : 0;
    }

    function _vault(uint256 tokenId) internal view returns (PositionVault) {
        return PositionVault(payable(factory.vaultOf(tokenId)));
    }
}
