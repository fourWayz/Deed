// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {DeedMarket} from "../src/DeedMarket.sol";
import {DeedNFT} from "../src/DeedNFT.sol";
import {PositionVault} from "../src/PositionVault.sol";
import {ITroveManager, IPriceFeed, IMUSD} from "../src/interfaces/IMezo.sol";

contract MarketBase is Base {
    DeedMarket public market;
    uint256 id;
    PositionVault vault;

    uint256 constant PRICE = 5_000e18;
    uint256 constant MIN_ICR = 2e18;
    // snapshot taken at listing, kept in storage so it can be used right after a prank
    bytes32 snap0;

    function _init() internal virtual override {
        market = new DeedMarket(
            deed, factory, ITroveManager(address(mezo)), IPriceFeed(address(mezo)), IMUSD(address(musd))
        );
        deed.init(address(factory), address(market), address(0xA11C));
    }

    function setUp() public virtual override {
        super.setUp();
        (id, vault) = _open(alice, COLL, DEBT);
        // buyers hold some MUSD
        vm.prank(address(mezo));
        musd.mint(bob, 20_000e18);
        vm.prank(address(mezo));
        musd.mint(mallory, 20_000e18);
        _approveMUSD(bob, address(market));
        _approveMUSD(mallory, address(market));
    }

    function _list() internal {
        vm.prank(alice);
        market.list(id, PRICE, uint64(block.timestamp + 1 days), MIN_ICR);
        snap0 = _snap();
    }

    function _snap() internal view returns (bytes32) {
        return market.snapshot(vault, MIN_ICR);
    }
}

contract DeedMarketTest is MarketBase {
    // --- list ---

    function test_list_locksDeedAndFreezesVault() public {
        _list();
        (address seller, uint64 expiry, uint256 price, uint256 minICR, bytes32 snap) = market.listings(id);
        assertEq(seller, alice);
        assertEq(expiry, block.timestamp + 1 days);
        assertEq(price, PRICE);
        assertEq(minICR, MIN_ICR);
        assertEq(snap, _snap());
        assertEq(deed.lockedBy(id), address(market));
        assertEq(deed.ownerOf(id), alice);

        vm.startPrank(alice);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.withdraw(0.01 ether, address(0), address(0));
        vm.expectRevert(PositionVault.NotController.selector);
        vault.addCollateral{value: 1}(address(0), address(0));
        vm.expectRevert(PositionVault.NotController.selector);
        vault.repay(1, address(0), address(0));
        vm.expectRevert(PositionVault.NotController.selector);
        vault.close();
        vm.expectRevert(DeedNFT.Locked.selector);
        deed.transferFrom(alice, bob, id);
        vm.stopPrank();
    }

    function test_list_onlyOwner() public {
        vm.prank(bob);
        vm.expectRevert(DeedMarket.NotOwner.selector);
        market.list(id, PRICE, uint64(block.timestamp + 1 days), MIN_ICR);

        // an approved operator is not the owner either
        vm.prank(alice);
        deed.approve(bob, id);
        vm.prank(bob);
        vm.expectRevert(DeedMarket.NotOwner.selector);
        market.list(id, PRICE, uint64(block.timestamp + 1 days), MIN_ICR);
    }

    function test_list_validatesInputs() public {
        uint64 ok = uint64(block.timestamp + 1 days);
        vm.startPrank(alice);
        vm.expectRevert(DeedMarket.BadPrice.selector);
        market.list(id, 0, ok, MIN_ICR);
        vm.expectRevert(DeedMarket.BadExpiry.selector);
        market.list(id, PRICE, uint64(block.timestamp), MIN_ICR);
        vm.expectRevert(DeedMarket.BadMinICR.selector);
        market.list(id, PRICE, ok, 1.09e18);
        // above what the position has right now
        vm.expectRevert(DeedMarket.BadMinICR.selector);
        market.list(id, PRICE, ok, 50e18);
        vm.stopPrank();
    }

    function test_list_twiceReverts() public {
        _list();
        vm.prank(alice);
        vm.expectRevert(DeedMarket.AlreadyListed.selector);
        market.list(id, PRICE, uint64(block.timestamp + 1 days), MIN_ICR);
    }

    function test_list_closedTroveReverts() public {
        vm.prank(address(mezo));
        musd.mint(alice, 100e18);
        _approveMUSD(alice, address(vault));
        vm.prank(alice);
        vault.close();
        vm.prank(alice);
        vm.expectRevert(DeedMarket.NotActive.selector);
        market.list(id, PRICE, uint64(block.timestamp + 1 days), MIN_ICR);
    }

    // --- buy ---

    function test_buy_movesPositionAndCreditsSeller() public {
        _list();
        vm.prank(bob);
        market.buy(id, snap0, PRICE);

        assertEq(deed.ownerOf(id), bob);
        assertEq(deed.lockedBy(id), address(0));
        assertEq(musd.balanceOf(bob), 15_000e18);
        assertEq(musd.balanceOf(address(market)), PRICE);
        assertEq(market.claimable(alice), PRICE);

        // new owner controls the vault, old one does not
        vm.prank(alice);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.withdraw(0.01 ether, address(0), address(0));
        uint256 before = bob.balance;
        vm.prank(bob);
        vault.withdraw(0.01 ether, address(0), address(0));
        assertEq(bob.balance, before + 0.01 ether);

        // listing is gone
        (address seller,,,,) = market.listings(id);
        assertEq(seller, address(0));
    }

    function test_claim_paysSellerOnce() public {
        _list();
        vm.prank(bob);
        market.buy(id, snap0, PRICE);

        uint256 before = musd.balanceOf(alice);
        vm.prank(alice);
        market.claim();
        assertEq(musd.balanceOf(alice), before + PRICE);
        assertEq(musd.balanceOf(address(market)), 0);
        assertEq(market.claimable(alice), 0);

        vm.prank(alice);
        vm.expectRevert(DeedMarket.NothingToClaim.selector);
        market.claim();
        vm.prank(bob);
        vm.expectRevert(DeedMarket.NothingToClaim.selector);
        market.claim();
    }

    function test_buy_survivesInterestAccrual() public {
        _list();
        skip(0.9 days);
        vm.prank(bob);
        market.buy(id, snap0, PRICE);
        assertEq(deed.ownerOf(id), bob);
    }

    function test_buy_rejectsWrongSnapshot() public {
        _list();
        vm.prank(bob);
        vm.expectRevert(DeedMarket.SnapshotMismatch.selector);
        market.buy(id, keccak256("wrong"), PRICE);
        assertEq(deed.ownerOf(id), alice);
    }

    function test_buy_rejectsPriceAboveMax() public {
        _list();
        vm.prank(bob);
        vm.expectRevert(DeedMarket.PriceTooHigh.selector);
        market.buy(id, snap0, PRICE - 1);
    }

    function test_buy_needsFundsAndAllowance_stateKept() public {
        _list();
        address broke = makeAddr("broke");
        vm.prank(broke);
        vm.expectRevert();
        market.buy(id, snap0, PRICE);
        assertEq(deed.lockedBy(id), address(market));
        (address seller,,,,) = market.listings(id);
        assertEq(seller, alice);
        assertEq(market.claimable(alice), 0);
    }

    function test_buy_unlistedReverts() public {
        vm.prank(bob);
        vm.expectRevert(DeedMarket.NotListed.selector);
        market.buy(id, bytes32(0), PRICE);
    }

    // --- front-running ---

    function test_frontRun_sellerCannotDrainWhileListed() public {
        _list();
        vm.prank(alice);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.withdraw(0.05 ether, address(0), address(0));
    }

    function test_frontRun_cancelDrainRelistSameTx_buyerReverts() public {
        _list();
        bytes32 seen = _snap();
        // seller pulls the listing, drains collateral, relists with the same price
        vm.startPrank(alice);
        market.cancel(id);
        vault.withdraw(0.04 ether, address(0), address(0));
        market.list(id, PRICE, uint64(block.timestamp + 1 days), MIN_ICR);
        vm.stopPrank();

        vm.prank(bob);
        vm.expectRevert(DeedMarket.SnapshotMismatch.selector);
        market.buy(id, seen, PRICE);
        assertEq(deed.ownerOf(id), alice);
    }

    function test_frontRun_cancelAddOneWeiRelist_buyerReverts() public {
        _list();
        bytes32 seen = _snap();
        vm.startPrank(alice);
        market.cancel(id);
        vault.addCollateral{value: 1}(address(0), address(0));
        market.list(id, PRICE, uint64(block.timestamp + 1 days), MIN_ICR);
        vm.stopPrank();

        vm.prank(bob);
        vm.expectRevert(DeedMarket.SnapshotMismatch.selector);
        market.buy(id, seen, PRICE);
    }

    function test_frontRun_relistChangedMinICR_buyerReverts() public {
        _list();
        bytes32 seen = _snap();
        vm.startPrank(alice);
        market.cancel(id);
        market.list(id, PRICE, uint64(block.timestamp + 1 days), 1.2e18);
        vm.stopPrank();

        vm.prank(bob);
        vm.expectRevert(DeedMarket.SnapshotMismatch.selector);
        market.buy(id, seen, PRICE);
    }

    function test_frontRun_relistHigherPrice_buyerReverts() public {
        _list();
        bytes32 seen = _snap();
        vm.startPrank(alice);
        market.cancel(id);
        market.list(id, PRICE * 2, uint64(block.timestamp + 1 days), MIN_ICR);
        vm.stopPrank();

        vm.prank(bob);
        vm.expectRevert(DeedMarket.PriceTooHigh.selector);
        market.buy(id, seen, PRICE);
    }

    function test_frontRun_relistSameTermsStillSells() public {
        _list();
        bytes32 seen = _snap();
        vm.startPrank(alice);
        market.cancel(id);
        market.list(id, PRICE, uint64(block.timestamp + 1 days), MIN_ICR);
        vm.stopPrank();

        vm.prank(bob);
        market.buy(id, seen, PRICE);
        assertEq(deed.ownerOf(id), bob);
    }

    function test_frontRun_redemptionBetweenListAndBuy_reverts() public {
        _list();
        bytes32 seen = _snap();
        // someone redeems against the trove, outside the seller's control
        mezo.redeem(address(vault), 0.01 ether, 500e18);
        vm.prank(bob);
        vm.expectRevert(DeedMarket.SnapshotMismatch.selector);
        market.buy(id, seen, PRICE);
    }

    // --- settlement checks ---

    function test_buy_revertsWhenICRFellBelowPromise() public {
        _list();
        // ICR 363% at 80k, crash far enough to land under the 200% promise
        mezo.setPrice(40_000e18);
        vm.prank(bob);
        vm.expectRevert();
        market.buy(id, snap0, PRICE);
        assertEq(deed.ownerOf(id), alice);
    }

    function test_buy_revertsOnStaleOracle() public {
        _list();
        mezo.setStale(true);
        vm.prank(bob);
        vm.expectRevert("PriceFeed: Oracle is stale.");
        market.buy(id, snap0, PRICE);
    }

    // --- expiry and cancel ---

    function test_buy_expiredReverts() public {
        _list();
        skip(1 days + 1);
        vm.prank(bob);
        vm.expectRevert(DeedMarket.Expired.selector);
        market.buy(id, snap0, PRICE);
    }

    function test_buy_atExpirySecondStillWorks() public {
        _list();
        skip(1 days);
        vm.prank(bob);
        market.buy(id, snap0, PRICE);
        assertEq(deed.ownerOf(id), bob);
    }

    function test_cancel_sellerAnytime() public {
        _list();
        vm.prank(alice);
        market.cancel(id);
        assertEq(deed.lockedBy(id), address(0));
        vm.prank(alice);
        vault.withdraw(0.01 ether, address(0), address(0));
    }

    function test_cancel_strangerOnlyAfterExpiry() public {
        _list();
        vm.prank(mallory);
        vm.expectRevert(DeedMarket.NotSeller.selector);
        market.cancel(id);

        skip(1 days + 1);
        vm.prank(mallory);
        market.cancel(id);
        assertEq(deed.lockedBy(id), address(0));
        assertEq(deed.ownerOf(id), alice);
    }

    function test_cancelThenBuy_reverts() public {
        _list();
        vm.prank(alice);
        market.cancel(id);
        vm.prank(bob);
        vm.expectRevert(DeedMarket.NotListed.selector);
        market.buy(id, snap0, PRICE);
    }

    function test_buyThenCancel_reverts() public {
        _list();
        vm.prank(bob);
        market.buy(id, snap0, PRICE);
        vm.prank(alice);
        vm.expectRevert(DeedMarket.NotListed.selector);
        market.cancel(id);
        assertEq(deed.ownerOf(id), bob);
    }

    function test_secondBuyerLoses() public {
        _list();
        vm.prank(bob);
        market.buy(id, snap0, PRICE);
        vm.prank(mallory);
        vm.expectRevert(DeedMarket.NotListed.selector);
        market.buy(id, snap0, PRICE);
    }

    function test_cancelTwiceReverts() public {
        _list();
        vm.startPrank(alice);
        market.cancel(id);
        vm.expectRevert(DeedMarket.NotListed.selector);
        market.cancel(id);
        vm.stopPrank();
    }

    function test_newOwnerCanRelist() public {
        _list();
        vm.prank(bob);
        market.buy(id, snap0, PRICE);
        vm.prank(bob);
        market.list(id, PRICE * 2, uint64(block.timestamp + 1 days), MIN_ICR);
        assertEq(deed.lockedBy(id), address(market));
    }

    // --- fuzz ---

    function testFuzz_saleConservesMUSD(uint256 price, uint64 ttl, uint256 minICR) public {
        price = bound(price, 1, 15_000e18);
        ttl = uint64(bound(ttl, 1, 365 days));
        minICR = bound(minICR, 1.1e18, 3.6e18);
        vm.prank(alice);
        market.list(id, price, uint64(block.timestamp) + ttl, minICR);
        bytes32 snap = market.snapshot(vault, minICR);

        uint256 buyerBefore = musd.balanceOf(bob);
        vm.prank(bob);
        market.buy(id, snap, price);
        assertEq(buyerBefore - musd.balanceOf(bob), price);
        assertEq(musd.balanceOf(address(market)), price);

        uint256 sellerBefore = musd.balanceOf(alice);
        vm.prank(alice);
        market.claim();
        assertEq(musd.balanceOf(alice) - sellerBefore, price);
        assertEq(musd.balanceOf(address(market)), 0);
    }

    function testFuzz_anySnapshotButTheRightOneFails(bytes32 wrong) public {
        _list();
        vm.assume(wrong != _snap());
        vm.prank(bob);
        vm.expectRevert(DeedMarket.SnapshotMismatch.selector);
        market.buy(id, wrong, PRICE);
    }
}
