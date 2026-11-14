DEED - WAVE 2 SUBMISSION (AKINDO)

Project: Deed
Track: DeFi: borrowing
Network: Mezo testnet, chain id 31611
Code: https://github.com/fourWayz/Deed
Indexer API: https://deed-lovat.vercel.app
Live app: https://frontend-iota-blush-70.vercel.app (TODO: confirm whether it runs the v3 contracts. The frontend on the main branch is configured for the v2 contracts, the v3 frontend is on the feat/frontend-v2 branch.)
Demo video: TODO

PROBLEM
A Mezo MUSD loan is stuck to the wallet that opened it. You cannot sell a healthy position, and you cannot hand a risky one to someone who will rescue it. To leave, you repay and close.

WHAT DEED DOES
Deed puts each loan in its own vault and makes control of that vault an NFT, the Deed. Whoever holds the Deed is the only one who can add collateral, repay, borrow, refinance, withdraw, close or claim surplus through the vault. The position can be sold two ways: at a fixed price on a market, or through a rescue auction when it is close to liquidation.

TARGET USERS
Borrowers who want to cash out of a healthy MUSD position without closing it, or exit a risky one for a fair price. Buyers who want an existing position instead of opening a new one. Rescuers who want to take over a position near liquidation, add BTC and keep the spread. Builders who want a position feed from the indexer API.

WHAT IS NEW IN WAVE 2 (DEPLOYED ON MEZO TESTNET, THIRD DEPLOYMENT)
A fee of 0.5 percent on market sales and on rescue wins. The contracts cap it at 1 percent, it is fixed at deploy, and it goes to an immutable treasury. On testnet the treasury is the deployer wallet. A multisig is planned for mainnet.
A one-hour time-weighted price guard. The testnet limit is 2000 bps (20 percent) because the testnet pool sits far from the oracle. The mainnet default is 200 bps.
DeedLens, a read-only contract for position data and Recovery Mode status.
Borrow, refinance and close with the entire debt through the vault.
An indexer with a read-only API for positions, listings, auctions, activity and stats.

CONTRACTS (MEZO TESTNET, EXACT SOURCIFY MATCH FOR ALL SIX)

DeedNFT - the ERC-721. Whoever holds a Deed controls its vault.
https://explorer.test.mezo.org/address/0x9C92E662cB7de018162E1d06F1f977f6A0B5547f
Source: https://repo.sourcify.dev/31611/0x9C92E662cB7de018162E1d06F1f977f6A0B5547f

DeedFactory - deploys a vault, mints the Deed and opens the trove in one transaction.
https://explorer.test.mezo.org/address/0xb8602DBF0e5BBDE81C504C87F860fbbe7DF125CD
Source: https://repo.sourcify.dev/31611/0xb8602DBF0e5BBDE81C504C87F860fbbe7DF125CD

DeedMarket - fixed price sales with a buyer-protection snapshot, 0.5 percent fee.
https://explorer.test.mezo.org/address/0x862e105bDE51B27c3B9670810c5B9Ea3b470Cbdd
Source: https://repo.sourcify.dev/31611/0x862e105bDE51B27c3B9670810c5B9Ea3b470Cbdd

RescueAuction - Dutch auction rescue for positions near liquidation, 0.5 percent fee.
https://explorer.test.mezo.org/address/0xbF4Fe3aF0C5c138AE28230AF1Cb9b0C8cf2c8355
Source: https://repo.sourcify.dev/31611/0xbF4Fe3aF0C5c138AE28230AF1Cb9b0C8cf2c8355

DeedLens - read-only: a position's entire debt, ICR, equity, surplus and Recovery Mode status.
https://explorer.test.mezo.org/address/0xDd628bBb4663549E0Af7815E93D14002D1f9Dde1
Source: https://repo.sourcify.dev/31611/0xDd628bBb4663549E0Af7815E93D14002D1f9Dde1

PairTwapPrice - one-hour time-weighted price guard over the live Tigris MUSD/BTC pool.
https://explorer.test.mezo.org/address/0xda3e5a7785Ba49B87B5884dB7662e44Af31f4d00
Source: https://repo.sourcify.dev/31611/0xda3e5a7785Ba49B87B5884dB7662e44Af31f4d00

PROOF IT RUNS
The v3 run with three wallets is in docs/demo.md in the repo, with every transaction hash. Open any hash at https://explorer.test.mezo.org/tx/<hash>.
Sale: 100 MUSD, seller received 99.5 and the treasury 0.5. Transaction: https://explorer.test.mezo.org/tx/0x483b9614a273e6a14f0ebb31b6bc4fce8b5ab498fa961efb38eb5c9c17da1f44
Rescue: a position at 116.98 percent ICR was rescued to 150.70 percent. The winner paid 538.022 MUSD, split into 535.332 to the seller and 2.690 fee. Start: https://explorer.test.mezo.org/tx/0x54d55873d048d6cfc2410c402184a9b28f22b5b9f00fa5cbf28aae36cdd7cdbf Bid: https://explorer.test.mezo.org/tx/0x8d6d412367d36476f4a62b101b87fb1651e757b65c27e031a5a23be19a38b872
The browser tests on v3 are in docs/ui-pass-v3.md, including what could not be tested.

TESTNET ACTIVITY FROM THE TEAM'S TEST WALLETS
This is not usage and not revenue. Both wallets that touched the contracts are ours (2 unique wallets). Indexer stats for all deployments at the start of the 13 November 2026 test pass: 7 positions, 4 sales, 4 rescues, volume 3126.73 MUSD, fees 6.19 MUSD. The fees went to our own treasury wallet. We have no outside users yet.

BUSINESS MODEL
A small fee paid by the seller on a sale or a rescue win, capped at 1 percent in the contract and immutable, so nobody has to trust an owner. A paid data API on top of the indexer is later revenue and is not built. Details: docs/business-model.md.

LIMITATIONS
Not audited. Three times on testnet a position that had just become the lowest-ICR trove was redeemed within a few blocks, before a rescue auction could run (hashes in the README and docs/security.md). We do not know who sent those redemptions. Redemption-queue-aware rescue is on the roadmap and not built. The testnet price guard limit is wide (20 percent). Extension wallets, a WalletConnect session and the End auction button were not tested. The keeper, SDK and MCP server are not part of this submission (TODO).

HOW TO TRY IT
Connect a wallet on Mezo testnet with test BTC from https://faucet.test.mezo.org/, open a position, list it and buy it from a second wallet. The steps and the transaction hashes of a full run are in docs/demo.md.
