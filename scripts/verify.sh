#!/bin/bash
# Submits the deployed contracts to the Mezo Blockscout API. Reads MEZO_TESTNET_RPC and DEX_PAIR from .env.
# Needs forge. At deploy time this was accepted by the API but the explorer answered "Unable to verify", see README.
export PATH=$HOME/.foundry/bin:$PATH
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
BO=0xCdF7028ceAB81fA0C6971208e83fa7872994beE5
TM=0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0
PF=0x86bCF0841622a5dAC14A313a15f96A95421b9366
MUSD=0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503
D=0xfE5Db5D095f6c413f778Af683Aa9C5a92bee6755
F=0x2928D2Dc566ec5f5D859F76B65CD829de5056d84
M=0xd371095E5ec20154dCB4Bb6076cC1A35C6b8852F
A=0x4CabFbD149cbC44a61aD574c1baE95c277Cb145B
S=0x699Ea2CE021B94FDD8f9E55e4bD12CBAA41e86e5
API=https://api.explorer.test.mezo.org/api
isver() { curl -s --max-time 25 "$API?module=contract&action=getsourcecode&address=$1" | grep -q '"ContractName":"[A-Za-z]'; }
v() {
  addr=$1; name=$2; args=$3
  for i in 1 2 3; do
    if isver $addr; then echo "$name VERIFIED"; return; fi
    forge verify-contract $addr $name --verifier blockscout --verifier-url $API --rpc-url $MEZO_TESTNET_RPC \
      --compiler-version 0.8.24 ${args:+--constructor-args $args} 2>&1 | grep -E 'Response|rror' | cut -c1-160
    sleep 12
  done
  isver $addr && echo "$name VERIFIED" || echo "$name NOT verified"
}
v $D src/DeedNFT.sol:DeedNFT
v $F src/DeedFactory.sol:DeedFactory $(cast abi-encode 'c(address,address,address,address,address)' $D $BO $TM $PF $MUSD)
v $M src/DeedMarket.sol:DeedMarket $(cast abi-encode 'c(address,address,address,address,address)' $D $F $TM $PF $MUSD)
v $A src/RescueAuction.sol:RescueAuction $(cast abi-encode 'c(address,address,address,address,address,address,uint256,uint256,uint256)' $D $F $TM $PF $S $MUSD 1300000000000000000 1500000000000000000 1000)
v $S src/PairSpotPrice.sol:PairSpotPrice $(cast abi-encode 'c(address,address)' $DEX_PAIR $MUSD)
