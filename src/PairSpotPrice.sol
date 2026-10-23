// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPriceSource} from "./interfaces/IPriceSource.sol";

interface IPair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
}

/// @notice Spot price from a constant product pair (Uniswap V2 / Velodrome volatile style).
/// This is the pool's instant price, so it can be moved inside a transaction. It is only a cross check.
contract PairSpotPrice is IPriceSource {
    IPair public immutable pair;
    bool public immutable musdIsToken0;

    /// @dev both tokens must have 18 decimals
    constructor(IPair pair_, address musd_) {
        pair = pair_;
        musdIsToken0 = pair_.token0() == musd_;
    }

    function spotPrice() external view returns (uint256) {
        (uint112 r0, uint112 r1,) = pair.getReserves();
        (uint256 musdReserve, uint256 btcReserve) = musdIsToken0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        require(btcReserve > 0, "empty pool");
        return musdReserve * 1e18 / btcReserve;
    }
}
