// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice A second BTC/MUSD price, used only to sanity check the Mezo oracle.
interface IPriceSource {
    /// @return MUSD per 1 BTC, 18 decimals
    function spotPrice() external view returns (uint256);
}
