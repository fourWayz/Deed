// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V3Base} from "./V3Base.t.sol";
import {PositionVault} from "../src/PositionVault.sol";
import {DeedMarket} from "../src/DeedMarket.sol";
import {RescueAuction} from "../src/RescueAuction.sol";

/// One attack per v3 change. Each test says what the attacker is trying and shows it failing, or, where the
/// result is a deliberate fail-safe, shows the honest party recovering.
contract AdversarialV3Test is V3Base {
    // --- pending redistribution ---

    // A liquidation can land between a buyer reading the position and buying. The sale reverts instead of
    // selling something different, and the buyer simply reads the new state.
    function test_redistributionBetweenReadAndBuy_revertsAndTheBuyerRecovers() public {
        bytes32 stale = _list();
        mezo.redistribute{value: 0.001 ether}(address(vault), 0.001 ether, 90e18, 3e18);
        vm.prank(bob);
        vm.expectRevert(DeedMarket.SnapshotMismatch.selector);
        market.buy(id, stale, PRICE);

        // the seller relists, the buyer hashes the new state and the sale goes through
        vm.prank(alice);
        market.cancel(id);
        bytes32 fresh = _list();
        vm.prank(bob);
        market.buy(id, fresh, PRICE);
        assertEq(deed.ownerOf(id), bob);
    }

    // An attacker cannot make a holder under-pay at close by timing: the amount is read in the same transaction
    // that closes, so a redistribution right before it is already in the number.
    function test_closeCannotBeFrontRunIntoAnUnderpayment() public {
        mezo.redistribute{value: 0.003 ether}(address(vault), 0.003 ether, 400e18, 20e18);
        uint256 needed = _entireDebt() - 200e18;
        uint256 missing = needed - musd.balanceOf(alice);
        vm.prank(address(mezo));
        musd.mint(alice, missing);
        _approveMUSD(alice, address(vault));
        vm.prank(alice);
        vault.close();
        assertEq(mezo.getTroveStatus(address(vault)), 2);
        assertEq(musd.balanceOf(address(vault)), 0);
    }

    // The auction values the position on entire numbers, so redistributed debt cannot hide a loss from the
    // winner: they must still reach safeICR on the entire debt.
    function test_auctionWinnerCannotSkipTheRedistributedDebt() public {
        _setPrice(40_000e18);
        mezo.redistribute(address(vault), 0, 1_500e18, 0);
        auction.startRescue(id);
        uint256 price = auction.currentPrice(id);
        vm.prank(bob);
        vm.expectRevert();
        auction.bid{value: 0.01 ether}(id, price, address(0), address(0));
    }

    // --- surplus ---

    // After selling, the old holder has no claim on the vault's surplus any more.
    function test_formerHolderCannotClaimSurplusAfterTheSale() public {
        bytes32 snap = _list();
        vm.prank(bob);
        market.buy(id, snap, PRICE);
        mezo.redeemAll(address(vault));
        vm.prank(alice);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.claimSurplus();

        uint256 before = bob.balance;
        vm.prank(bob);
        vault.claimSurplus();
        assertEq(bob.balance, before + COLL);
    }

    // A stranger cannot pull the surplus to themselves, and cannot trigger the claim on the holder's behalf.
    function test_strangerCannotClaimOrTriggerSurplus() public {
        mezo.redeemAll(address(vault));
        vm.prank(mallory);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.claimSurplus();
        assertEq(vault.surplus(), COLL, "still waiting for the holder");
    }

    // --- borrow and refinance ---

    // A seller cannot slip a borrow in between the buyer reading the position and buying: while listed the
    // vault is frozen, and cancel, borrow and relist gives a new snapshot the old hash does not match.
    function test_sellerCannotBorrowAgainstAListedPosition() public {
        bytes32 snap = _list();
        vm.prank(alice);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.borrow(1_000e18, address(0), address(0));

        vm.startPrank(alice);
        market.cancel(id);
        vault.borrow(1_000e18, address(0), address(0));
        vm.stopPrank();
        _list();
        vm.prank(bob);
        vm.expectRevert(DeedMarket.SnapshotMismatch.selector);
        market.buy(id, snap, PRICE);
    }

    // A buyer cannot be handed a position whose rate was refinanced behind their back.
    function test_sellerCannotRefinanceBehindTheBuyersBack() public {
        bytes32 snap = _list();
        mezo.setRate(10);
        vm.prank(alice);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.refinance(address(0), address(0));

        vm.startPrank(alice);
        market.cancel(id);
        vault.refinance(address(0), address(0));
        vm.stopPrank();
        _list();
        vm.prank(bob);
        vm.expectRevert(DeedMarket.SnapshotMismatch.selector);
        market.buy(id, snap, PRICE);
    }

    // The minimum ICR promise holds against a seller who borrowed up to the limit before listing.
    function test_borrowedToTheLimit_cannotListAboveTheRealIcr() public {
        vm.prank(alice);
        vault.borrow(3_500e18, address(0), address(0));
        assertLt(vault.currentICR(), MIN_ICR);
        vm.prank(alice);
        vm.expectRevert(DeedMarket.BadMinICR.selector);
        market.list(id, PRICE, uint64(block.timestamp + 1 days), MIN_ICR);
    }

    // Recovery Mode does not trap a holder: they can still leave by selling.
    function test_recoveryMode_holderCanStillExitBySale() public {
        mezo.setRecoveryMode(true);
        vm.prank(alice);
        vm.expectRevert(PositionVault.RecoveryModeActive.selector);
        vault.withdraw(0.01 ether, address(0), address(0));
        bytes32 snap = _list();
        vm.prank(bob);
        market.buy(id, snap, PRICE);
        assertEq(deed.ownerOf(id), bob);
    }

    // --- fees ---

    // The treasury address cannot be reached by a seller to skip the fee: whatever the route into `buy`,
    // fee plus proceeds is the price.
    function test_noRouteToASaleAvoidsTheFee() public {
        bytes32 snap = _list();
        vm.prank(bob);
        market.buy(id, snap, PRICE);
        assertEq(market.claimable(treasury), market.feeFor(PRICE));
        assertGt(market.claimable(treasury), 0);
    }

    // A treasury that never claims, or cannot, changes nothing for sellers: balances are separate.
    function test_treasuryNeverClaiming_doesNotBlockTheSeller() public {
        bytes32 snap = _list();
        vm.prank(bob);
        market.buy(id, snap, PRICE);
        vm.prank(alice);
        market.claim();
        assertEq(market.claimable(alice), 0);
        assertEq(market.claimable(treasury), 50e18, "still waiting, untouched");
    }

    // A stranger cannot pull the treasury's fees or anyone else's proceeds.
    function test_strangerClaimGetsNothing() public {
        bytes32 snap = _list();
        vm.prank(bob);
        market.buy(id, snap, PRICE);
        vm.prank(mallory);
        vm.expectRevert(DeedMarket.NothingToClaim.selector);
        market.claim();
        assertEq(musd.balanceOf(address(market)), PRICE);
    }

    // Neither venue has a way to change the fee, the treasury or anything else after deployment.
    function test_noAdminFunctionsInTheInterfaces() public view {
        string[4] memory files = ["abis/DeedMarket.json", "abis/RescueAuction.json", "abis/DeedLens.json", "abis/PositionVault.json"];
        string[10] memory banned = [
            "setFee", "setTreasury", "setOwner", "transferOwnership", "pause", "unpause", "upgradeTo", "setFeeBps",
            "withdrawFees", "setPriceSource"
        ];
        for (uint256 i; i < files.length; i++) {
            string memory abi_ = vm.readFile(files[i]);
            for (uint256 j; j < banned.length; j++) {
                assertFalse(vm.contains(abi_, string.concat('"', banned[j], '"')), banned[j]);
            }
        }
    }

    // --- lens ---

    // The lens holds no funds and has no way to receive any.
    function test_lensCannotReceiveFunds() public {
        (bool ok,) = address(lens).call{value: 1 ether}("");
        assertFalse(ok);
        (ok,) = address(lens).call{value: 1 ether}(abi.encodeWithSignature("position(uint256)", id));
        assertFalse(ok);
        assertEq(address(lens).balance, 0);
    }

    // A stale oracle cannot be used to brick the screen that tells holders what is happening.
    function test_staleOracleDoesNotBrickTheLens() public {
        mezo.setStale(true);
        assertTrue(lens.position(id).priceStale);
        (,,, bool stale) = lens.system();
        assertTrue(stale);
    }
}
