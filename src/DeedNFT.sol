// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Whoever holds a Deed controls the vault with the same id.
/// While a listing or auction holds a lock on the Deed, only that venue can move it.
contract DeedNFT is ERC721 {
    address public immutable deployer;
    address public factory;
    address public market;
    address public auction;
    bool public initialized;

    uint256 public nextId = 1;
    // venue that currently holds the lock, zero when free
    mapping(uint256 => address) public lockedBy;

    bool private _venueMove;

    error AlreadyInitialized();
    error NotDeployer();
    error NotFactory();
    error NotVenue();
    error NotLocker();
    error AlreadyLocked();
    error Locked();

    event Initialized(address factory, address market, address auction);
    event Lock(uint256 indexed tokenId, address indexed venue);
    event Unlock(uint256 indexed tokenId);

    constructor() ERC721("Mezo Deed", "DEED") {
        deployer = msg.sender;
    }

    /// @notice One-shot wiring. After this call nobody can change the factory or the venues.
    function init(address factory_, address market_, address auction_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (initialized) revert AlreadyInitialized();
        initialized = true;
        factory = factory_;
        market = market_;
        auction = auction_;
        emit Initialized(factory_, market_, auction_);
    }

    function mint(address to) external returns (uint256 id) {
        if (msg.sender != factory) revert NotFactory();
        id = nextId++;
        _mint(to, id);
    }

    function lock(uint256 tokenId) external {
        if (msg.sender != market && msg.sender != auction) revert NotVenue();
        if (lockedBy[tokenId] != address(0)) revert AlreadyLocked();
        _requireOwned(tokenId);
        lockedBy[tokenId] = msg.sender;
        emit Lock(tokenId, msg.sender);
    }

    function unlock(uint256 tokenId) external {
        if (lockedBy[tokenId] != msg.sender) revert NotLocker();
        lockedBy[tokenId] = address(0);
        emit Unlock(tokenId);
    }

    /// @notice The locking venue hands the Deed to its new owner and releases the lock.
    /// Uses a plain transfer, no receiver callback, so a buyer contract cannot reenter here.
    function settle(uint256 tokenId, address to) external {
        if (lockedBy[tokenId] != msg.sender) revert NotLocker();
        lockedBy[tokenId] = address(0);
        _venueMove = true;
        _update(to, tokenId, address(0));
        _venueMove = false;
        emit Unlock(tokenId);
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (lockedBy[tokenId] != address(0) && !_venueMove) revert Locked();
        return super._update(to, tokenId, auth);
    }
}
