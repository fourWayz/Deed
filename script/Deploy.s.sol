// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {DeedNFT} from "../src/DeedNFT.sol";
import {DeedFactory} from "../src/DeedFactory.sol";
import {DeedMarket} from "../src/DeedMarket.sol";
import {RescueAuction} from "../src/RescueAuction.sol";
import {PairSpotPrice, IPair} from "../src/PairSpotPrice.sol";
import {IPriceSource} from "../src/interfaces/IPriceSource.sol";
import {IBorrowerOperations, ITroveManager, IPriceFeed, IMUSD} from "../src/interfaces/IMezo.sol";

/// forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast
/// Reads PRIVATE_KEY from the environment. Set DEX_PAIR to a MUSD/BTC pair to wrap in PairSpotPrice,
/// or SPOT_SOURCE to an existing IPriceSource. DEVIATION_BPS overrides the 5% oracle/DEX limit.
contract Deploy is Script {
    // Mezo testnet, checked on chain, see docs/mezo-notes.md
    address constant BO = 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5;
    address constant TM = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address constant PF = 0x86bCF0841622a5dAC14A313a15f96A95421b9366;
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;

    uint256 constant RESCUE_ICR = 1.2e18;
    uint256 constant SAFE_ICR = 1.5e18;
    uint256 constant DEFAULT_DEVIATION_BPS = 500;

    function run() external {
        uint256 maxDeviationBps = vm.envOr("DEVIATION_BPS", DEFAULT_DEVIATION_BPS);
        vm.startBroadcast(_key());

        IPriceSource spot;
        address pair = vm.envOr("DEX_PAIR", address(0));
        if (pair != address(0)) {
            spot = new PairSpotPrice(IPair(pair), MUSD);
        } else {
            spot = IPriceSource(vm.envAddress("SPOT_SOURCE"));
        }

        DeedNFT deed = new DeedNFT();
        DeedFactory factory =
            new DeedFactory(deed, IBorrowerOperations(BO), ITroveManager(TM), IPriceFeed(PF), IMUSD(MUSD));
        DeedMarket market = new DeedMarket(deed, factory, ITroveManager(TM), IPriceFeed(PF), IMUSD(MUSD));
        RescueAuction auction = new RescueAuction(
            deed, factory, ITroveManager(TM), IPriceFeed(PF), spot, IMUSD(MUSD), RESCUE_ICR, SAFE_ICR, maxDeviationBps
        );
        // same broadcast as the deploys, and init only accepts the deployer, so nobody can get in between
        deed.init(address(factory), address(market), address(auction));

        vm.stopBroadcast();

        console.log("DeedNFT:", address(deed));
        console.log("DeedFactory:", address(factory));
        console.log("DeedMarket:", address(market));
        console.log("RescueAuction:", address(auction));
        console.log("SpotSource:", address(spot));
    }

    /// accepts the key with or without a 0x prefix
    function _key() internal view returns (uint256) {
        string memory raw = vm.envString("PRIVATE_KEY");
        bytes memory b = bytes(raw);
        bool prefixed = b.length > 1 && b[0] == "0" && (b[1] == "x" || b[1] == "X");
        return vm.parseUint(prefixed ? raw : string.concat("0x", raw));
    }
}
