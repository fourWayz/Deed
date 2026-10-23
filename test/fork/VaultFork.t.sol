// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeedNFT} from "../../src/DeedNFT.sol";
import {DeedFactory} from "../../src/DeedFactory.sol";
import {PositionVault} from "../../src/PositionVault.sol";
import {IBorrowerOperations, ITroveManager, IPriceFeed, IMUSD} from "../../src/interfaces/IMezo.sol";

/// Runs the vault against the real MUSD contracts on Mezo testnet.
/// Only PriceFeed.fetchPrice is mocked: the oracle is a chain precompile a fork cannot execute.
contract VaultForkTest is Test {
    IBorrowerOperations constant BO = IBorrowerOperations(0xCdF7028ceAB81fA0C6971208e83fa7872994beE5);
    ITroveManager constant TM = ITroveManager(0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0);
    IPriceFeed constant PF = IPriceFeed(0x86bCF0841622a5dAC14A313a15f96A95421b9366);
    IMUSD constant MUSD = IMUSD(0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503);

    DeedNFT deed;
    DeedFactory factory;
    address alice = makeAddr("alice");
    uint256 id;
    PositionVault vault;

    function setUp() public {
        vm.createSelectFork("mezo_testnet");
        vm.mockCall(address(PF), abi.encodeWithSelector(IPriceFeed.fetchPrice.selector), abi.encode(uint256(80_000e18)));
        deed = new DeedNFT();
        factory = new DeedFactory(deed, BO, TM, PF, MUSD);
        deed.init(address(factory), address(0), address(0));
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        (uint256 tokenId, address v) = factory.createPosition{value: 0.1 ether}(2_000e18, address(0), address(0));
        id = tokenId;
        vault = PositionVault(payable(v));
    }

    function test_open_realTrove() public view {
        assertEq(TM.getTroveStatus(address(vault)), 1);
        assertEq(MUSD.balanceOf(alice), 2_000e18);
        assertEq(TM.getTroveColl(address(vault)), 0.1 ether);
        // 2000 + 0.1% fee + 200 gas compensation
        assertEq(TM.getTrovePrincipal(address(vault)), 2_202e18);
        assertEq(address(vault).balance, 0);
        assertEq(MUSD.balanceOf(address(vault)), 0);
        assertEq(TM.getTroveInterestRate(address(vault)), 100);
    }

    function test_addCollateral_andWithdraw() public {
        vm.startPrank(alice);
        vault.addCollateral{value: 0.05 ether}(address(0), address(0));
        assertEq(TM.getTroveColl(address(vault)), 0.15 ether);
        uint256 before = alice.balance;
        vault.withdraw(0.03 ether, address(0), address(0));
        vm.stopPrank();
        assertEq(alice.balance, before + 0.03 ether);
        assertEq(TM.getTroveColl(address(vault)), 0.12 ether);
    }

    function test_repayAndClose_returnsEverything() public {
        // enough MUSD for the fee, interest and the repayment
        deal(address(MUSD), alice, 2_300e18);
        vm.startPrank(alice);
        MUSD.approve(address(vault), type(uint256).max);
        skip(10 days);
        uint256 before = alice.balance;
        vault.close();
        vm.stopPrank();

        assertEq(alice.balance, before + 0.1 ether);
        assertEq(TM.getTroveStatus(address(vault)), 2);
        assertEq(address(vault).balance, 0);
        assertEq(MUSD.balanceOf(address(vault)), 0);
        assertTrue(vault.closed());
    }

    function test_liveState_matchesTroveManager() public {
        skip(30 days);
        (uint256 coll, uint256 debt) = vault.liveState();
        assertEq(coll, 0.1 ether);
        assertEq(debt, TM.getTroveDebt(address(vault)));
        assertGt(debt, 2_202e18);
    }

    function test_strangerCannotTouchRealTrove() public {
        vm.prank(makeAddr("mallory"));
        vm.expectRevert(PositionVault.NotController.selector);
        vault.withdraw(0.01 ether, address(0), address(0));
    }
}
