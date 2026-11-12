// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {DeedMarket} from "../src/DeedMarket.sol";
import {RescueAuction} from "../src/RescueAuction.sol";
import {DeedLens} from "../src/DeedLens.sol";
import {PositionVault} from "../src/PositionVault.sol";
import {IPriceSource} from "../src/interfaces/IPriceSource.sol";
import {IBorrowerOperations, ITroveManager, IPriceFeed, IMUSD} from "../src/interfaces/IMezo.sol";

contract FixedSpot is IPriceSource {
    uint256 public spotPrice = 80_000e18;

    function set(uint256 p) external {
        spotPrice = p;
    }
}

/// market with a 1% fee, auction with a 0.5% fee, a lens, and one position for alice
abstract contract V3Base is Base {
    DeedMarket public market;
    RescueAuction public auction;
    DeedLens public lens;
    FixedSpot public spot;
    uint256 id;
    PositionVault vault;

    uint256 constant MARKET_FEE = 100;
    uint256 constant AUCTION_FEE = 50;
    uint256 constant PRICE = 5_000e18;
    uint256 constant MIN_ICR = 2e18;

    function _init() internal virtual override {
        spot = new FixedSpot();
        ITroveManager tm = ITroveManager(address(mezo));
        IPriceFeed pf = IPriceFeed(address(mezo));
        market = new DeedMarket(deed, factory, tm, pf, IMUSD(address(musd)), treasury, MARKET_FEE);
        auction = new RescueAuction(
            deed, factory, tm, pf, spot, IMUSD(address(musd)), 1.2e18, 1.8e18, 500, treasury, AUCTION_FEE
        );
        lens = new DeedLens(deed, factory, IBorrowerOperations(address(mezo)), tm, pf, IMUSD(address(musd)));
        deed.init(address(factory), address(market), address(auction));
    }

    function setUp() public virtual override {
        super.setUp();
        (id, vault) = _open(alice, COLL, DEBT);
        vm.startPrank(address(mezo));
        musd.mint(bob, 50_000e18);
        musd.mint(mallory, 50_000e18);
        vm.stopPrank();
        _approveMUSD(bob, address(market));
        _approveMUSD(bob, address(auction));
        _approveMUSD(mallory, address(market));
        _approveMUSD(mallory, address(auction));
    }

    function _setPrice(uint256 p) internal {
        mezo.setPrice(p);
        spot.set(p);
    }

    function _list() internal returns (bytes32 snap) {
        vm.prank(alice);
        market.list(id, PRICE, uint64(block.timestamp + 1 days), MIN_ICR);
        snap = market.snapshot(vault, MIN_ICR);
    }

    /// entire debt as MUSD sees it: principal and interest, pending redistribution included
    function _entireDebt() internal view returns (uint256) {
        (, uint256 debt) = vault.liveState();
        return debt;
    }
}
