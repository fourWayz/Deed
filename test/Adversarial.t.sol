// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AuctionBase} from "./RescueAuction.t.sol";
import {PositionVault} from "../src/PositionVault.sol";
import {DeedNFT} from "../src/DeedNFT.sol";
import {RescueAuction} from "../src/RescueAuction.sol";
import {DeedMarket} from "../src/DeedMarket.sol";

/// Attacks written against what the contracts promise, not against how they are built.
contract AdversarialTest is AuctionBase {
    // A seller's old MUSD allowance to the vault must not let the next owner spend the seller's MUSD.
    function test_staleAllowanceFromSeller_isNotSpendableByBuyer() public {
        _approveMUSD(alice, address(vault)); // alice approved the vault while she owned it
        vm.prank(alice);
        market.list(id, 100e18, uint64(block.timestamp + 1 days), 2e18);
        bytes32 snap = market.snapshot(vault, 2e18);
        _approveMUSD(bob, address(market));
        vm.prank(bob);
        market.buy(id, snap, 100e18);

        uint256 aliceBefore = musd.balanceOf(alice);
        // bob holds no allowance for the vault, so repay pulls from bob and fails, alice's balance is untouched
        vm.prank(bob);
        vm.expectRevert();
        vault.repay(100e18, address(0), address(0));
        assertEq(musd.balanceOf(alice), aliceBefore);
    }

    // Bidder sends a bid, owner cancels in front of it: the bidder loses nothing but gas.
    function test_ownerCancelsInFrontOfBid_bidderLosesNothing() public {
        vm.prank(alice);
        auction.start(id, 8_000, 1 days);
        uint256 price = auction.currentPrice(id);
        uint256 topUp = auction.requiredTopUp(id);

        vm.prank(alice);
        auction.cancel(id); // lands first

        uint256 musdBefore = musd.balanceOf(bob);
        uint256 btcBefore = bob.balance;
        vm.prank(bob);
        vm.expectRevert(RescueAuction.NotRunning.selector);
        auction.bid{value: topUp}(id, price, address(0), address(0));
        assertEq(musd.balanceOf(bob), musdBefore);
        assertEq(bob.balance, btcBefore);
    }

    // After an auction ends, nobody can use the venue hook to push BTC into the vault or move the Deed.
    function test_afterAuction_venueHookAndLockAreGone() public {
        vm.prank(alice);
        auction.start(id, 8_000, 1 days);
        vm.prank(alice);
        auction.cancel(id);

        vm.deal(address(auction), 1 ether);
        vm.prank(address(auction));
        vm.expectRevert(PositionVault.NotController.selector);
        vault.topUpFromVenue{value: 1}(address(0), address(0));

        vm.prank(address(auction));
        vm.expectRevert(DeedNFT.NotLocker.selector);
        deed.settle(id, mallory);
    }

    // BTC sent to a vault by anyone is swept to the holder on close, not stuck and not stealable.
    function test_donationToVault_goesToHolderOnClose() public {
        vm.deal(mallory, 5 ether);
        vm.prank(mallory);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertTrue(ok);

        vm.prank(address(mezo));
        musd.mint(alice, 100e18);
        _approveMUSD(alice, address(vault));
        uint256 before = alice.balance;
        vm.prank(alice);
        vault.close();
        assertEq(alice.balance, before + COLL + 1 ether);
        assertEq(address(vault).balance, 0);
    }

    // Someone who is not the holder cannot start an owner-style auction with a zero floor to dump the position.
    function test_strangerCannotStartOwnerAuction() public {
        vm.prank(mallory);
        vm.expectRevert(RescueAuction.NotOwner.selector);
        auction.start(id, 0, 1 hours);
    }

    // A third party cannot use startRescue on a healthy position, and cannot while the DEX disagrees with the oracle.
    function test_publicRescue_neverOnHealthyOrSkewedMarkets() public {
        vm.expectRevert();
        auction.startRescue(id); // 360% ICR

        mezo.setPrice(CRASH);
        spot.set(CRASH * 2); // attacker skews the DEX to make the rescue happen on their terms
        vm.expectRevert();
        auction.startRescue(id);
        spot.set(CRASH * 12 / 10); // 20% off, past the 5% limit used in this suite
        vm.expectRevert();
        auction.startRescue(id);
    }

    function _priceForICR(uint256 icr) internal view returns (uint256) {
        (uint256 coll, uint256 debt) = vault.liveState();
        return debt * icr / coll;
    }

    // Review finding 2: an owner who is away at 125% (far above liquidation) can no longer be bought out by a stranger.
    function test_awayOwnerAt125_cannotBeRescuedByStranger() public {
        _setPrice(_priceForICR(1.25e18));
        vm.prank(mallory);
        vm.expectRevert();
        auction.startRescue(id);
        assertEq(deed.lockedBy(id), address(0));
    }

    // Even when a stranger may start (under 120%), the price can never fall below 80% of the equity at the start.
    function testFuzz_strangerAuctionNeverPaysUnderEightyPercent(uint256 icrBps, uint256 waitSecs) public {
        icrBps = bound(icrBps, 11_100, 11_999); // 111% to 119.99%
        _setPrice(_priceForICR(icrBps * 1e14));
        auction.startRescue(id);
        (,,,, uint256 startPrice, uint256 floorPrice) = auction.auctions(id);
        assertEq(floorPrice, startPrice * 8_000 / 10_000);
        skip(bound(waitSecs, 0, 30 days));
        // after the duration the price rests at the floor, never below it
        uint256 p = auction.currentPrice(id);
        assertGe(p, startPrice * 8_000 / 10_000);
        assertLe(p, startPrice);
    }

    // A holder tricked into signing cannot be made to start an auction that sells for almost nothing.
    function test_noAuctionCanBeStartedWithAnythingBelowTheMinimumFloor() public {
        vm.startPrank(alice);
        for (uint256 bps = 0; bps < 8_000; bps += 799) {
            vm.expectRevert(RescueAuction.BadParams.selector);
            auction.start(id, bps, 1 days);
        }
        vm.stopPrank();
    }

    // The winner can never end up with a position under safeICR, whatever BTC they send.
    function testFuzz_winnerAlwaysLeavesAboveSafeICR(uint256 topUp, uint256 waitSecs) public {
        _setPrice(CRASH);
        auction.startRescue(id);
        waitSecs = bound(waitSecs, 0, 6 hours - 1);
        skip(waitSecs);
        topUp = bound(topUp, 0, 2 ether);
        uint256 price = auction.currentPrice(id);
        vm.prank(bob);
        try auction.bid{value: topUp}(id, price, address(0), address(0)) {
            assertGe(vault.currentICR(), SAFE_ICR);
            assertEq(deed.ownerOf(id), bob);
        } catch {
            assertEq(deed.ownerOf(id), alice);
        }
    }

    // The seller is paid exactly the price the bidder paid, whatever the timing.
    function testFuzz_paymentEqualsPrice(uint256 waitSecs) public {
        _setPrice(CRASH);
        auction.startRescue(id);
        skip(bound(waitSecs, 0, 6 hours - 1));
        uint256 price = auction.currentPrice(id);
        uint256 needed = auction.requiredTopUp(id) + 1;
        uint256 bobBefore = musd.balanceOf(bob);
        vm.prank(bob);
        auction.bid{value: needed}(id, price, address(0), address(0));
        assertEq(bobBefore - musd.balanceOf(bob), price);
        assertEq(auction.claimable(alice), price);
        assertEq(musd.balanceOf(address(auction)), price);
    }

    // A listing and an auction can never exist for the same Deed at once.
    function testFuzz_oneVenueAtATime(bool listFirst) public {
        vm.startPrank(alice);
        if (listFirst) {
            market.list(id, 100e18, uint64(block.timestamp + 1 days), 2e18);
            vm.expectRevert(DeedNFT.AlreadyLocked.selector);
            auction.start(id, 8_000, 1 days);
        } else {
            auction.start(id, 8_000, 1 days);
            vm.expectRevert(DeedNFT.AlreadyLocked.selector);
            market.list(id, 100e18, uint64(block.timestamp + 1 days), 2e18);
        }
        vm.stopPrank();
    }
}
