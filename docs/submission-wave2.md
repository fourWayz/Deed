DEED - WAVE 2 SUBMISSION (AKINDO)

Project: Deed
Network: Mezo testnet, chain id 31611
Code: https://github.com/fourWayz/Deed
Live app: https://frontend-iota-blush-70.vercel.app
Demo video: TODO
Track: TODO (exact track name from the AKINDO listing)

PROBLEM
A Mezo MUSD loan is stuck to the wallet that opened it. You cannot sell a healthy position, and you cannot hand a risky one to someone who will rescue it. To leave, you repay and close.

WHAT DEED DOES
Deed puts each loan in its own vault and makes control of that vault an NFT, the Deed. Whoever holds the Deed is the only one who can add collateral, repay, withdraw or close through the vault. The position can be sold two ways: at a fixed price on a market, or through a rescue auction when it is close to liquidation.

WHO IT IS FOR
Borrowers who want out of a position without closing it, buyers who want an existing position, rescuers who want to take on a position near liquidation, and builders who want position data.

WHAT IS LIVE TODAY (WAVE 1, DEPLOYED AND TESTED)
Five contracts on Mezo testnet, all with an exact Sourcify match. The explorer source view is empty because the Mezo Blockscout verifier rejected every submission, including an unrelated control contract. Details: docs/verification.md in the repo.

DeedNFT
https://explorer.test.mezo.org/address/0x848063cbD0230B6A4345311Ec090FDb51F49b681
Source: https://repo.sourcify.dev/31611/0x848063cbD0230B6A4345311Ec090FDb51F49b681

DeedFactory
https://explorer.test.mezo.org/address/0x25ADc1306C9ad1529EC00b14ED353B4B198eB8Fc
Source: https://repo.sourcify.dev/31611/0x25ADc1306C9ad1529EC00b14ED353B4B198eB8Fc

DeedMarket
https://explorer.test.mezo.org/address/0x7e8a3d9624A4b69b5ADCD362028422b85eDF2e99
Source: https://repo.sourcify.dev/31611/0x7e8a3d9624A4b69b5ADCD362028422b85eDF2e99

RescueAuction
https://explorer.test.mezo.org/address/0x190fB7559BB8023ecAA7c90CFcC17187042B89F9
Source: https://repo.sourcify.dev/31611/0x190fB7559BB8023ecAA7c90CFcC17187042B89F9

PairSpotPrice (DEX price guard, reads the live Tigris MUSD/BTC pool)
https://explorer.test.mezo.org/address/0xc8978277f2BCe7c06F9612d457c12B24F364Ec24
Source: https://repo.sourcify.dev/31611/0xc8978277f2BCe7c06F9612d457c12B24F364Ec24

These contracts have no fee, no owner, no pause and no upgrade path.

PROOF IT RUNS
A live run with two wallets sent 31 transactions and passed on its first attempt. Every hash is in docs/demo.md and opens at https://explorer.test.mezo.org/tx/<hash>.
Fixed price sale: 100 MUSD paid, 100 MUSD received, and a stale snapshot is rejected on chain with SnapshotMismatch.
Rescue auction: a position at 116.99 percent ICR was rescued to 150.33 percent. The auction fell from 539.93 MUSD toward a floor of 431.95 MUSD (80 percent of equity). The winner paid 539.48 MUSD and added 0.008268 BTC in the same transaction.
A browser pass of the production app passed 25 of 28, 13 of 14 and 14 of 14 checks across three runs. It found one real bug (the rescue form defaulted to a 50 percent floor against the new 80 percent minimum), which was fixed.

SAFETY RULES ENFORCED BY THE DEPLOYED CONTRACTS
A stranger can start a rescue only below 120 percent ICR. Every auction floor is at least 80 percent of equity. The Mezo oracle sets every price and the DEX only acts as a guard. A listing or an auction freezes the vault for everyone. The contracts are not audited.

WHAT IS NEW IN WAVE 2 (BUILT ON BRANCHES, NOT DEPLOYED, NOT CLAIMED AS LIVE)
A capped fee on sales and rescues, paid to an immutable treasury. The cap is 1 percent in the contract and the rate cannot change after deploy. Fee value: TODO.
A time-weighted DEX price guard and a read-only lens contract. TODO: tests and deployment.
An indexer, a keeper bot, an SDK and MCP server, and a second frontend. TODO: nothing from these is running yet.
Wave 2 contract addresses and explorer links: TODO, they will be added after the deployment transactions exist.

BUSINESS MODEL
A small fee paid by the seller on a sale or a rescue win, capped and immutable so nobody has to trust an owner. A paid data API on top of the indexer is later revenue. Details: docs/business-model.md.

USERS AND TRACTION
TODO. There is no indexer data yet, so no user, volume or revenue figure is claimed.

LIMITATIONS
Not audited. The DEX deviation limit is 10 percent on testnet because the testnet pool sits about 3 percent under the oracle. Extension wallets, a WalletConnect session and the End auction button were not tested.

HOW TO TRY IT
Open https://frontend-iota-blush-70.vercel.app, connect a wallet on Mezo testnet with test BTC from https://faucet.test.mezo.org/, open a position, list it and buy it from a second wallet.
