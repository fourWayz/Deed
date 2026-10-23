// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PairSpotPrice, IPair} from "../../src/PairSpotPrice.sol";

/// Reads the live Tigris MUSD/BTC pool on Mezo testnet.
contract PairSpotForkTest is Test {
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address constant FACTORY = 0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A;
    address constant BTC = 0x7b7C000000000000000000000000000000000000;

    function setUp() public {
        vm.createSelectFork("mezo_testnet");
    }

    function test_realPoolPrice() public {
        (bool ok, bytes memory ret) =
            FACTORY.staticcall(abi.encodeWithSignature("getPool(address,address,bool)", MUSD, BTC, false));
        assertTrue(ok);
        address pool = abi.decode(ret, (address));
        assertTrue(pool != address(0), "no pool");

        PairSpotPrice src = new PairSpotPrice(IPair(pool), MUSD);
        uint256 price = src.spotPrice();
        (uint256 r0, uint256 r1,) = IPair(pool).getReserves();
        assertEq(price, (src.musdIsToken0() ? r0 : r1) * 1e18 / (src.musdIsToken0() ? r1 : r0));
        // sanity band, BTC has traded well inside this
        assertGt(price, 20_000e18);
        assertLt(price, 300_000e18);
    }
}
