// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {PositionVault} from "../src/PositionVault.sol";
import {DeedNFT} from "../src/DeedNFT.sol";

contract PositionVaultTest is Base {
    uint256 id;
    PositionVault vault;

    function setUp() public override {
        super.setUp();
        (id, vault) = _open(alice, COLL, DEBT);
        _approveMUSD(alice, address(vault));
    }

    // --- creation ---

    function test_createPosition_wiresEverything() public view {
        assertEq(deed.ownerOf(id), alice);
        assertEq(factory.vaultOf(id), address(vault));
        assertEq(musd.balanceOf(alice), DEBT);
        assertEq(musd.balanceOf(address(factory)), 0);
        assertEq(address(vault).balance, 0);
        assertEq(musd.balanceOf(address(vault)), 0);
        (uint8 status, uint256 coll, uint256 principal, uint16 rate) = vault.troveState();
        assertEq(status, 1);
        assertEq(coll, COLL);
        assertEq(principal, DEBT + DEBT / 1000 + 200e18);
        assertEq(rate, 100);
        assertTrue(vault.opened());
    }

    function test_createPosition_ids_increment() public {
        (uint256 id2,) = _open(bob, COLL, DEBT);
        assertEq(id2, id + 1);
    }

    function test_createPosition_revertsBelowMinDebt() public {
        vm.prank(bob);
        vm.expectRevert();
        factory.createPosition{value: COLL}(1_000e18, address(0), address(0));
    }

    function test_createPosition_revertsUnderCollateralised() public {
        vm.prank(bob);
        vm.expectRevert();
        factory.createPosition{value: 0.02 ether}(DEBT, address(0), address(0));
    }

    function test_open_onlyOnce() public {
        vm.prank(alice);
        vm.expectRevert(PositionVault.AlreadyOpened.selector);
        vault.open{value: COLL}(DEBT, address(0), address(0));
    }

    // --- controller actions ---

    function test_addCollateral() public {
        vm.prank(alice);
        vault.addCollateral{value: 1 ether}(address(0), address(0));
        (, uint256 coll,,) = vault.troveState();
        assertEq(coll, COLL + 1 ether);
        assertEq(address(vault).balance, 0);
    }

    function test_withdraw_sendsToController() public {
        uint256 before = alice.balance;
        vm.prank(alice);
        vault.withdraw(0.02 ether, address(0), address(0));
        assertEq(alice.balance, before + 0.02 ether);
        assertEq(address(vault).balance, 0);
    }

    function test_withdraw_revertsBelowMCR() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.withdraw(0.09 ether, address(0), address(0));
    }

    function test_repay_pullsMUSDFromController() public {
        // keep net debt above the minimum, so take a bigger loan first
        (uint256 id2, PositionVault v2) = _open(bob, 1 ether, 4_000e18);
        id2;
        _approveMUSD(bob, address(v2));
        vm.prank(bob);
        v2.repay(1_000e18, address(0), address(0));
        assertEq(musd.balanceOf(bob), 3_000e18);
        assertEq(musd.balanceOf(address(v2)), 0);
        (,, uint256 principal,) = v2.troveState();
        assertEq(principal, 4_000e18 + 4e18 + 200e18 - 1_000e18);
    }

    function test_repay_revertsWithoutAllowance() public {
        (, PositionVault v2) = _open(bob, 1 ether, 4_000e18);
        vm.prank(bob);
        vm.expectRevert();
        v2.repay(1_000e18, address(0), address(0));
    }

    function test_close_returnsCollateralAndSweeps() public {
        // alice needs the fee and interest on top of what she borrowed
        musd_mint(alice, 100e18);
        skip(30 days);
        uint256 before = alice.balance;
        vm.prank(alice);
        vault.close();
        assertEq(alice.balance, before + COLL);
        assertEq(address(vault).balance, 0);
        assertEq(musd.balanceOf(address(vault)), 0);
        assertTrue(vault.closed());
        (uint8 status,,,) = vault.troveState();
        assertEq(status, 2);
    }

    function test_close_revertsIfControllerCannotPay() public {
        // alice spent everything she borrowed
        vm.prank(alice);
        musd.transfer(bob, DEBT);
        vm.prank(alice);
        vm.expectRevert();
        vault.close();
        assertFalse(vault.closed());
    }

    function test_afterClose_nothingWorks() public {
        musd_mint(alice, 100e18);
        vm.startPrank(alice);
        vault.close();
        vm.expectRevert(PositionVault.NotOpen.selector);
        vault.addCollateral{value: 1 ether}(address(0), address(0));
        vm.expectRevert(PositionVault.NotOpen.selector);
        vault.close();
        vm.expectRevert(PositionVault.AlreadyOpened.selector);
        vault.open{value: COLL}(DEBT, address(0), address(0));
        vm.stopPrank();
    }

    function test_claimSurplus_afterLiquidation() public {
        vm.deal(address(mezo), 1 ether);
        mezo.liquidate(address(vault), 0.05 ether);
        uint256 before = alice.balance;
        vm.prank(alice);
        vault.claimSurplus();
        assertEq(alice.balance, before + 0.05 ether);
        assertEq(address(vault).balance, 0);
    }

    // --- access control ---

    function test_onlyController_everyAction() public {
        vm.startPrank(mallory);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.addCollateral{value: 1 ether}(address(0), address(0));
        vm.expectRevert(PositionVault.NotController.selector);
        vault.repay(1, address(0), address(0));
        vm.expectRevert(PositionVault.NotController.selector);
        vault.withdraw(1, address(0), address(0));
        vm.expectRevert(PositionVault.NotController.selector);
        vault.close();
        vm.expectRevert(PositionVault.NotController.selector);
        vault.claimSurplus();
        vm.expectRevert(PositionVault.NotController.selector);
        vault.open{value: 1 ether}(DEBT, address(0), address(0));
        vm.stopPrank();
    }

    function test_transferDeed_movesControl() public {
        vm.prank(alice);
        deed.transferFrom(alice, bob, id);

        vm.prank(alice);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.withdraw(0.01 ether, address(0), address(0));

        uint256 before = bob.balance;
        vm.prank(bob);
        vault.withdraw(0.01 ether, address(0), address(0));
        assertEq(bob.balance, before + 0.01 ether);
    }

    function test_approvedOperatorIsNotController() public {
        vm.prank(alice);
        deed.approve(bob, id);
        vm.prank(bob);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.withdraw(0.01 ether, address(0), address(0));
    }

    function test_vaultFrozenWhileLocked() public {
        vm.prank(venue);
        deed.lock(id);
        vm.startPrank(alice);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.withdraw(0.01 ether, address(0), address(0));
        vm.expectRevert(PositionVault.NotController.selector);
        vault.addCollateral{value: 1 ether}(address(0), address(0));
        vm.expectRevert(PositionVault.NotController.selector);
        vault.close();
        vm.stopPrank();

        vm.prank(venue);
        deed.unlock(id);
        vm.prank(alice);
        vault.withdraw(0.01 ether, address(0), address(0));
    }

    // --- fuzz ---

    function testFuzz_create_vaultHoldsNothing(uint256 coll, uint256 debt) public {
        debt = bound(debt, 1_800e18, 50_000e18);
        // enough collateral for 120% to 1000% ICR
        uint256 composite = debt + debt / 1000 + 200e18;
        uint256 minColl = composite * 1.2e18 / mezo.price();
        coll = bound(coll, minColl + 1, minColl * 10);
        vm.deal(bob, coll);
        (uint256 id2, PositionVault v2) = _open(bob, coll, debt);
        assertEq(deed.ownerOf(id2), bob);
        assertEq(address(v2).balance, 0);
        assertEq(musd.balanceOf(address(v2)), 0);
        assertEq(musd.balanceOf(bob), debt);
        (, uint256 c,,) = v2.troveState();
        assertEq(c, coll);
    }

    function testFuzz_withdrawNeverBreaksICR(uint256 amount) public {
        amount = bound(amount, 1, COLL);
        vm.prank(alice);
        try vault.withdraw(amount, address(0), address(0)) {
            assertGe(vault.currentICR(), 1.1e18);
        } catch {}
        assertEq(address(vault).balance, 0);
    }

    function testFuzz_interestAccruesOnPrincipal(uint256 dt) public {
        dt = bound(dt, 0, 3 * 365 days);
        (,, uint256 principal0, uint16 rate) = vault.troveState();
        skip(dt);
        (, uint256 debt) = vault.liveState();
        assertEq(debt, principal0 + principal0 * rate * dt / (10_000 * 365 days));
        (,, uint256 principal1,) = vault.troveState();
        assertEq(principal1, principal0);
    }

    function musd_mint(address to, uint256 amount) internal {
        vm.prank(address(mezo));
        musd.mint(to, amount);
    }
}
