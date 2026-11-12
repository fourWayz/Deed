// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPriceSource} from "./interfaces/IPriceSource.sol";

/// @dev The part of a Velodrome / Tigris pool that keeps cumulative reserves.
interface ITwapPair {
    function token0() external view returns (address);
    function observationLength() external view returns (uint256);
    function observations(uint256 index)
        external
        view
        returns (uint256 timestamp, uint256 reserve0Cumulative, uint256 reserve1Cumulative);
    function currentCumulativePrices()
        external
        view
        returns (uint256 reserve0Cumulative, uint256 reserve1Cumulative, uint256 blockTimestamp);
}

/// @notice Time weighted BTC/MUSD price from the pool's own observations.
/// It averages the reserves between the newest observation that is at least `minWindow` old and now.
/// Reserves moved inside one block carry no weight, because the cumulative values only grow with time.
/// It is only a cross check, the Mezo oracle still sets every price Deed uses.
contract PairTwapPrice is IPriceSource {
    // how many observations to walk back looking for one that is old enough
    uint256 public constant MAX_STEPS = 24;

    ITwapPair public immutable pair;
    bool public immutable musdIsToken0;
    uint256 public immutable minWindow;

    error NoObservation();
    error BadParams();

    /// @dev both tokens must have 18 decimals
    constructor(ITwapPair pair_, address musd_, uint256 minWindow_) {
        if (minWindow_ == 0) revert BadParams();
        pair = pair_;
        musdIsToken0 = pair_.token0() == musd_;
        minWindow = minWindow_;
    }

    function spotPrice() external view returns (uint256) {
        (uint256 c0, uint256 c1, uint256 nowTs) = pair.currentCumulativePrices();
        uint256 n = pair.observationLength();
        uint256 steps = n < MAX_STEPS ? n : MAX_STEPS;
        for (uint256 k = 1; k <= steps; k++) {
            (uint256 ts, uint256 o0, uint256 o1) = pair.observations(n - k);
            if (nowTs >= ts + minWindow) {
                uint256 d0 = c0 - o0;
                uint256 d1 = c1 - o1;
                if (d0 == 0 || d1 == 0) revert NoObservation();
                // both deltas grow with the same elapsed time, so the ratio is the average reserve ratio
                (uint256 musdSum, uint256 btcSum) = musdIsToken0 ? (d0, d1) : (d1, d0);
                return musdSum * 1e18 / btcSum;
            }
        }
        revert NoObservation();
    }
}
