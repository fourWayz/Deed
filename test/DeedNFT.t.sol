// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {DeedNFT} from "../src/DeedNFT.sol";
import {PositionVault} from "../src/PositionVault.sol";

contract DeedNFTTest is Base {
    uint256 id;
    PositionVault vault;

    function setUp() public override {
        super.setUp();
        (id, vault) = _open(alice, COLL, DEBT);
    }

    function test_init_onlyDeployerAndOnlyOnce() public {
        DeedNFT d = new DeedNFT();
        vm.prank(mallory);
        vm.expectRevert(DeedNFT.NotDeployer.selector);
        d.init(mallory, mallory, mallory);

        d.init(address(1), address(2), address(3));
        vm.expectRevert(DeedNFT.AlreadyInitialized.selector);
        d.init(address(4), address(5), address(6));
        assertEq(d.factory(), address(1));
    }

    function test_mint_onlyFactory() public {
        vm.prank(mallory);
        vm.expectRevert(DeedNFT.NotFactory.selector);
        deed.mint(mallory);
    }

    function test_lock_onlyVenues() public {
        vm.prank(mallory);
        vm.expectRevert(DeedNFT.NotVenue.selector);
        deed.lock(id);

        vm.prank(alice);
        vm.expectRevert(DeedNFT.NotVenue.selector);
        deed.lock(id);
    }

    function test_lock_revertsForMissingToken() public {
        vm.prank(venue);
        vm.expectRevert();
        deed.lock(999);
    }

    function test_lock_blocksEveryTransferPath() public {
        vm.prank(alice);
        deed.approve(bob, id);
        vm.prank(venue);
        deed.lock(id);

        vm.prank(alice);
        vm.expectRevert(DeedNFT.Locked.selector);
        deed.transferFrom(alice, bob, id);

        vm.prank(alice);
        vm.expectRevert(DeedNFT.Locked.selector);
        deed.safeTransferFrom(alice, bob, id);

        vm.prank(bob);
        vm.expectRevert(DeedNFT.Locked.selector);
        deed.transferFrom(alice, bob, id);

        assertEq(deed.ownerOf(id), alice);
    }

    function test_lock_cannotBeStackedByOtherVenue() public {
        vm.prank(venue);
        deed.lock(id);
        vm.prank(otherVenue);
        vm.expectRevert(DeedNFT.AlreadyLocked.selector);
        deed.lock(id);
        vm.prank(venue);
        vm.expectRevert(DeedNFT.AlreadyLocked.selector);
        deed.lock(id);
    }

    function test_onlyLockerCanUnlockOrSettle() public {
        vm.prank(venue);
        deed.lock(id);

        vm.startPrank(otherVenue);
        vm.expectRevert(DeedNFT.NotLocker.selector);
        deed.unlock(id);
        vm.expectRevert(DeedNFT.NotLocker.selector);
        deed.settle(id, otherVenue);
        vm.stopPrank();

        vm.startPrank(alice);
        vm.expectRevert(DeedNFT.NotLocker.selector);
        deed.unlock(id);
        vm.expectRevert(DeedNFT.NotLocker.selector);
        deed.settle(id, alice);
        vm.stopPrank();
    }

    function test_settle_movesDeedAndReleasesLock() public {
        vm.prank(alice);
        deed.approve(mallory, id);
        vm.prank(venue);
        deed.lock(id);
        vm.prank(venue);
        deed.settle(id, bob);

        assertEq(deed.ownerOf(id), bob);
        assertEq(deed.lockedBy(id), address(0));
        assertEq(deed.getApproved(id), address(0));

        // the old approval does not survive the sale
        vm.prank(mallory);
        vm.expectRevert();
        deed.transferFrom(bob, mallory, id);
    }

    function test_settle_noReceiverCallback() public {
        // a contract that rejects ERC721 receipts must still be able to buy
        NoReceiver r = new NoReceiver();
        vm.prank(venue);
        deed.lock(id);
        vm.prank(venue);
        deed.settle(id, address(r));
        assertEq(deed.ownerOf(id), address(r));
    }

    function test_unlock_returnsControlToOwner() public {
        vm.prank(venue);
        deed.lock(id);
        vm.prank(venue);
        deed.unlock(id);
        vm.prank(alice);
        deed.transferFrom(alice, bob, id);
        assertEq(deed.ownerOf(id), bob);
    }

    function test_lockDoesNotAffectOtherTokens() public {
        (uint256 id2,) = _open(bob, COLL, DEBT);
        vm.prank(venue);
        deed.lock(id);
        vm.prank(bob);
        deed.transferFrom(bob, alice, id2);
        assertEq(deed.ownerOf(id2), alice);
    }
}

contract NoReceiver {}
