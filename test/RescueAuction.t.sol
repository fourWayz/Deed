// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {DeedMarket} from "../src/DeedMarket.sol";
import {RescueAuction} from "../src/RescueAuction.sol";
import {PairSpotPrice, IPair} from "../src/PairSpotPrice.sol";
import {DeedNFT} from "../src/DeedNFT.sol";
import {PositionVault} from "../src/PositionVault.sol";
import {IPriceSource} from "../src/interfaces/IPriceSource.sol";
import {ITroveManager, IPriceFeed, IMUSD} from "../src/interfaces/IMezo.sol";

contract MockSpot is IPriceSource {
    uint256 public spotPrice;

    function set(uint256 p) external {
        spotPrice = p;
    }
}

contract MockPair {
    address public token0;
    uint112 r0;
    uint112 r1;

    constructor(address t0, uint112 a, uint112 b) {
        token0 = t0;
        r0 = a;
        r1 = b;
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (r0, r1, 0);
    }
}

contract AuctionBase is Base {
    DeedMarket public market;
    RescueAuction public auction;
    MockSpot public spot;
    uint256 id;
    PositionVault vault;

    uint256 constant RESCUE_ICR = 1.5e18;
    uint256 constant SAFE_ICR = 1.8e18;
    uint256 constant CRASH = 30_000e18;

    function _init() internal virtual override {
        spot = new MockSpot();
        spot.set(80_000e18);
        market = new DeedMarket(
            deed, factory, ITroveManager(address(mezo)), IPriceFeed(address(mezo)), IMUSD(address(musd))
        );
        auction = new RescueAuction(
            deed,
            factory,
            ITroveManager(address(mezo)),
            IPriceFeed(address(mezo)),
            spot,
            IMUSD(address(musd)),
            RESCUE_ICR,
            SAFE_ICR,
            500
        );
        deed.init(address(factory), address(market), address(auction));
    }

    function setUp() public virtual override {
        super.setUp();
        (id, vault) = _open(alice, COLL, DEBT);
        vm.prank(address(mezo));
        musd.mint(bob, 20_000e18);
        _approveMUSD(bob, address(auction));
        vm.prank(address(mezo));
        musd.mint(mallory, 20_000e18);
        _approveMUSD(mallory, address(auction));
    }

    function _setPrice(uint256 p) internal {
        mezo.setPrice(p);
        spot.set(p);
    }

    function _crashAndStart() internal {
        _setPrice(CRASH);
        auction.startRescue(id);
    }
}

contract RescueAuctionTest is AuctionBase {
    // --- starting ---

    function test_startRescue_revertsWhenHealthy() public {
        vm.expectRevert();
        auction.startRescue(id);
    }

    function test_startRescue_anyoneWhenUnderThreshold() public {
        _setPrice(CRASH);
        vm.prank(mallory);
        auction.startRescue(id);

        (address seller, bool byOwner, uint64 startTs, uint64 duration, uint256 startPrice, uint256 floorPrice) =
            auction.auctions(id);
        assertEq(seller, alice);
        assertFalse(byOwner);
        assertEq(startTs, block.timestamp);
        assertEq(duration, 6 hours);
        // 0.1 BTC at 30k = 3000, owed is debt minus gas compensation
        (, uint256 debt) = vault.liveState();
        assertEq(startPrice, 3_000e18 - (debt - 200e18));
        assertEq(floorPrice, startPrice / 2);
        assertEq(deed.lockedBy(id), address(auction));
    }

    function test_start_ownerAnytimeWithOwnTerms() public {
        vm.prank(alice);
        auction.start(id, 2_000, 1 days);
        (, bool byOwner,, uint64 duration, uint256 startPrice, uint256 floorPrice) = auction.auctions(id);
        assertTrue(byOwner);
        assertEq(duration, 1 days);
        assertEq(floorPrice, startPrice * 2_000 / 10_000);
    }

    function test_start_onlyOwnerAndValidParams() public {
        vm.prank(bob);
        vm.expectRevert(RescueAuction.NotOwner.selector);
        auction.start(id, 5_000, 1 days);

        vm.startPrank(alice);
        vm.expectRevert(RescueAuction.BadParams.selector);
        auction.start(id, 10_001, 1 days);
        vm.expectRevert(RescueAuction.BadParams.selector);
        auction.start(id, 5_000, 59 minutes);
        vm.expectRevert(RescueAuction.BadParams.selector);
        auction.start(id, 5_000, 8 days);
        vm.stopPrank();
    }

    function test_start_twiceReverts() public {
        vm.startPrank(alice);
        auction.start(id, 5_000, 1 days);
        vm.expectRevert(RescueAuction.AlreadyRunning.selector);
        auction.start(id, 5_000, 1 days);
        vm.stopPrank();
    }

    function test_start_noEquityReverts() public {
        // 0.1 BTC at 20k is 2000, less than the 2002 owed
        _setPrice(20_000e18);
        vm.expectRevert(RescueAuction.NoEquity.selector);
        auction.startRescue(id);
    }

    function test_start_cannotStackOnListing() public {
        vm.prank(alice);
        market.list(id, 5_000e18, uint64(block.timestamp + 1 days), 2e18);
        vm.prank(alice);
        vm.expectRevert(DeedNFT.AlreadyLocked.selector);
        auction.start(id, 5_000, 1 days);
    }

    function test_list_cannotStackOnAuction() public {
        vm.prank(alice);
        auction.start(id, 5_000, 1 days);
        vm.prank(alice);
        vm.expectRevert(DeedNFT.AlreadyLocked.selector);
        market.list(id, 5_000e18, uint64(block.timestamp + 1 days), 2e18);
    }

    function test_runningAuction_freezesOwner() public {
        _crashAndStart();
        vm.startPrank(alice);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.withdraw(1, address(0), address(0));
        vm.expectRevert(DeedNFT.Locked.selector);
        deed.transferFrom(alice, bob, id);
        vm.stopPrank();
    }

    // --- price curve ---

    function test_price_fallsLinearlyToFloor() public {
        _crashAndStart();
        (,,, uint64 duration, uint256 startPrice, uint256 floorPrice) = auction.auctions(id);
        assertEq(auction.currentPrice(id), startPrice);
        skip(duration / 2);
        assertEq(auction.currentPrice(id), (startPrice + floorPrice) / 2);
        skip(duration / 2);
        assertEq(auction.currentPrice(id), floorPrice);
        skip(1 days);
        assertEq(auction.currentPrice(id), floorPrice);
    }

    function testFuzz_price_neverRisesAndStaysInRange(uint256 t1, uint256 t2) public {
        _crashAndStart();
        (,,,, uint256 startPrice, uint256 floorPrice) = auction.auctions(id);
        t1 = bound(t1, 0, 3 days);
        t2 = bound(t2, t1, 3 days);
        uint256 t0 = block.timestamp;
        vm.warp(t0 + t1);
        uint256 p1 = auction.currentPrice(id);
        vm.warp(t0 + t2);
        uint256 p2 = auction.currentPrice(id);
        assertLe(p2, p1);
        assertLe(p1, startPrice);
        assertGe(p2, floorPrice);
    }

    // --- bidding ---

    function test_bid_winnerTopsUpAndSellerGetsPaid() public {
        _crashAndStart();
        skip(3 hours);
        uint256 price = auction.currentPrice(id);
        uint256 topUp = auction.requiredTopUp(id);
        assertGt(topUp, 0);

        vm.prank(bob);
        auction.bid{value: topUp}(id, price, address(0), address(0));

        assertEq(deed.ownerOf(id), bob);
        assertEq(deed.lockedBy(id), address(0));
        assertEq(vault.currentICR() >= SAFE_ICR, true);
        assertEq(auction.claimable(alice), price);
        assertEq(musd.balanceOf(address(auction)), price);
        assertEq(musd.balanceOf(bob), 20_000e18 - price);
        assertEq(address(vault).balance, 0);

        vm.prank(alice);
        auction.claim();
        assertEq(musd.balanceOf(alice), DEBT + price);
        assertEq(musd.balanceOf(address(auction)), 0);

        // winner controls it now
        vm.prank(alice);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.withdraw(1, address(0), address(0));
    }

    function test_bid_revertsIfTopUpTooSmall() public {
        _crashAndStart();
        uint256 topUp = auction.requiredTopUp(id);
        vm.prank(bob);
        vm.expectRevert();
        auction.bid{value: topUp / 2}(id, type(uint256).max, address(0), address(0));
        assertEq(deed.ownerOf(id), alice);
        assertEq(deed.lockedBy(id), address(auction));
    }

    function test_bid_revertsIfPriceAboveMax() public {
        _crashAndStart();
        uint256 topUp = auction.requiredTopUp(id);
        uint256 price = auction.currentPrice(id);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(RescueAuction.PriceTooHigh.selector, price));
        auction.bid{value: topUp}(id, price - 1, address(0), address(0));
    }

    function test_bid_laterIsCheaper() public {
        _crashAndStart();
        uint256 early = auction.currentPrice(id);
        skip(5 hours);
        assertLt(auction.currentPrice(id), early);
    }

    function test_bid_notRunningReverts() public {
        vm.prank(bob);
        vm.expectRevert(RescueAuction.NotRunning.selector);
        auction.bid(id, type(uint256).max, address(0), address(0));
    }

    function test_bid_onlyOnce() public {
        _crashAndStart();
        uint256 topUp = auction.requiredTopUp(id);
        vm.prank(bob);
        auction.bid{value: topUp}(id, type(uint256).max, address(0), address(0));
        vm.prank(mallory);
        vm.expectRevert(RescueAuction.NotRunning.selector);
        auction.bid{value: topUp}(id, type(uint256).max, address(0), address(0));
    }

    function test_bid_needsMUSD() public {
        _crashAndStart();
        uint256 topUp = auction.requiredTopUp(id);
        address broke = makeAddr("broke");
        vm.deal(broke, 10 ether);
        vm.prank(broke);
        vm.expectRevert();
        auction.bid{value: topUp}(id, type(uint256).max, address(0), address(0));
    }

    // --- expiry ---

    function test_expired_bidReverts_endReturnsDeed() public {
        _crashAndStart();
        skip(6 hours);
        uint256 topUp = auction.requiredTopUp(id);
        vm.prank(bob);
        vm.expectRevert(RescueAuction.Expired.selector);
        auction.bid{value: topUp}(id, type(uint256).max, address(0), address(0));

        vm.prank(mallory);
        auction.end(id);
        assertEq(deed.lockedBy(id), address(0));
        assertEq(deed.ownerOf(id), alice);

        // owner is free again
        vm.prank(alice);
        vault.addCollateral{value: 0.1 ether}(address(0), address(0));
    }

    function test_end_beforeExpiryReverts() public {
        _crashAndStart();
        skip(6 hours - 1);
        vm.expectRevert(RescueAuction.NotExpired.selector);
        auction.end(id);
    }

    // --- seller side ---

    function test_ownerStartedAuction_ownerCancelsAnytime() public {
        vm.startPrank(alice);
        auction.start(id, 5_000, 1 days);
        auction.cancel(id);
        vm.stopPrank();
        assertEq(deed.lockedBy(id), address(0));
    }

    function test_cancel_onlySeller() public {
        vm.prank(alice);
        auction.start(id, 5_000, 1 days);
        vm.prank(bob);
        vm.expectRevert(RescueAuction.NotSeller.selector);
        auction.cancel(id);
    }

    function test_thirdPartyAuction_ownerCannotCancelWhileRisky() public {
        _crashAndStart();
        vm.prank(alice);
        vm.expectRevert(RescueAuction.NotAllowed.selector);
        auction.cancel(id);
    }

    function test_thirdPartyAuction_ownerTopsUpThenCancels() public {
        _crashAndStart();
        uint256 topUp = auction.requiredTopUp(id);
        vm.prank(alice);
        auction.topUp{value: topUp}(id, address(0), address(0));
        vm.prank(alice);
        auction.cancel(id);
        assertEq(deed.lockedBy(id), address(0));
        assertEq(deed.ownerOf(id), alice);
    }

    function test_topUp_onlySeller() public {
        _crashAndStart();
        vm.prank(bob);
        vm.expectRevert(RescueAuction.NotSeller.selector);
        auction.topUp{value: 1 ether}(id, address(0), address(0));
    }

    function test_topUpFromVenue_onlyLocker() public {
        vm.prank(alice);
        vm.expectRevert(PositionVault.NotController.selector);
        vault.topUpFromVenue{value: 1}(address(0), address(0));
        vm.deal(address(market), 1 ether);
        vm.prank(address(market));
        vm.expectRevert(PositionVault.NotController.selector);
        vault.topUpFromVenue{value: 1}(address(0), address(0));
    }

    // --- oracle safety ---

    function test_staleOracle_blocksStartAndBid() public {
        _crashAndStart();
        uint256 topUp = auction.requiredTopUp(id);
        mezo.setStale(true);
        vm.prank(bob);
        vm.expectRevert("PriceFeed: Oracle is stale.");
        auction.bid{value: topUp}(id, type(uint256).max, address(0), address(0));
        vm.expectRevert("PriceFeed: Oracle is stale.");
        auction.requiredTopUp(id);

    }

    function test_manipulatedSpot_blocksStart() public {
        _setPrice(CRASH);
        // somebody pumps the DEX 20% above the oracle
        spot.set(CRASH * 120 / 100);
        vm.expectRevert(abi.encodeWithSelector(RescueAuction.SpotDeviation.selector, CRASH, CRASH * 120 / 100));
        auction.startRescue(id);
    }

    function test_manipulatedSpot_blocksBid() public {
        _crashAndStart();
        uint256 topUp = auction.requiredTopUp(id);
        spot.set(CRASH * 70 / 100);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(RescueAuction.SpotDeviation.selector, CRASH, CRASH * 70 / 100));
        auction.bid{value: topUp}(id, type(uint256).max, address(0), address(0));
        assertEq(deed.ownerOf(id), alice);
    }

    function test_smallSpotGap_isFine() public {
        _crashAndStart();
        spot.set(CRASH * 104 / 100);
        uint256 topUp = auction.requiredTopUp(id);
        vm.prank(bob);
        auction.bid{value: topUp}(id, type(uint256).max, address(0), address(0));
        assertEq(deed.ownerOf(id), bob);
    }

    function testFuzz_deviationBoundary(uint256 gapBps) public {
        gapBps = bound(gapBps, 0, 2_000);
        _setPrice(CRASH);
        spot.set(CRASH * (10_000 + gapBps) / 10_000);
        if (gapBps <= 500) {
            auction.startRescue(id);
            assertEq(deed.lockedBy(id), address(auction));
        } else {
            vm.expectRevert();
            auction.startRescue(id);
        }
    }

    // --- liquidated mid-auction ---

    function test_liquidatedMidAuction_bidRevertsAndSellerRecovers() public {
        _crashAndStart();
        uint256 topUp = auction.requiredTopUp(id);
        vm.deal(address(mezo), 1 ether);
        mezo.liquidate(address(vault), 0.01 ether);

        vm.prank(bob);
        vm.expectRevert(RescueAuction.NotActive.selector);
        auction.bid{value: topUp}(id, type(uint256).max, address(0), address(0));
        assertEq(deed.ownerOf(id), alice);

        skip(6 hours);
        auction.end(id);
        uint256 before = alice.balance;
        vm.prank(alice);
        vault.claimSurplus();
        assertEq(alice.balance, before + 0.01 ether);
    }

    function test_liquidatedPosition_cannotStart() public {
        _setPrice(CRASH);
        vm.deal(address(mezo), 1 ether);
        mezo.liquidate(address(vault), 0);
        // a liquidated trove has no debt, so the public path sees a healthy position
        vm.expectRevert();
        auction.startRescue(id);
        vm.prank(alice);
        vm.expectRevert(RescueAuction.NotActive.selector);
        auction.start(id, 5_000, 1 days);
    }

    // --- claim ---

    function test_claim_nothingReverts() public {
        vm.expectRevert(RescueAuction.NothingToClaim.selector);
        auction.claim();
    }

    // --- constructor ---

    function test_constructor_validatesThresholds() public {
        IPriceFeed pf = IPriceFeed(address(mezo));
        ITroveManager tm = ITroveManager(address(mezo));
        vm.expectRevert(RescueAuction.BadParams.selector);
        new RescueAuction(deed, factory, tm, pf, spot, IMUSD(address(musd)), 1.1e18, 1.8e18, 500);
        vm.expectRevert(RescueAuction.BadParams.selector);
        new RescueAuction(deed, factory, tm, pf, spot, IMUSD(address(musd)), 1.5e18, 1.5e18, 500);
        vm.expectRevert(RescueAuction.BadParams.selector);
        new RescueAuction(deed, factory, tm, pf, spot, IMUSD(address(musd)), 1.5e18, 1.8e18, 0);
    }

    // --- dex adapter ---

    function test_pairSpotPrice_bothOrderings() public {
        MockPair p0 = new MockPair(address(musd), 8_000_000e18, 100e18);
        assertEq(new PairSpotPrice(IPair(address(p0)), address(musd)).spotPrice(), 80_000e18);
        MockPair p1 = new MockPair(address(1), 100e18, 8_000_000e18);
        assertEq(new PairSpotPrice(IPair(address(p1)), address(musd)).spotPrice(), 80_000e18);
    }
}

