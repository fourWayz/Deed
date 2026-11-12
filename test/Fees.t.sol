// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V3Base} from "./V3Base.t.sol";
import {DeedMarket} from "../src/DeedMarket.sol";
import {RescueAuction} from "../src/RescueAuction.sol";
import {PositionVault} from "../src/PositionVault.sol";
import {IPriceSource} from "../src/interfaces/IPriceSource.sol";
import {ITroveManager, IPriceFeed, IMUSD} from "../src/interfaces/IMezo.sol";

contract FeeTest is V3Base {
    // --- market ---

    function test_marketSale_splitsPriceBetweenSellerAndTreasury() public {
        bytes32 snap = _list();
        vm.prank(bob);
        market.buy(id, snap, PRICE);

        uint256 fee = PRICE * MARKET_FEE / 10_000;
        assertEq(fee, 50e18);
        assertEq(market.claimable(alice), PRICE - fee);
        assertEq(market.claimable(treasury), fee);
        assertEq(market.claimable(alice) + market.claimable(treasury), PRICE);
        assertEq(musd.balanceOf(address(market)), PRICE);
    }

    function test_marketSale_emitsTheFee() public {
        bytes32 snap = _list();
        vm.expectEmit(true, true, true, true, address(market));
        emit DeedMarket.Sold(id, alice, bob, PRICE, 50e18);
        vm.prank(bob);
        market.buy(id, snap, PRICE);
    }

    function test_marketSale_bothSidesPullAndNothingIsLeft() public {
        bytes32 snap = _list();
        vm.prank(bob);
        market.buy(id, snap, PRICE);

        uint256 aliceBefore = musd.balanceOf(alice);
        vm.prank(alice);
        market.claim();
        vm.prank(treasury);
        market.claim();
        assertEq(musd.balanceOf(alice), aliceBefore + 4_950e18);
        assertEq(musd.balanceOf(treasury), 50e18);
        assertEq(musd.balanceOf(address(market)), 0, "nothing stuck");
        assertEq(market.claimable(alice), 0);
        assertEq(market.claimable(treasury), 0);
    }

    function test_marketSale_feeRoundsDownSoTinyPricesPayNoFee() public {
        vm.prank(alice);
        market.list(id, 99, uint64(block.timestamp + 1 days), MIN_ICR);
        bytes32 snap = market.snapshot(vault, MIN_ICR);
        vm.prank(bob);
        market.buy(id, snap, 99);
        assertEq(market.claimable(alice), 99);
        assertEq(market.claimable(treasury), 0);
    }

    function test_marketSale_sellerThatIsTheTreasuryGetsTheWholePrice() public {
        vm.prank(alice);
        deed.transferFrom(alice, treasury, id);
        vm.prank(treasury);
        market.list(id, PRICE, uint64(block.timestamp + 1 days), MIN_ICR);
        bytes32 snap = market.snapshot(vault, MIN_ICR);
        vm.prank(bob);
        market.buy(id, snap, PRICE);
        assertEq(market.claimable(treasury), PRICE);
    }

    function testFuzz_marketFeePlusProceedsEqualsPrice(uint96 price) public {
        price = uint96(bound(price, 1, 40_000e18));
        vm.prank(alice);
        market.list(id, price, uint64(block.timestamp + 1 days), MIN_ICR);
        bytes32 snap = market.snapshot(vault, MIN_ICR);
        vm.prank(bob);
        market.buy(id, snap, price);

        uint256 fee = market.feeFor(price);
        assertLe(fee, uint256(price) / 100, "never above 1%");
        assertEq(market.claimable(alice), price - fee);
        assertEq(market.claimable(alice) + market.claimable(treasury), price);
        assertEq(musd.balanceOf(address(market)), price);
    }

    function test_marketFee_cannotBeDodgedByBuyingYourOwnListing() public {
        vm.prank(address(mezo));
        musd.mint(alice, PRICE);
        _approveMUSD(alice, address(market));
        bytes32 snap = _list();
        vm.prank(alice);
        market.buy(id, snap, PRICE);
        // alice paid the full price and gets back price minus the fee
        assertEq(market.claimable(treasury), 50e18);
        assertEq(market.claimable(alice), PRICE - 50e18);
    }

    function test_marketFee_constructorEnforcesCapAndTreasury() public {
        ITroveManager tm = ITroveManager(address(mezo));
        IPriceFeed pf = IPriceFeed(address(mezo));
        new DeedMarket(deed, factory, tm, pf, IMUSD(address(musd)), treasury, 100);
        new DeedMarket(deed, factory, tm, pf, IMUSD(address(musd)), treasury, 0);
        vm.expectRevert(DeedMarket.BadParams.selector);
        new DeedMarket(deed, factory, tm, pf, IMUSD(address(musd)), treasury, 101);
        vm.expectRevert(DeedMarket.BadParams.selector);
        new DeedMarket(deed, factory, tm, pf, IMUSD(address(musd)), address(0), 50);
    }

    function test_marketFee_immutableValuesAreWhatWasDeployed() public view {
        assertEq(market.treasury(), treasury);
        assertEq(market.feeBps(), MARKET_FEE);
        assertEq(market.MAX_FEE_BPS(), 100);
    }

    // --- auction ---

    function _startAndWin() internal returns (uint256 price) {
        _setPrice(25_000e18);
        auction.startRescue(id);
        price = auction.currentPrice(id);
        uint256 need = auction.requiredTopUp(id);
        vm.prank(bob);
        auction.bid{value: need}(id, price, address(0), address(0));
    }

    function test_auction_splitsProceedsBetweenSellerAndTreasury() public {
        uint256 price = _startAndWin();
        uint256 fee = price * AUCTION_FEE / 10_000;
        assertGt(fee, 0);
        assertEq(auction.claimable(alice), price - fee);
        assertEq(auction.claimable(treasury), fee);
        assertEq(auction.claimable(alice) + auction.claimable(treasury), price);
        assertEq(musd.balanceOf(address(auction)), price);
    }

    function test_auction_bothSidesPullAndNothingIsLeft() public {
        uint256 price = _startAndWin();
        uint256 fee = auction.feeFor(price);
        uint256 aliceBefore = musd.balanceOf(alice);
        vm.prank(alice);
        auction.claim();
        vm.prank(treasury);
        auction.claim();
        assertEq(musd.balanceOf(alice), aliceBefore + price - fee);
        assertEq(musd.balanceOf(treasury), fee);
        assertEq(musd.balanceOf(address(auction)), 0, "nothing stuck");
    }

    function test_auction_noFeeWhenNobodyWins() public {
        _setPrice(25_000e18);
        auction.startRescue(id);
        skip(7 hours);
        auction.end(id);
        assertEq(auction.claimable(treasury), 0);
        assertEq(musd.balanceOf(address(auction)), 0);
    }

    function testFuzz_auctionFeePlusProceedsEqualsPrice(uint32 elapsed) public {
        _setPrice(25_000e18);
        auction.startRescue(id);
        skip(bound(elapsed, 0, 6 hours - 1));
        uint256 price = auction.currentPrice(id);
        uint256 need = auction.requiredTopUp(id);
        vm.prank(bob);
        auction.bid{value: need}(id, price, address(0), address(0));
        assertEq(auction.claimable(alice) + auction.claimable(treasury), price);
        assertEq(auction.claimable(treasury), auction.feeFor(price));
        assertEq(musd.balanceOf(address(auction)), price);
    }

    function test_auctionFee_constructorEnforcesCapAndTreasury() public {
        ITroveManager tm = ITroveManager(address(mezo));
        IPriceFeed pf = IPriceFeed(address(mezo));
        IMUSD m = IMUSD(address(musd));
        new RescueAuction(deed, factory, tm, pf, spot, m, 1.2e18, 1.8e18, 500, treasury, 100);
        vm.expectRevert(RescueAuction.BadParams.selector);
        new RescueAuction(deed, factory, tm, pf, spot, m, 1.2e18, 1.8e18, 500, treasury, 101);
        vm.expectRevert(RescueAuction.BadParams.selector);
        new RescueAuction(deed, factory, tm, pf, spot, m, 1.2e18, 1.8e18, 500, address(0), 50);
    }

    function test_auctionFee_floorStillBindsAfterTheFee() public {
        // the winner never pays under the floor and the seller never receives under floor minus the fee
        _setPrice(25_000e18);
        auction.startRescue(id);
        (,,,, uint256 startPrice, uint256 floorPrice) = auction.auctions(id);
        assertEq(floorPrice, startPrice * 8_000 / 10_000);
        skip(6 hours - 1);
        uint256 price = auction.currentPrice(id);
        assertGe(price, floorPrice);
        assertLe(auction.feeFor(price), price / 100);
    }
}
