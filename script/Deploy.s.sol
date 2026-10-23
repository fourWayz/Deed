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

/// forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast --private-key $DEPLOYER_KEY
/// Set SPOT_SOURCE to an IPriceSource, or DEX_PAIR to a V2 style MUSD/BTC pair to wrap in PairSpotPrice.
contract Deploy is Script {
    // Mezo testnet, checked on chain, see docs/mezo-notes.md
    address constant BO = 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5;
    address constant TM = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address constant PF = 0x86bCF0841622a5dAC14A313a15f96A95421b9366;
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;

    uint256 constant RESCUE_ICR = 1.3e18;
    uint256 constant SAFE_ICR = 1.5e18;
    uint256 constant MAX_DEVIATION_BPS = 500;

    function run() external {
        vm.startBroadcast();

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
            deed, factory, ITroveManager(TM), IPriceFeed(PF), spot, IMUSD(MUSD), RESCUE_ICR, SAFE_ICR, MAX_DEVIATION_BPS
        );
        deed.init(address(factory), address(market), address(auction));

        vm.stopBroadcast();

        console.log("DeedNFT:", address(deed));
        console.log("DeedFactory:", address(factory));
        console.log("DeedMarket:", address(market));
        console.log("RescueAuction:", address(auction));
        console.log("SpotSource:", address(spot));
    }
}
