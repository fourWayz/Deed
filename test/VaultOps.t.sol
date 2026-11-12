// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V3Base} from "./V3Base.t.sol";
import {PositionVault} from "../src/PositionVault.sol";
import {DeedMarket} from "../src/DeedMarket.sol";

/// claimSurplus, borrow, refinance and the Recovery Mode errors, all through the vault.
contract SurplusTest is V3Base {
    function test_claimSurplus_afterRedemptionClosedTheTrove() public {
        mezo.redeemAll(address(vault));
        assertEq(vault.surplus(), COLL);
        assertEq(mezo.getTroveStatus(address(vault)), 4);

        uint256 before = alice.balance;
        vm.prank(alice);
        vault.claimSurplus();
        assertEq(alice.balance, before + COLL);
        assertEq(vault.surplus(), 0);
        assertEq(address(vault).balance, 0);
    }

    function test_claimSurplus_secondClaimRevertsInsteadOfDoingNothing() public {
        mezo.redeemAll(address(vault));
        vm.startPrank(alice);
        vault.claimSurplus();
        vm.expectRevert(PositionVault.NothingToClaim.selector);
        vault.claimSurplus();
        vm.stopPrank();
    }

    function test_claimSurplus_liquidationLeavesNone() public {
        // in MUSD only a redemption that closes a trove accounts surplus, a liquidation takes everything
        mezo.liquidate(address(vault), 0);
        assertEq(vault.surplus(), 0);
        vm.prank(alice);
        vm.expectRevert(PositionVault.NothingToClaim.selector);
        vault.claimSurplus();
    }

    function test_claimSurplus_holderOnly() public {
        mezo.redeemAll(address(vault));
        vm.prank(mallory);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.claimSurplus();
    }

    function test_claimSurplus_goesToWhoeverHoldsTheDeedNow() public {
        mezo.redeemAll(address(vault));
        vm.prank(alice);
        deed.transferFrom(alice, bob, id);
        uint256 before = bob.balance;
        vm.prank(bob);
        vault.claimSurplus();
        assertEq(bob.balance, before + COLL);
    }

    function test_claimSurplus_frozenWhileListed() public {
        _list();
        mezo.redeemAll(address(vault));
        vm.prank(alice);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.claimSurplus();

        // the seller cancels and then claims
        vm.startPrank(alice);
        market.cancel(id);
        vault.claimSurplus();
        vm.stopPrank();
        assertEq(vault.surplus(), 0);
    }

    function test_listedPositionClosedByRedemption_cannotBeBought() public {
        bytes32 snap = _list();
        mezo.redeemAll(address(vault));
        vm.prank(bob);
        vm.expectRevert(DeedMarket.SnapshotMismatch.selector);
        market.buy(id, snap, PRICE);
    }
}

contract BorrowRefinanceTest is V3Base {
    function test_borrow_sendsMusdToHolderAndAddsFeeToDebt() public {
        (, , uint256 principalBefore,) = vault.troveState();
        uint256 musdBefore = musd.balanceOf(alice);
        vm.prank(alice);
        vault.borrow(300e18, address(0), address(0));

        assertEq(musd.balanceOf(alice), musdBefore + 300e18);
        assertEq(musd.balanceOf(address(vault)), 0);
        (, , uint256 principalAfter,) = vault.troveState();
        // 0.1% fee on top of the 300
        assertEq(principalAfter, principalBefore + 300e18 + 0.3e18);
    }

    function test_borrow_holderOnly() public {
        vm.prank(mallory);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.borrow(100e18, address(0), address(0));
    }

    function test_borrow_belowMcrBubblesTheMezoError() public {
        vm.prank(alice);
        vm.expectRevert("BorrowerOps: ICR < MCR");
        vault.borrow(6_000e18, address(0), address(0));
    }

    function test_borrow_frozenWhileListed() public {
        _list();
        vm.prank(alice);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.borrow(100e18, address(0), address(0));
    }

    function test_borrow_frozenWhileAuctioned() public {
        vm.prank(alice);
        auction.start(id, 8_000, 1 days);
        vm.prank(alice);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.borrow(100e18, address(0), address(0));
    }

    function test_refinance_movesTheRateAndChargesTheFee() public {
        mezo.setRate(50);
        (, , uint256 principalBefore, uint16 rateBefore) = vault.troveState();
        assertEq(rateBefore, 100);

        vm.expectEmit(address(vault));
        emit PositionVault.Refinanced(100, 50);
        vm.prank(alice);
        vault.refinance(address(0), address(0));

        (, , uint256 principalAfter, uint16 rateAfter) = vault.troveState();
        assertEq(rateAfter, 50);
        // 20% of the 0.1% borrowing fee on the 2,002 net debt
        assertEq(principalAfter, principalBefore + (20 * uint256(2_002e18) / 100) / 1000);
    }

    function test_refinance_holderOnlyAndFrozen() public {
        vm.prank(mallory);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.refinance(address(0), address(0));

        _list();
        vm.prank(alice);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.refinance(address(0), address(0));
    }

    function test_refinance_frozenWhileAuctioned() public {
        vm.prank(alice);
        auction.start(id, 8_000, 1 days);
        vm.prank(alice);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.refinance(address(0), address(0));
    }

    // the sale snapshot hashes principal and rate, so a borrow or a refinance made between two listings
    // makes the old hash useless

    function test_snapshot_coversBorrow() public {
        bytes32 snap = _list();
        vm.prank(alice);
        market.cancel(id);
        vm.prank(alice);
        vault.borrow(100e18, address(0), address(0));
        _list();
        vm.prank(bob);
        vm.expectRevert(DeedMarket.SnapshotMismatch.selector);
        market.buy(id, snap, PRICE);
    }

    function test_snapshot_coversRefinance() public {
        bytes32 snap = _list();
        vm.prank(alice);
        market.cancel(id);
        mezo.setRate(40);
        vm.prank(alice);
        vault.refinance(address(0), address(0));
        _list();
        vm.prank(bob);
        vm.expectRevert(DeedMarket.SnapshotMismatch.selector);
        market.buy(id, snap, PRICE);
    }

    function test_borrowedPosition_sellsWithTheNewSnapshot() public {
        vm.prank(alice);
        vault.borrow(100e18, address(0), address(0));
        bytes32 snap = _list();
        vm.prank(bob);
        market.buy(id, snap, PRICE);
        assertEq(deed.ownerOf(id), bob);
    }
}

contract RecoveryModeTest is V3Base {
    function setUp() public override {
        super.setUp();
        mezo.setRecoveryMode(true);
    }

    function test_withdraw_revertsClearly() public {
        vm.prank(alice);
        vm.expectRevert(PositionVault.RecoveryModeActive.selector);
        vault.withdraw(0.01 ether, address(0), address(0));
    }

    function test_borrow_revertsClearly() public {
        vm.prank(alice);
        vm.expectRevert(PositionVault.RecoveryModeActive.selector);
        vault.borrow(100e18, address(0), address(0));
    }

    function test_refinance_revertsClearly() public {
        vm.prank(alice);
        vm.expectRevert(PositionVault.RecoveryModeActive.selector);
        vault.refinance(address(0), address(0));
    }

    function test_close_revertsWhileBorrowerOperationsCanMint() public {
        vm.prank(address(mezo));
        musd.mint(alice, 500e18);
        _approveMUSD(alice, address(vault));
        vm.prank(alice);
        vm.expectRevert(PositionVault.RecoveryModeActive.selector);
        vault.close();
    }

    function test_close_worksInRecoveryModeOnceMintingIsOff() public {
        mezo.setCanMint(false);
        vm.prank(address(mezo));
        musd.mint(alice, 500e18);
        _approveMUSD(alice, address(vault));
        vm.prank(alice);
        vault.close();
        assertTrue(vault.closed());
    }

    function test_topUpAndRepay_stillWork() public {
        _approveMUSD(alice, address(vault));
        vm.startPrank(alice);
        vault.addCollateral{value: 0.01 ether}(address(0), address(0));
        // repay must leave the minimum net debt, so a small amount
        vault.repay(1e18, address(0), address(0));
        vm.stopPrank();
    }

    function test_marketSaleStillWorksInRecoveryMode() public {
        bytes32 snap = _list();
        vm.prank(bob);
        market.buy(id, snap, PRICE);
        assertEq(deed.ownerOf(id), bob);
    }
}
