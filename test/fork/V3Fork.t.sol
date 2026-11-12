// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeedNFT} from "../../src/DeedNFT.sol";
import {DeedFactory} from "../../src/DeedFactory.sol";
import {PositionVault} from "../../src/PositionVault.sol";
import {DeedLens} from "../../src/DeedLens.sol";
import {IBorrowerOperations, ITroveManager, IPriceFeed, IMUSD} from "../../src/interfaces/IMezo.sol";

interface IRealTroveManager is ITroveManager {
    function batchLiquidateTroves(address[] memory troves) external;
    function redeemCollateral(
        uint256 amount,
        address firstHint,
        address upperHint,
        address lowerHint,
        uint256 partialNICR,
        uint256 maxIterations
    ) external;
    function getPendingCollateral(address borrower) external view returns (uint256);
    function getPendingDebt(address borrower) external view returns (uint256, uint256);
}

interface IHintHelpers {
    function computeNominalCR(uint256 coll, uint256 debt) external pure returns (uint256);
    function getApproxHint(uint256 nicr, uint256 numTrials, uint256 seed)
        external
        view
        returns (address hint, uint256 diff, uint256 latestRandomSeed);
}

interface ISortedTroves {
    function findInsertPosition(uint256 nicr, address upper, address lower) external view returns (address, address);
}

interface IRealBorrowerOperations is IBorrowerOperations {
    function stabilityPoolAddress() external view returns (address);
    function refinancingFeePercentage() external view returns (uint8);
    function borrowingRate() external view returns (uint256);
}

/// The v3 vault actions against the real MUSD contracts on a Mezo testnet fork.
/// Only PriceFeed.fetchPrice is mocked (the oracle is a chain precompile) and, for the redistribution test,
/// the Stability Pool's deposit total, so a liquidation redistributes instead of being absorbed by the pool.
contract V3ForkTest is Test {
    IRealBorrowerOperations constant BO = IRealBorrowerOperations(0xCdF7028ceAB81fA0C6971208e83fa7872994beE5);
    IRealTroveManager constant TM = IRealTroveManager(0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0);
    IPriceFeed constant PF = IPriceFeed(0x86bCF0841622a5dAC14A313a15f96A95421b9366);
    IMUSD constant MUSD = IMUSD(0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503);
    IHintHelpers constant HH = IHintHelpers(0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6);
    ISortedTroves constant SORTED = ISortedTroves(0x722E4D24FD6Ff8b0AC679450F3D91294607268fA);

    DeedNFT deed;
    DeedFactory factory;
    DeedLens lens;
    address alice = makeAddr("alice");

    receive() external payable {}

    function setUp() public {
        vm.createSelectFork("mezo_testnet", 16_736_371);
        _price(80_000e18);
        deed = new DeedNFT();
        factory = new DeedFactory(deed, BO, TM, PF, MUSD);
        deed.init(address(factory), address(0), address(0));
        lens = new DeedLens(deed, factory, BO, TM, PF, MUSD);
        vm.deal(alice, 100 ether);
    }

    function _price(uint256 p) internal {
        vm.mockCall(address(PF), abi.encodeWithSelector(IPriceFeed.fetchPrice.selector), abi.encode(p));
    }

    /// A trove near 110% sits at the tail of a list of hundreds, and without hints SortedTroves walks all of it
    /// and runs out of gas. Same lookup the app and scripts/e2e-v3.mjs do.
    function _hints(uint256 coll, uint256 debt) internal view returns (address upper, address lower) {
        uint256 principal = debt + debt * BO.borrowingRate() / 1e18 + 200e18;
        uint256 nicr = HH.computeNominalCR(coll, principal);
        (address hint,,) = HH.getApproxHint(nicr, 300, 42);
        return SORTED.findInsertPosition(nicr, hint, hint);
    }

    function _open(uint256 coll, uint256 debt) internal returns (uint256 id, PositionVault v) {
        (address up, address low) = _hints(coll, debt);
        vm.prank(alice);
        (uint256 tokenId, address vault) = factory.createPosition{value: coll}(debt, up, low);
        return (tokenId, PositionVault(payable(vault)));
    }

    // --- pending redistribution ---

    /// a trove of ours at ~111% is liquidated with the Stability Pool empty, so its collateral and debt are
    /// redistributed over every trove, the vault's included
    function _redistributeTo(PositionVault vault) internal {
        // 3 BTC at 80k is 240k. 216,000 of debt is about 111% before the fee and gas compensation
        (address up, address low) = _hints(3 ether, 215_500e18);
        BO.openTrove{value: 3 ether}(215_500e18, up, low);
        // the pool absorbs nothing, and the price falls far enough for the trove to be under 110%
        vm.mockCall(BO.stabilityPoolAddress(), abi.encodeWithSignature("getTotalMUSDDeposits()"), abi.encode(uint256(0)));
        _price(70_000e18);
        assertLt(TM.getCurrentICR(address(this), 70_000e18), 1.1e18, "victim is liquidatable");

        address[] memory victims = new address[](1);
        victims[0] = address(this);
        TM.batchLiquidateTroves(victims);
        assertEq(TM.getTroveStatus(address(this)), 3, "victim liquidated");
        assertGt(TM.getPendingCollateral(address(vault)), 0, "vault has pending collateral");
        (uint256 pp,) = TM.getPendingDebt(address(vault));
        assertGt(pp, 0, "vault has pending debt");
    }

    function test_realMusd_getTroveDebtLeavesPendingOut() public {
        (, PositionVault vault) = _open(5 ether, 2_000e18);
        uint256 storedBefore = TM.getTroveDebt(address(vault));
        _redistributeTo(vault);

        (uint256 coll, uint256 principal, uint256 interest, uint256 pendingColl, uint256 pendingPrincipal,) =
            TM.getEntireDebtAndColl(address(vault));
        assertEq(TM.getTroveDebt(address(vault)), storedBefore, "stored debt ignores the pending part");
        assertGt(principal + interest, TM.getTroveDebt(address(vault)), "entire debt is larger");
        assertEq(coll, 5 ether + pendingColl);
        assertGt(pendingPrincipal, 0);

        // the vault's own numbers match MUSD's entire numbers
        (uint256 vColl, uint256 vDebt) = vault.liveState();
        assertEq(vColl, coll);
        assertEq(vDebt, principal + interest);
        assertEq(vColl * 70_000e18 / vDebt, vault.currentICR());
        assertEq(vault.currentICR(), TM.getCurrentICR(address(vault), 70_000e18));
    }

    function test_realMusd_closePaysTheEntireDebtIncludingPending() public {
        (, PositionVault vault) = _open(5 ether, 2_000e18);
        _redistributeTo(vault);
        // back to a price at which closing is allowed and TCR is healthy
        _price(80_000e18);

        (uint256 coll, uint256 principal, uint256 interest, uint256 pendingColl,,) =
            TM.getEntireDebtAndColl(address(vault));
        uint256 needed = principal + interest - 200e18;
        uint256 oldStyle = TM.getTroveDebt(address(vault)) - 200e18;
        assertLt(oldStyle, needed);

        // alice holds exactly the entire debt minus gas compensation
        deal(address(MUSD), alice, needed);
        vm.startPrank(alice);
        MUSD.approve(address(vault), type(uint256).max);
        uint256 btcBefore = alice.balance;
        vault.close();
        vm.stopPrank();

        assertEq(TM.getTroveStatus(address(vault)), 2, "closed by owner");
        assertEq(MUSD.balanceOf(alice), 0, "paid the entire debt, nothing more");
        assertEq(MUSD.balanceOf(address(vault)), 0);
        assertEq(address(vault).balance, 0);
        assertEq(alice.balance, btcBefore + coll, "all collateral back, redistributed share included");
        assertGt(pendingColl, 0);
    }

    function test_realMusd_theOldAmountIsNotEnoughForCloseTrove() public {
        (, PositionVault vault) = _open(5 ether, 2_000e18);
        _redistributeTo(vault);
        _price(80_000e18);
        uint256 oldStyle = TM.getTroveDebt(address(vault)) - 200e18;
        // the vault holds only what the old formula asked for, and MUSD refuses to close
        deal(address(MUSD), address(vault), oldStyle);
        vm.prank(address(vault));
        vm.expectRevert(bytes("BorrowerOps: Caller doesnt have enough mUSD to make repayment"));
        BO.closeTrove();
    }

    function test_realMusd_marketSnapshotCoversTheRedistribution() public {
        (, PositionVault vault) = _open(5 ether, 2_000e18);
        (, uint256 c0, uint256 p0,) = vault.troveState();
        _redistributeTo(vault);
        (, uint256 c1, uint256 p1,) = vault.troveState();
        assertGt(c1, c0);
        assertGt(p1, p0);
        // applying the pending rewards (any trove operation) changes nothing the snapshot hashes
        vm.prank(alice);
        // addColl of 1 wei applies the pending rewards and adds one wei, so compare against that
        vault.addCollateral{value: 1}(address(0), address(0));
        (, uint256 c2, uint256 p2,) = vault.troveState();
        assertEq(c2, c1 + 1);
        assertEq(p2, p1);
        assertEq(TM.getTroveColl(address(vault)), c2, "now stored too");
    }

    // --- surplus after a redemption ---

    function test_realMusd_claimSurplusAfterARedemptionClosesTheTrove() public {
        // lowest ICR in the system, so a redemption reaches this trove first
        (, PositionVault vault) = _open(0.05 ether, 3_430e18);
        assertGe(vault.currentICR(), 1.1e18);

        uint256 amount = TM.getTroveDebt(address(vault)) - 200e18;
        deal(address(MUSD), address(this), amount);
        TM.redeemCollateral(amount, address(vault), address(0), address(0), 0, 1);

        assertEq(TM.getTroveStatus(address(vault)), 4, "closed by redemption");
        uint256 surplus = vault.surplus();
        assertGt(surplus, 0, "redemption left surplus collateral");

        vm.startPrank(alice);
        uint256 before = alice.balance;
        vault.claimSurplus();
        assertEq(alice.balance, before + surplus);
        assertEq(vault.surplus(), 0);
        assertEq(address(vault).balance, 0);
        vm.expectRevert(PositionVault.NothingToClaim.selector);
        vault.claimSurplus();
        vm.stopPrank();
    }

    function test_realMusd_liquidationLeavesNoSurplus() public {
        (, PositionVault vault) = _open(0.05 ether, 3_430e18);
        vm.mockCall(BO.stabilityPoolAddress(), abi.encodeWithSignature("getTotalMUSDDeposits()"), abi.encode(uint256(0)));
        _price(60_000e18);
        address[] memory victims = new address[](1);
        victims[0] = address(vault);
        TM.batchLiquidateTroves(victims);
        assertEq(TM.getTroveStatus(address(vault)), 3);
        assertEq(vault.surplus(), 0, "MUSD only accounts surplus for redemptions");
        vm.prank(alice);
        vm.expectRevert(PositionVault.NothingToClaim.selector);
        vault.claimSurplus();
    }

    // --- borrow and refinance ---

    function test_realMusd_borrow() public {
        (, PositionVault vault) = _open(0.1 ether, 2_000e18);
        (, , uint256 principalBefore,) = vault.troveState();
        uint256 musdBefore = MUSD.balanceOf(alice);
        vm.prank(alice);
        vault.borrow(500e18, address(0), address(0));
        assertEq(MUSD.balanceOf(alice), musdBefore + 500e18);
        assertEq(MUSD.balanceOf(address(vault)), 0);
        (, , uint256 principalAfter,) = vault.troveState();
        assertEq(principalAfter, principalBefore + 500e18 + 500e18 * BO.borrowingRate() / 1e18);
    }

    function test_realMusd_refinance() public {
        (, PositionVault vault) = _open(0.1 ether, 2_000e18);
        (, , uint256 principalBefore,) = vault.troveState();
        uint256 netDebt = TM.getTroveDebt(address(vault)) - 200e18;
        vm.prank(alice);
        vault.refinance(address(0), address(0));
        (, , uint256 principalAfter, uint16 rate) = vault.troveState();
        uint256 fee = (uint256(BO.refinancingFeePercentage()) * netDebt / 100) * BO.borrowingRate() / 1e18;
        assertEq(principalAfter, principalBefore + fee, "refinancing fee added to the debt");
        assertEq(rate, TM.getTroveInterestRate(address(vault)));
    }

    // --- recovery mode ---

    function test_realMusd_recoveryModeBlocksMatchTheVaultErrors() public {
        (, PositionVault vault) = _open(0.1 ether, 2_000e18);
        // far enough down that the system TCR is under 150%
        _price(38_000e18);
        assertTrue(TM.checkRecoveryMode(38_000e18), "recovery mode");
        assertTrue(MUSD.mintList(address(BO)));

        vm.startPrank(alice);
        vm.expectRevert(PositionVault.RecoveryModeActive.selector);
        vault.withdraw(0.01 ether, address(0), address(0));
        vm.expectRevert(PositionVault.RecoveryModeActive.selector);
        vault.borrow(100e18, address(0), address(0));
        vm.expectRevert(PositionVault.RecoveryModeActive.selector);
        vault.refinance(address(0), address(0));
        vm.expectRevert(PositionVault.RecoveryModeActive.selector);
        vault.close();
        vm.stopPrank();

        // the same calls made by the vault itself are refused by MUSD, so the vault's errors are not stricter
        vm.startPrank(address(vault));
        vm.expectRevert(bytes("BorrowerOps: Collateral withdrawal not permitted Recovery Mode"));
        BO.withdrawColl(0.01 ether, address(0), address(0));
        vm.expectRevert(bytes("BorrowerOps: Cannot decrease your Trove's ICR in Recovery Mode"));
        BO.withdrawMUSD(100e18, address(0), address(0));
        vm.expectRevert(bytes("BorrowerOps: Operation not permitted during Recovery Mode"));
        BO.refinance(address(0), address(0));
        vm.expectRevert(bytes("BorrowerOps: Operation not permitted during Recovery Mode"));
        BO.closeTrove();
        vm.stopPrank();

        // topping up stays allowed
        vm.prank(alice);
        vault.addCollateral{value: 0.01 ether}(address(0), address(0));
    }

    // --- lens ---

    function test_realMusd_lensMatchesMusd() public {
        (uint256 id, PositionVault vault) = _open(0.1 ether, 2_000e18);
        DeedLens.PositionView memory v = lens.position(id);
        (uint256 coll, uint256 principal, uint256 interest,,,) = TM.getEntireDebtAndColl(address(vault));
        assertEq(v.collateral, coll);
        assertEq(v.principal, principal);
        assertEq(v.interest, interest);
        assertEq(v.icr, TM.getCurrentICR(address(vault), 80_000e18));
        assertEq(v.tcr, TM.getTCR(80_000e18));
        assertFalse(v.recoveryMode);
        assertEq(v.status, 1);
        assertEq(v.holder, alice);
        assertEq(v.equity, coll * 80_000e18 / 1e18 - (principal + interest - 200e18));
        assertTrue(v.canClose && v.canWithdraw && v.canBorrow && v.canRefinance);

        _price(38_000e18);
        v = lens.position(id);
        assertTrue(v.recoveryMode);
        assertFalse(v.canWithdraw || v.canBorrow || v.canRefinance || v.canClose);
    }
}
