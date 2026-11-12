// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {V3Base} from "./V3Base.t.sol";
import {PairTwapPrice, ITwapPair} from "../src/PairTwapPrice.sol";
import {PairSpotPrice, IPair} from "../src/PairSpotPrice.sol";
import {IPriceSource} from "../src/interfaces/IPriceSource.sol";
import {RescueAuction} from "../src/RescueAuction.sol";
import {PositionVault} from "../src/PositionVault.sol";
import {ITroveManager, IPriceFeed, IMUSD} from "../src/interfaces/IMezo.sol";

/// Keeps cumulative reserves the way a Velodrome / Tigris pool does: every change first adds the old
/// reserves times the time since the last change, and an observation is stored every 30 minutes.
contract MockTwapPool {
    address public token0;
    uint256 public reserve0;
    uint256 public reserve1;
    uint256 public reserve0CumulativeLast;
    uint256 public reserve1CumulativeLast;
    uint256 public blockTimestampLast;

    struct Observation {
        uint256 timestamp;
        uint256 reserve0Cumulative;
        uint256 reserve1Cumulative;
    }

    Observation[] public observations;

    constructor(address t0, uint256 r0, uint256 r1) {
        token0 = t0;
        reserve0 = r0;
        reserve1 = r1;
        blockTimestampLast = block.timestamp;
        observations.push(Observation(block.timestamp, 0, 0));
    }

    function observationLength() external view returns (uint256) {
        return observations.length;
    }

    function getReserves() external view returns (uint256, uint256, uint256) {
        return (reserve0, reserve1, blockTimestampLast);
    }

    function currentCumulativePrices() public view returns (uint256 c0, uint256 c1, uint256 ts) {
        ts = block.timestamp;
        uint256 dt = ts - blockTimestampLast;
        c0 = reserve0CumulativeLast + reserve0 * dt;
        c1 = reserve1CumulativeLast + reserve1 * dt;
    }

    /// a swap or sync: settles the cumulative values with the old reserves, then sets the new ones
    function setReserves(uint256 r0, uint256 r1) external {
        (uint256 c0, uint256 c1, uint256 ts) = currentCumulativePrices();
        reserve0CumulativeLast = c0;
        reserve1CumulativeLast = c1;
        blockTimestampLast = ts;
        Observation memory last = observations[observations.length - 1];
        if (ts - last.timestamp >= 30 minutes) observations.push(Observation(ts, c0, c1));
        reserve0 = r0;
        reserve1 = r1;
    }
}

contract PairTwapPriceTest is Test {
    address musd = makeAddr("musd");
    MockTwapPool pool;
    PairTwapPrice twap;

    // 80,000 MUSD per BTC
    uint256 constant R_MUSD = 8_000_000e18;
    uint256 constant R_BTC = 100e18;

    function setUp() public {
        vm.warp(1_700_000_000);
        pool = new MockTwapPool(musd, R_MUSD, R_BTC);
        twap = new PairTwapPrice(ITwapPair(address(pool)), musd, 1 hours);
    }

    /// quiet pool: a swap every 30 minutes that leaves the price where it was
    function _quietHours(uint256 n) internal {
        for (uint256 i = 0; i < n * 2; i++) {
            skip(30 minutes);
            pool.setReserves(R_MUSD, R_BTC);
        }
    }

    function test_steadyPool_returnsThePoolPrice() public {
        _quietHours(3);
        assertEq(twap.spotPrice(), 80_000e18);
    }

    function test_worksWhenMusdIsToken1() public {
        MockTwapPool p = new MockTwapPool(makeAddr("btc"), R_BTC, R_MUSD);
        PairTwapPrice t = new PairTwapPrice(ITwapPair(address(p)), musd, 1 hours);
        skip(3 hours);
        p.setReserves(R_BTC, R_MUSD);
        skip(1 hours);
        assertEq(t.spotPrice(), 80_000e18);
    }

    function test_revertsWhenThePoolIsTooYoung() public {
        skip(20 minutes);
        vm.expectRevert(PairTwapPrice.NoObservation.selector);
        twap.spotPrice();
    }

    function test_oneBlockReserveSpike_doesNotMoveTheAverage() public {
        _quietHours(3);
        PairSpotPrice instant = new PairSpotPrice(IPair(address(pool)), musd);
        uint256 before_ = twap.spotPrice();

        // a flash loan swings the pool 50% in this very block
        pool.setReserves(R_MUSD * 3 / 2, R_BTC);
        assertGt(instant.spotPrice(), before_ * 14 / 10, "instant price jumped");
        assertEq(twap.spotPrice(), before_, "time weighted price did not");
    }

    function test_shortSpike_movesTheAverageByItsTimeShare() public {
        _quietHours(3);
        uint256 before_ = twap.spotPrice();
        // price doubled for 6 minutes of the roughly 60 to 90 minute window
        pool.setReserves(R_MUSD * 2, R_BTC);
        skip(6 minutes);
        pool.setReserves(R_MUSD, R_BTC);
        uint256 after_ = twap.spotPrice();
        assertGt(after_, before_);
        // far less than the 100% the spike reached
        assertLt(after_, before_ * 112 / 100);
    }

    function test_sustainedMove_isFollowedOnlyAsTimePasses() public {
        _quietHours(3);
        pool.setReserves(R_MUSD * 2, R_BTC);
        skip(30 minutes);
        uint256 half = twap.spotPrice();
        skip(30 minutes);
        uint256 later = twap.spotPrice();
        skip(2 hours);
        uint256 muchLater = twap.spotPrice();
        assertLt(half, later);
        assertLe(later, muchLater);
        assertLe(muchLater, 160_000e18);
    }

    function test_usesTheNewestObservationOldEnough() public {
        _quietHours(3);
        // the newest observation is 30 minutes old, too young for the 1 hour window, so an older one is used
        skip(30 minutes);
        pool.setReserves(R_MUSD, R_BTC);
        assertEq(twap.spotPrice(), 80_000e18);
    }

    function test_constructor_rejectsZeroWindow() public {
        vm.expectRevert(PairTwapPrice.BadParams.selector);
        new PairTwapPrice(ITwapPair(address(pool)), musd, 0);
    }
}

/// the price guard inside the auction, with the time weighted source plugged in
contract AuctionWithTwapTest is V3Base {
    MockTwapPool pool;
    PairTwapPrice twap;
    RescueAuction twapAuction;

    function setUp() public override {
        vm.warp(1_700_000_000);
        super.setUp();
        pool = new MockTwapPool(address(musd), 8_000_000e18, 100e18);
        for (uint256 i = 0; i < 6; i++) {
            skip(30 minutes);
            pool.setReserves(8_000_000e18, 100e18);
        }
        twap = new PairTwapPrice(ITwapPair(address(pool)), address(musd), 1 hours);
        // a second auction on the same Deed contract is not possible once init ran, so test the guard through
        // the source directly and through an auction deployed against the same mocks
        twapAuction = _newAuction(200);
    }

    function _newAuction(uint256 deviationBps) internal returns (RescueAuction) {
        return new RescueAuction(
            deed,
            factory,
            ITroveManager(address(mezo)),
            IPriceFeed(address(mezo)),
            twap,
            IMUSD(address(musd)),
            1.2e18,
            1.8e18,
            deviationBps,
            treasury,
            50
        );
    }

    function test_flashSpike_cannotCensorTheOracleCheck() public {
        // the guard reads the time weighted price, so a one block reserve swing does not trip it
        mezo.setPrice(80_000e18);
        pool.setReserves(8_000_000e18 * 2, 100e18);
        assertEq(twap.spotPrice(), 80_000e18);
        // equityOf reads through the guard and still answers
        twapAuction.equityOf(id);
    }

    function test_instantSourceIsCensorable_twapIsNot() public {
        mezo.setPrice(80_000e18);
        RescueAuction instantAuction = new RescueAuction(
            deed,
            factory,
            ITroveManager(address(mezo)),
            IPriceFeed(address(mezo)),
            new InstantFromPool(pool, address(musd)),
            IMUSD(address(musd)),
            1.2e18,
            1.8e18,
            200,
            treasury,
            50
        );
        pool.setReserves(8_000_000e18 * 12 / 10, 100e18);
        vm.expectRevert();
        instantAuction.equityOf(id);
        twapAuction.equityOf(id);
    }

    function test_realDeviationStillBlocks() public {
        // if the pool really sat 20% off the oracle for hours, the 200 bps guard refuses
        mezo.setPrice(80_000e18);
        pool.setReserves(8_000_000e18 * 12 / 10, 100e18);
        skip(3 hours);
        pool.setReserves(8_000_000e18 * 12 / 10, 100e18);
        vm.expectRevert();
        twapAuction.equityOf(id);
    }

    function test_deviationLimitIsTwoPercentInThisSetup() public view {
        assertEq(twapAuction.maxDeviationBps(), 200);
    }
}

contract InstantFromPool is IPriceSource {
    MockTwapPool pool;
    address musd;

    constructor(MockTwapPool p, address m) {
        pool = p;
        musd = m;
    }

    function spotPrice() external view returns (uint256) {
        return pool.reserve0() * 1e18 / pool.reserve1();
    }
}
