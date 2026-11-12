# Source verification

## Third deployment (v3, london build), checked 2026-11-12

Deployed in one broadcast, built with `evm_version = "london"`. The only `PUSH0` / `MCOPY` / `TLOAD` hits in the runtime
code are in the last ten lines of the disassembly of `DeedNFT` and `DeedFactory`, which is the Solidity metadata tail read as
instructions, not code.

| Contract | Address | Sourcify | Mezo explorer API |
| --- | --- | --- | --- |
| DeedNFT | `0x9C92E662cB7de018162E1d06F1f977f6A0B5547f` | exact match | source and ABI returned |
| DeedFactory | `0xb8602DBF0e5BBDE81C504C87F860fbbe7DF125CD` | exact match | source and ABI returned |
| DeedMarket | `0x862e105bDE51B27c3B9670810c5B9Ea3b470Cbdd` | exact match | source and ABI returned |
| RescueAuction | `0xbF4Fe3aF0C5c138AE28230AF1Cb9b0C8cf2c8355` | exact match | source and ABI returned |
| DeedLens | `0xDd628bBb4663549E0Af7815E93D14002D1f9Dde1` | exact match | source and ABI returned |
| PairTwapPrice | `0xda3e5a7785Ba49B87B5884dB7662e44Af31f4d00` | exact match | source and ABI returned |

Sourcify's `match`, `creationMatch` and `runtimeMatch` are all `exact_match` (read from
`https://sourcify.dev/server/v2/contract/31611/<address>`; DeedNFT verified at 16:28 UTC and DeedMarket at 16:30 UTC).

**What changed on the explorer side.** The sections below record that the Mezo Blockscout verifier rejected every submission
in October. On 2026-11-12 `https://api.explorer.test.mezo.org/api?module=contract&action=getsourcecode` returns the contract
name, ABI and source for the v3 contracts and also for the second deployment's `DeedNFT`. `scripts/verify.sh` submitted to both
services, so this document cannot say whether the explorer verified the source itself or picked it up from Sourcify. It was not
looked at in a browser. The explorer page may still differ from the API.

`scripts/verify.sh` (set `ENV_FILE` to a file with `MEZO_TESTNET_RPC`) reads `deployments.json`, submits to both services and
prints one line per contract.

---

# Earlier deployments

## First deployment (cancun build), checked 2026-10-24. Superseded, do not use

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

## Second deployment (london build), checked 2026-10-24

Deployed after the rescue changes, built with `evm_version = "london"`. No opcode newer than london is in the bytecode
(`PUSH0`, `MCOPY` and transient storage are all absent from the runtime code of the six contracts).

| Contract | Address | Sourcify | Blockscout |
| --- | --- | --- | --- |
| DeedNFT | `0x848063cbD0230B6A4345311Ec090FDb51F49b681` | exact match | not verified |
| DeedFactory | `0x25ADc1306C9ad1529EC00b14ED353B4B198eB8Fc` | exact match | not verified |
| DeedMarket | `0x7e8a3d9624A4b69b5ADCD362028422b85eDF2e99` | exact match | not verified |
| RescueAuction | `0x190fB7559BB8023ecAA7c90CFcC17187042B89F9` | exact match | not verified |
| PairSpotPrice | `0xc8978277f2BCe7c06F9612d457c12B24F364Ec24` | exact match | not verified |

### Why Blockscout is not verified

The london switch was made on the theory that the explorer's verifier only knows EVM versions up to london. It did not help,
so the cause is somewhere else. Controls, deployed from the same wallet and submitted the same way:

| Control | Settings | Result |
| --- | --- | --- |
| `Tiny` `0xd9C26962F5aaF88069d2771448D1859C0ab88240` (one immutable) | london, no via-IR, 200 runs | `Fail - Unable to verify` (standard JSON via forge, flattened source via the v2 API, flattened source via the v1 API) |
| `Bare` `0x3e35C323ce3ACe456E9E230F79D4CCfA78bA51b3` (no constructor, no immutable) | london, no via-IR, 200 runs | `Fail - Unable to verify` |

A contract this small compiled with default-like settings fails too, so neither via-IR, cancun, immutables nor Deed's imports
explain it. The explorer queues each job ("Pending in queue") and then rejects it. Until that verifier works, use Sourcify.
Both control contracts are throwaway and sit on testnet.

`scripts/verify.sh` reads `deployments.json`, submits to both services and prints one line per contract.
