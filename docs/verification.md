# Source verification

## First deployment (cancun build), checked 2026-10-24

Blockscout (`api.explorer.test.mezo.org`) accepted every submission and answered `Fail - Unable to verify`. Sourcify
verified all five contracts with an exact match on both creation and runtime bytecode. Chain 31611 is in Sourcify's list.

| Contract | Address | Sourcify |
| --- | --- | --- |
| DeedNFT | `0xfE5Db5D095f6c413f778Af683Aa9C5a92bee6755` | exact match, match id 56842926 |
| DeedFactory | `0x2928D2Dc566ec5f5D859F76B65CD829de5056d84` | exact match, match id 56842937 |
| DeedMarket | `0xd371095E5ec20154dCB4Bb6076cC1A35C6b8852F` | exact match, match id 56842940 |
| RescueAuction | `0x4CabFbD149cbC44a61aD574c1baE95c277Cb145B` | exact match, match id 56842962 |
| PairSpotPrice | `0x699Ea2CE021B94FDD8f9E55e4bD12CBAA41e86e5` | exact match, match id 56843085 |

The first PairSpotPrice job came back empty and a resubmission matched, so a submission that shows no match yet is
worth retrying once.

Reproduce one: `forge verify-contract <addr> src/DeedNFT.sol:DeedNFT --verifier sourcify --chain 31611 --rpc-url $MEZO_TESTNET_RPC --compiler-version 0.8.24`
(add `--constructor-args` for the others), then read `https://sourcify.dev/server/v2/contract/31611/<addr>`.
Sourcify's v1 endpoints are gone, only v2 answers.
