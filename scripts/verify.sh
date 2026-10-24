#!/bin/bash
# Verifies the contracts listed in deployments.json on Sourcify and on the Mezo Blockscout API.
# Reads MEZO_TESTNET_RPC and DEX_PAIR from .env. Needs forge and node. Prints no secrets.
export PATH=$(ls -d ~/.nvm/versions/node/v22*/bin 2>/dev/null | tail -1):$HOME/.foundry/bin:$PATH
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

j() { node -e "const d=require('./deployments.json'); console.log($1)"; }
BO=$(j d.borrowerOperations); TM=$(j d.troveManager); PF=$(j d.priceFeed); MUSD=$(j d.musd)
D=$(j d.deedNFT); F=$(j d.factory); M=$(j d.market); A=$(j d.auction); S=$(j d.spotSource)
RESCUE=$(j d.auctionParams.rescueICR); SAFE=$(j d.auctionParams.safeICR); DEV=$(j d.auctionParams.maxDeviationBps)

BLOCKSCOUT=https://api.explorer.test.mezo.org/api
SOURCIFY=https://sourcify.dev/server/v2/contract/31611

sourcify_ok() { curl -s -m 30 "$SOURCIFY/$1" | grep -q '"runtimeMatch":"\(exact_\)\?match"'; }
blockscout_ok() { curl -s -m 30 "$BLOCKSCOUT?module=contract&action=getsourcecode&address=$1" | grep -q '"ContractName":"[A-Za-z]'; }

verify() { # address name constructor-args
  local addr=$1 name=$2 args=$3
  for i in 1 2 3; do
    sourcify_ok $addr || forge verify-contract $addr $name --verifier sourcify --chain 31611 --rpc-url $MEZO_TESTNET_RPC \
      --compiler-version 0.8.24 ${args:+--constructor-args $args} >/dev/null 2>&1
    blockscout_ok $addr || forge verify-contract $addr $name --verifier blockscout --verifier-url $BLOCKSCOUT --rpc-url $MEZO_TESTNET_RPC \
      --compiler-version 0.8.24 ${args:+--constructor-args $args} >/dev/null 2>&1
    sleep 15
    sourcify_ok $addr && blockscout_ok $addr && break
  done
  printf '%-14s %s  sourcify=%s blockscout=%s\n' "${name##*:}" "$addr" "$(sourcify_ok $addr && echo yes || echo NO)" "$(blockscout_ok $addr && echo yes || echo NO)"
}

verify $D src/DeedNFT.sol:DeedNFT
verify $F src/DeedFactory.sol:DeedFactory $(cast abi-encode 'c(address,address,address,address,address)' $D $BO $TM $PF $MUSD)
verify $M src/DeedMarket.sol:DeedMarket $(cast abi-encode 'c(address,address,address,address,address)' $D $F $TM $PF $MUSD)
verify $A src/RescueAuction.sol:RescueAuction $(cast abi-encode 'c(address,address,address,address,address,address,uint256,uint256,uint256)' $D $F $TM $PF $S $MUSD $RESCUE $SAFE $DEV)
verify $S src/PairSpotPrice.sol:PairSpotPrice $(cast abi-encode 'c(address,address)' $DEX_PAIR $MUSD)
