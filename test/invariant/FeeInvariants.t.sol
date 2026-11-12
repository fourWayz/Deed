// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V3Base} from "../V3Base.t.sol";
import {PositionVault} from "../../src/PositionVault.sol";

/// Random listings, sales, cancels and claims on a market that charges 1%, with a ledger kept on the side.
contract FeeHandler is V3Base {
    uint256[] public ids;
    PositionVault[] public vaults;
    address[4] public actors;

    // every MUSD that went into the market as a sale price, and every MUSD that came out through claim()
    uint256 public paidIn;
    uint256 public claimedOut;
    // the sum of the fees the contract should have booked, computed here from each sale price
    uint256 public expectedFees;
    uint256 public treasuryClaimed;
    uint256 public sales;

    constructor() {
        super.setUp();
        actors = [alice, bob, mallory, treasury];
        ids.push(id);
        vaults.push(vault);
        for (uint256 i; i < 2; ++i) {
            (uint256 id2, PositionVault v2) = _open(actors[i + 1], COLL, DEBT);
            ids.push(id2);
            vaults.push(v2);
        }
        vm.prank(address(mezo));
        musd.mint(treasury, 10_000e18);
        _approveMUSD(treasury, address(market));
    }

    function list(uint256 seed, uint256 price) external {
        uint256 i = seed % ids.length;
        address owner = deed.ownerOf(ids[i]);
        vm.prank(owner);
        // prices go down to 1 wei, where the fee rounds to zero
        try market.list(ids[i], bound(price, 1, 10_000e18), uint64(block.timestamp + 1 days), MIN_ICR) {} catch {}
    }

    function buy(uint256 seed, uint256 buyerSeed) external {
        uint256 i = seed % ids.length;
        // the treasury never buys, so it never owns a Deed or sells one and its balance can only be fees
        address buyer = actors[buyerSeed % 3];
        (address seller,, uint256 price,,) = market.listings(ids[i]);
        bytes32 snap = market.snapshot(vaults[i], MIN_ICR);
        vm.prank(buyer);
        try market.buy(ids[i], snap, type(uint256).max) {
            assertTrue(seller != address(0));
            paidIn += price;
            expectedFees += price * MARKET_FEE / 10_000;
            sales++;
        } catch {}
    }

    function cancel(uint256 seed, uint256 callerSeed) external {
        uint256 i = seed % ids.length;
        vm.prank(actors[callerSeed % 4]);
        try market.cancel(ids[i]) {} catch {}
    }

    function claim(uint256 seed) external {
        address who = actors[seed % 4];
        uint256 owed = market.claimable(who);
        vm.prank(who);
        try market.claim() {
            claimedOut += owed;
            if (who == treasury) treasuryClaimed += owed;
        } catch {}
    }

    function time(uint256 dt) external {
        skip(bound(dt, 0, 2 days));
    }

    function owedTotal() external view returns (uint256 sum) {
        for (uint256 i; i < 4; ++i) {
            sum += market.claimable(actors[i]);
        }
    }
}

contract FeeInvariantTest is V3Base {
    FeeHandler h;

    function setUp() public override {
        h = new FeeHandler();
        // only the handler's actions: its inherited setUp() would rebuild the market and strand the ledger
        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = FeeHandler.list.selector;
        selectors[1] = FeeHandler.buy.selector;
        selectors[2] = FeeHandler.cancel.selector;
        selectors[3] = FeeHandler.claim.selector;
        selectors[4] = FeeHandler.time.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: selectors}));
        targetContract(address(h));
    }

    // nothing is ever stuck: the market holds exactly what is still owed to sellers and the treasury
    function invariant_escrowEqualsClaimable() public view {
        assertEq(h.musd().balanceOf(address(h.market())), h.owedTotal());
    }

    // fee plus seller proceeds equals price, summed over every sale: what came in is what is owed plus what went out
    function invariant_everyMusdIsAccountedFor() public view {
        assertEq(h.paidIn(), h.owedTotal() + h.claimedOut());
    }

    // the treasury is owed exactly the sum of the fee rule over every sale, and never more than 1% of the volume
    function invariant_feesAreExactlyTheRuleAndNeverAboveOnePercent() public view {
        assertLe(h.expectedFees(), h.paidIn() / 100);
        assertEq(h.market().claimable(h.actors(3)) + h.treasuryClaimed(), h.expectedFees());
    }
}
