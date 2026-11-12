// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PairTwapPrice, ITwapPair} from "../../src/PairTwapPrice.sol";

interface IPoolReserves {
    function getReserves() external view returns (uint256, uint256, uint256);
}

/// The time weighted source against the live Tigris MUSD/BTC volatile pool (read only).
contract PairTwapForkTest is Test {
    address constant POOL = 0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9;
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;

    function setUp() public {
        vm.createSelectFork("mezo_testnet");
    }

    function test_twap_readsTheRealPoolAndStaysNearItsInstantPrice() public {
        PairTwapPrice twap = new PairTwapPrice(ITwapPair(POOL), MUSD, 1 hours);
        (uint256 r0, uint256 r1,) = IPoolReserves(POOL).getReserves();
        uint256 instant = r0 * 1e18 / r1;
        uint256 avg = twap.spotPrice();
        emit log_named_uint("instant price", instant / 1e18);
        emit log_named_uint("twap price", avg / 1e18);
        assertGt(avg, 1_000e18);
        // an average over an hour or two of a quiet pool sits within a few percent of the instant price
        uint256 gap = avg > instant ? avg - instant : instant - avg;
        assertLt(gap * 100, instant * 15);
    }

    function test_twap_matchesAHandComputationFromTheObservations() public {
        PairTwapPrice twap = new PairTwapPrice(ITwapPair(POOL), MUSD, 1 hours);
        ITwapPair pool = ITwapPair(POOL);
        (uint256 c0, uint256 c1, uint256 nowTs) = pool.currentCumulativePrices();
        uint256 n = pool.observationLength();
        for (uint256 k = 1; k <= 24; k++) {
            (uint256 ts, uint256 o0, uint256 o1) = pool.observations(n - k);
            if (nowTs >= ts + 1 hours) {
                assertEq(twap.spotPrice(), (c0 - o0) * 1e18 / (c1 - o1));
                return;
            }
        }
        revert("no observation old enough in the last 24");
    }
}
