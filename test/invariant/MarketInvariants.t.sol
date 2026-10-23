// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MarketBase} from "../DeedMarket.t.sol";
import {PositionVault} from "../../src/PositionVault.sol";

contract MarketHandler is MarketBase {
    uint256[] public ids;
    PositionVault[] public vaults;
    address[3] public actors;

    constructor() {
        super.setUp();
        actors = [alice, bob, mallory];
        ids.push(id);
        vaults.push(vault);
        for (uint256 i; i < 2; ++i) {
            (uint256 id2, PositionVault v2) = _open(actors[i + 1], COLL, DEBT);
            ids.push(id2);
            vaults.push(v2);
        }
    }

    function list(uint256 seed, uint256 price) external {
        uint256 i = seed % ids.length;
        address owner = deed.ownerOf(ids[i]);
        vm.prank(owner);
        try market.list(ids[i], bound(price, 1, 10_000e18), uint64(block.timestamp + 1 days), MIN_ICR) {} catch {}
    }

    function buy(uint256 seed, uint256 buyerSeed) external {
        uint256 i = seed % ids.length;
        address buyer = actors[buyerSeed % 3];
        bytes32 snap = market.snapshot(vaults[i], MIN_ICR);
        vm.prank(buyer);
        try market.buy(ids[i], snap, type(uint256).max) {} catch {}
    }

    function cancel(uint256 seed, uint256 callerSeed) external {
        uint256 i = seed % ids.length;
        vm.prank(actors[callerSeed % 3]);
        try market.cancel(ids[i]) {} catch {}
    }

    function claim(uint256 seed) external {
        vm.prank(actors[seed % 3]);
        try market.claim() {} catch {}
    }

    function time(uint256 dt) external {
        skip(bound(dt, 0, 2 days));
    }

    function owedTotal() external view returns (uint256 sum) {
        for (uint256 i; i < 3; ++i) {
            sum += market.claimable(actors[i]);
        }
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }
}

contract MarketInvariantTest is MarketBase {
    MarketHandler h;

    function setUp() public override {
        h = new MarketHandler();
        targetContract(address(h));
    }

    // the market holds exactly what sellers are owed
    function invariant_escrowEqualsClaimable() public view {
        assertEq(h.musd().balanceOf(address(h.market())), h.owedTotal());
    }

    // a Deed is locked by the market if and only if it has a listing
    function invariant_lockMatchesListing() public view {
        for (uint256 i; i < h.idCount(); ++i) {
            uint256 tokenId = h.ids(i);
            (address seller,,,,) = h.market().listings(tokenId);
            bool locked = h.deed().lockedBy(tokenId) == address(h.market());
            assertEq(seller != address(0), locked);
            if (locked) assertEq(h.deed().ownerOf(tokenId), seller);
        }
    }

    // the vaults still hold nothing
    function invariant_vaultsEmpty() public view {
        for (uint256 i; i < h.idCount(); ++i) {
            address v = address(h.vaults(i));
            assertEq(v.balance, 0);
            assertEq(h.musd().balanceOf(v), 0);
        }
    }
}
