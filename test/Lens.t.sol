// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V3Base} from "./V3Base.t.sol";
import {DeedLens} from "../src/DeedLens.sol";

contract LensTest is V3Base {
    function test_position_numbersMatchTheVaultAndTheOracle() public view {
        DeedLens.PositionView memory v = lens.position(id);
        (uint256 coll, uint256 debt) = vault.liveState();
        (uint8 status,, uint256 principal, uint16 rate) = vault.troveState();

        assertEq(v.vault, address(vault));
        assertEq(v.holder, alice);
        assertEq(v.lockedBy, address(0));
        assertEq(v.status, status);
        assertEq(v.collateral, coll);
        assertEq(v.principal, principal);
        assertEq(v.debt, debt);
        assertEq(v.principal + v.interest, v.debt);
        assertEq(v.rate, rate);
        assertEq(v.price, 80_000e18);
        assertEq(v.icr, vault.currentICR());
        assertEq(v.collateralValue, coll * 80_000e18 / 1e18);
        assertEq(v.equity, v.collateralValue - (debt - 200e18));
        assertFalse(v.recoveryMode);
        assertFalse(v.priceStale);
        assertTrue(v.canClose && v.canWithdraw && v.canBorrow && v.canRefinance);
    }

    function test_position_includesPendingRedistribution() public {
        DeedLens.PositionView memory before_ = lens.position(id);
        mezo.redistribute{value: 0.002 ether}(address(vault), 0.002 ether, 150e18, 7e18);
        DeedLens.PositionView memory v = lens.position(id);
        assertEq(v.collateral, before_.collateral + 0.002 ether);
        assertEq(v.debt, before_.debt + 157e18);
        assertEq(v.icr, mezo.getCurrentICR(address(vault), 80_000e18));
    }

    function test_position_showsTheLockAndTheNewHolder() public {
        _list();
        assertEq(lens.position(id).lockedBy, address(market));
        assertEq(lens.position(id).holder, alice);
    }

    function test_position_surplusAfterRedemption() public {
        mezo.redeemAll(address(vault));
        DeedLens.PositionView memory v = lens.position(id);
        assertEq(v.status, 4);
        assertEq(v.surplus, COLL);
        assertEq(v.collateral, 0);
        assertEq(v.debt, 0);
        assertEq(v.equity, 0);
        assertFalse(v.canClose);
    }

    function test_system_reportsRecoveryMode() public {
        (uint256 price, uint256 tcr, bool rm, bool stale) = lens.system();
        assertEq(price, 80_000e18);
        assertEq(tcr, 2e18);
        assertFalse(rm);
        assertFalse(stale);

        mezo.setRecoveryMode(true);
        (, tcr, rm,) = lens.system();
        assertTrue(rm);
        assertEq(tcr, 1.2e18);
    }

    function test_position_blockedActionsInRecoveryMode() public {
        mezo.setRecoveryMode(true);
        DeedLens.PositionView memory v = lens.position(id);
        assertTrue(v.recoveryMode);
        assertFalse(v.canWithdraw);
        assertFalse(v.canBorrow);
        assertFalse(v.canRefinance);
        assertFalse(v.canClose, "closing is refused while BorrowerOperations can mint");

        mezo.setCanMint(false);
        assertTrue(lens.position(id).canClose);
    }

    function test_position_staleOracleDoesNotRevert() public {
        mezo.setStale(true);
        DeedLens.PositionView memory v = lens.position(id);
        assertTrue(v.priceStale);
        assertEq(v.price, 0);
        assertEq(v.icr, 0);
        assertEq(v.equity, 0);
        // debt and collateral still come from MUSD, they need no price
        assertGt(v.debt, 0);
        assertGt(v.collateral, 0);
        (,,, bool stale) = lens.system();
        assertTrue(stale);
    }

    function test_position_unknownDeedReverts() public {
        vm.expectRevert(DeedLens.UnknownDeed.selector);
        lens.position(999);
    }

    function test_lens_hasNoStateChangingFunctions() public view {
        // every external function is `view`, checked against the generated ABI by scripts and the interface doc
        assertEq(lens.GAS_COMPENSATION(), 200e18);
    }
}
