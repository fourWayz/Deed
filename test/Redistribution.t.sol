// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V3Base} from "./V3Base.t.sol";
import {PositionVault} from "../src/PositionVault.sol";
import {DeedMarket} from "../src/DeedMarket.sol";
import {RescueAuction} from "../src/RescueAuction.sol";

/// A liquidation elsewhere redistributes collateral and debt to every trove. MUSD keeps it pending, leaves it out of
/// getTroveDebt, and applies it at the start of any trove operation. These tests run the vault, the market and the
/// auction against a mock that behaves the same way.
contract RedistributionTest is V3Base {
    uint256 constant PEND_COLL = 0.002 ether;
    uint256 constant PEND_PRINCIPAL = 150e18;
    uint256 constant PEND_INTEREST = 7e18;

    function _redistribute() internal {
        mezo.redistribute{value: PEND_COLL}(address(vault), PEND_COLL, PEND_PRINCIPAL, PEND_INTEREST);
    }

    function test_getTroveDebt_leavesPendingOut_entireDebtHasIt() public {
        uint256 before = _entireDebt();
        _redistribute();
        assertEq(mezo.getTroveDebt(address(vault)), before, "stored view ignores pending");
        assertEq(_entireDebt(), before + PEND_PRINCIPAL + PEND_INTEREST, "entire debt includes it");
    }

    function test_close_paysTheEntireDebtIncludingPendingRedistribution() public {
        _redistribute();
        uint256 entireNeeded = _entireDebt() - 200e18;
        uint256 oldStyleNeeded = mezo.getTroveDebt(address(vault)) - 200e18;
        assertLt(oldStyleNeeded, entireNeeded, "the old formula under-pulls");

        // alice holds exactly what closing needs now, which is more than the old formula asks for
        uint256 missing = entireNeeded - musd.balanceOf(alice);
        vm.prank(address(mezo));
        musd.mint(alice, missing);
        _approveMUSD(alice, address(vault));

        uint256 btcBefore = alice.balance;
        vm.prank(alice);
        vault.close();

        assertEq(musd.balanceOf(alice), 0, "paid exactly the entire debt");
        assertEq(musd.balanceOf(address(vault)), 0);
        assertEq(address(vault).balance, 0);
        // collateral comes back with the redistributed share
        assertEq(alice.balance, btcBefore + COLL + PEND_COLL);
        assertTrue(vault.closed());
    }

    function test_close_withPendingAndInterest_afterThirtyDays() public {
        _redistribute();
        skip(30 days);
        uint256 needed = _entireDebt() - 200e18;
        uint256 missing = needed - musd.balanceOf(alice);
        vm.prank(address(mezo));
        musd.mint(alice, missing);
        _approveMUSD(alice, address(vault));
        vm.prank(alice);
        vault.close();
        assertEq(musd.balanceOf(alice), 0);
        assertEq(mezo.getTroveStatus(address(vault)), 2);
    }

    function test_close_cannotBeUnderpaidByTheCaller() public {
        _redistribute();
        // alice only has her original 2000 and no way to cover the entire debt
        _approveMUSD(alice, address(vault));
        vm.prank(alice);
        vm.expectRevert();
        vault.close();
        assertEq(mezo.getTroveStatus(address(vault)), 1, "still open");
    }

    function test_icrViews_useTheSameEntireNumbers() public {
        _redistribute();
        (uint256 coll, uint256 debt) = vault.liveState();
        assertEq(coll, COLL + PEND_COLL);
        assertEq(coll * mezo.price() / debt, vault.currentICR());
        assertEq(vault.currentICR(), mezo.getCurrentICR(address(vault), mezo.price()));
    }

    function test_troveState_isEntireAndStableWhenPendingIsApplied() public {
        _redistribute();
        (, uint256 collA, uint256 principalA, uint16 rateA) = vault.troveState();
        assertEq(collA, COLL + PEND_COLL);
        assertEq(principalA, 2_202e18 + PEND_PRINCIPAL);

        // touching the trove applies the pending rewards, nothing economic changes, so the numbers must not move
        mezo.touch(address(vault));
        (, uint256 collB, uint256 principalB, uint16 rateB) = vault.troveState();
        assertEq(collB, collA);
        assertEq(principalB, principalA);
        assertEq(rateB, rateA);
        assertEq(mezo.getTroveColl(address(vault)), collA, "now stored too");
    }

    function test_listing_snapshotMovesWhenARedistributionHits() public {
        bytes32 snap = _list();
        _redistribute();
        assertTrue(market.snapshot(vault, MIN_ICR) != snap);
        vm.prank(bob);
        vm.expectRevert(DeedMarket.SnapshotMismatch.selector);
        market.buy(id, snap, PRICE);
    }

    function test_listing_snapshotSurvivesTouchWithoutNewRewards() public {
        _redistribute();
        bytes32 snap = _list();
        mezo.touch(address(vault));
        assertEq(market.snapshot(vault, MIN_ICR), snap);
        vm.prank(bob);
        market.buy(id, snap, PRICE);
        assertEq(deed.ownerOf(id), bob);
    }

    function test_rescue_startsOnEntireIcr_notTheStoredOne() public {
        _setPrice(40_000e18);
        // stored numbers: 4000 / 2202 is 181%, healthy
        vm.expectRevert();
        auction.startRescue(id);

        mezo.redistribute(address(vault), 0, 1_500e18, 0);
        // entire debt is 3702, ICR is 108%
        assertLt(vault.currentICR(), 1.2e18);
        auction.startRescue(id);

        (,,, , uint256 startPrice,) = auction.auctions(id);
        assertEq(startPrice, 4_000e18 - (_entireDebt() - 200e18), "equity uses entire debt");
        assertEq(auction.equityOf(id), startPrice);
    }

    function test_rescue_topUpTargetUsesEntireDebt() public {
        _setPrice(40_000e18);
        mezo.redistribute(address(vault), 0, 1_500e18, 0);
        (uint256 coll, uint256 debt) = vault.liveState();
        uint256 needed = (1.8e18 * debt + 40_000e18 - 1) / 40_000e18 - coll;
        assertEq(auction.requiredTopUp(id), needed);
    }

    function test_rescue_bidChecksSafeIcrOnEntireNumbers() public {
        _setPrice(40_000e18);
        mezo.redistribute(address(vault), 0, 1_500e18, 0);
        auction.startRescue(id);
        uint256 need = auction.requiredTopUp(id);
        uint256 price = auction.currentPrice(id);

        // one wei short of the entire-debt target is rejected, the exact amount passes
        vm.prank(bob);
        vm.expectRevert();
        auction.bid{value: need - 1}(id, price, address(0), address(0));
        vm.prank(bob);
        auction.bid{value: need}(id, price, address(0), address(0));
        assertEq(deed.ownerOf(id), bob);
    }

    function testFuzz_closeAlwaysPaysEntireDebt(uint96 pc, uint96 pp, uint96 pi, uint32 dt) public {
        pc = uint96(bound(pc, 0, 0.05 ether));
        pp = uint96(bound(pp, 0, 500e18));
        pi = uint96(bound(pi, 0, 50e18));
        mezo.redistribute{value: pc}(address(vault), pc, pp, pi);
        skip(bound(dt, 0, 365 days));
        uint256 needed = _entireDebt() - 200e18;
        vm.prank(address(mezo));
        musd.mint(alice, needed);
        _approveMUSD(alice, address(vault));
        uint256 before = musd.balanceOf(alice);
        vm.prank(alice);
        vault.close();
        // the vault takes only what is missing and sweeps the rest back
        assertEq(before - musd.balanceOf(alice), needed);
        assertEq(musd.balanceOf(address(vault)), 0);
    }
}
