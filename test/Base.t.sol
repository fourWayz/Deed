// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeedNFT} from "../src/DeedNFT.sol";
import {DeedFactory} from "../src/DeedFactory.sol";
import {PositionVault} from "../src/PositionVault.sol";
import {IBorrowerOperations, ITroveManager, IPriceFeed, IMUSD} from "../src/interfaces/IMezo.sol";
import {MockMezo, MockMUSD} from "./mocks/MockMezo.sol";

abstract contract Base is Test {
    MockMezo public mezo;
    MockMUSD public musd;
    DeedNFT public deed;
    DeedFactory public factory;

    // stand-ins for the venues until the real ones exist
    address venue = makeAddr("venue");
    address otherVenue = makeAddr("otherVenue");

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address mallory = makeAddr("mallory");

    uint256 constant COLL = 0.1 ether;
    uint256 constant DEBT = 2_000e18;

    function setUp() public virtual {
        mezo = new MockMezo();
        musd = mezo.musd();
        deed = new DeedNFT();
        factory = new DeedFactory(
            deed,
            IBorrowerOperations(address(mezo)),
            ITroveManager(address(mezo)),
            IPriceFeed(address(mezo)),
            IMUSD(address(musd))
        );
        _init();
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(mallory, 100 ether);
    }

    /// suites with real venues override this to register them
    function _init() internal virtual {
        deed.init(address(factory), venue, otherVenue);
    }

    function _open(address who, uint256 coll, uint256 debt) internal returns (uint256 id, PositionVault v) {
        vm.prank(who);
        (uint256 tokenId, address vault) = factory.createPosition{value: coll}(debt, address(0), address(0));
        return (tokenId, PositionVault(payable(vault)));
    }

    function _approveMUSD(address who, address spender) internal {
        vm.prank(who);
        musd.approve(spender, type(uint256).max);
    }
}
