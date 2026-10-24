// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AuctionBase} from "./RescueAuction.t.sol";
import {PositionVault} from "../src/PositionVault.sol";
import {DeedNFT} from "../src/DeedNFT.sol";

/// While a listing or an auction holds the Deed, the vault does nothing for anyone, the holder included,
/// and the Deed itself cannot move. When the venue lets go, the holder has control again.
contract FrozenVaultTest is AuctionBase {
    enum Venue {
        Listing,
        Auction
    }

    function _lock(Venue v) internal {
        vm.prank(alice);
        if (v == Venue.Listing) market.list(id, 100e18, uint64(block.timestamp + 1 days), 2e18);
        else auction.start(id, 8_000, 1 days);
    }

    function _unlock(Venue v) internal {
        vm.prank(alice);
        if (v == Venue.Listing) market.cancel(id);
        else auction.cancel(id);
    }

    struct Snapshot {
        uint8 status;
        uint256 coll;
        uint256 principal;
        uint16 rate;
        uint256 vaultBtc;
        uint256 vaultMusd;
        address owner;
        address lockedBy;
    }

    function _snapshot() internal view returns (Snapshot memory s) {
        (s.status, s.coll, s.principal, s.rate) = vault.troveState();
        s.vaultBtc = address(vault).balance;
        s.vaultMusd = musd.balanceOf(address(vault));
        s.owner = deed.ownerOf(id);
        s.lockedBy = deed.lockedBy(id);
    }

    function _same(Snapshot memory a, Snapshot memory b) internal pure returns (bool) {
        return a.status == b.status && a.coll == b.coll && a.principal == b.principal && a.rate == b.rate
            && a.vaultBtc == b.vaultBtc && a.vaultMusd == b.vaultMusd && a.owner == b.owner && a.lockedBy == b.lockedBy;
    }

    /// every entry point of the vault, from `who`, must be refused
    function _tryEverything(address who, uint256 amount) internal {
        vm.deal(who, 10 ether);
        vm.startPrank(who);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.open{value: amount}(2_000e18, address(0), address(0));
        vm.expectRevert(PositionVault.NotController.selector);
        vault.addCollateral{value: amount}(address(0), address(0));
        vm.expectRevert(PositionVault.NotController.selector);
        vault.repay(amount, address(0), address(0));
        vm.expectRevert(PositionVault.NotController.selector);
        vault.withdraw(amount, address(0), address(0));
        vm.expectRevert(PositionVault.NotController.selector);
        vault.close();
        vm.expectRevert(PositionVault.NotController.selector);
        vault.claimSurplus();
        vm.stopPrank();
    }

    // --- the headline claims, once per venue ---

    function test_listedVault_isFrozenForTheHolderAndEveryoneElse() public {
        _lock(Venue.Listing);
        Snapshot memory before = _snapshot();
        vm.prank(alice);
        deed.approve(bob, id); // an approved operator is no more able to act than anyone

        _tryEverything(alice, 0.01 ether); // the holder
        _tryEverything(bob, 0.01 ether); // approved operator
        _tryEverything(mallory, 0.01 ether); // stranger
        _tryEverything(address(market), 0.01 ether); // the venue that holds the lock
        _tryEverything(address(auction), 0.01 ether); // the other venue
        _tryEverything(address(factory), 0.01 ether);

        assertTrue(_same(before, _snapshot()), "state moved while listed");
    }

    function test_auctionedVault_isFrozenForTheHolderAndEveryoneElse() public {
        _lock(Venue.Auction);
        Snapshot memory before = _snapshot();
        vm.prank(alice);
        deed.approve(bob, id);

        _tryEverything(alice, 0.01 ether);
        _tryEverything(bob, 0.01 ether);
        _tryEverything(mallory, 0.01 ether);
        _tryEverything(address(auction), 0.01 ether); // even the venue only has its top-up hook
        _tryEverything(address(market), 0.01 ether);
        _tryEverything(address(factory), 0.01 ether);

        assertTrue(_same(before, _snapshot()), "state moved during the auction");
    }

    function test_lockedDeed_cannotBeMovedByHolderOrOperator() public {
        for (uint256 i; i < 2; ++i) {
            _lock(Venue(i));
            vm.prank(alice);
            deed.setApprovalForAll(bob, true);
            vm.startPrank(alice);
            vm.expectRevert(DeedNFT.Locked.selector);
            deed.transferFrom(alice, mallory, id);
            vm.expectRevert(DeedNFT.Locked.selector);
            deed.safeTransferFrom(alice, mallory, id);
            vm.stopPrank();
            vm.startPrank(bob);
            vm.expectRevert(DeedNFT.Locked.selector);
            deed.transferFrom(alice, bob, id);
            vm.stopPrank();
            assertEq(deed.ownerOf(id), alice);
            vm.prank(alice);
            deed.setApprovalForAll(bob, false);
            _unlock(Venue(i));
        }
    }

    // --- the only way in is the auction's top-up hook, and it only adds collateral ---

    function test_duringAuction_theOnlyChangeAllowedIsMoreCollateral() public {
        _lock(Venue.Auction);
        (, uint256 collBefore, uint256 principalBefore,) = vault.troveState();
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        auction.topUp{value: 0.01 ether}(id, address(0), address(0)); // seller, through the auction
        (, uint256 collAfter, uint256 principalAfter,) = vault.troveState();
        assertEq(collAfter, collBefore + 0.01 ether);
        assertEq(principalAfter, principalBefore);

        // the hook is closed to everyone but the venue that holds the lock
        vm.deal(address(market), 1 ether);
        vm.prank(address(market));
        vm.expectRevert(PositionVault.NotController.selector);
        vault.topUpFromVenue{value: 1}(address(0), address(0));
        vm.prank(alice);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.topUpFromVenue{value: 1}(address(0), address(0));
    }

    // --- control comes back when the venue lets go ---

    function test_afterTheVenueLetsGo_theHolderActsAgain() public {
        for (uint256 i; i < 2; ++i) {
            _lock(Venue(i));
            _unlock(Venue(i));
            assertEq(deed.lockedBy(id), address(0));
            vm.prank(alice);
            vault.addCollateral{value: 1 gwei}(address(0), address(0));
            vm.prank(alice);
            vault.withdraw(1 gwei, address(0), address(0));
            // and a stranger still cannot
            vm.prank(mallory);
            vm.expectRevert(PositionVault.NotController.selector);
            vault.withdraw(1, address(0), address(0));
        }
    }

    function test_afterASale_theBuyerHoldsTheVaultAndTheSellerDoesNot() public {
        _lock(Venue.Listing);
        _approveMUSD(bob, address(market));
        bytes32 snap = market.snapshot(vault, 2e18);
        vm.prank(bob);
        market.buy(id, snap, 100e18);

        vm.prank(alice);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.withdraw(1, address(0), address(0));
        vm.prank(bob);
        vault.addCollateral{value: 1 gwei}(address(0), address(0));
    }

    // --- the holder, an approved operator or anyone, any amount, either venue ---

    // role 0 is the holder, role 1 an approved operator, anything else an arbitrary address. The holder is the case that
    // only the lock can stop, a stranger is refused by the owner check alone.
    function testFuzz_frozenAgainstAnyCallerAnyAmount(uint8 role, address other, uint256 amount, bool useAuction) public {
        vm.assume(other != address(0) && other != address(this));
        // not the cheatcode address, console, or precompiles
        vm.assume(uint160(other) > 0xFFFF && other != address(vm));
        amount = bound(amount, 0, 1 ether);

        address who = role == 0 ? alice : role == 1 ? bob : other;
        _lock(useAuction ? Venue.Auction : Venue.Listing);
        vm.prank(alice);
        deed.approve(bob, id);

        Snapshot memory before = _snapshot();
        _tryEverything(who, amount);
        assertTrue(_same(before, _snapshot()), "state moved");
    }
}