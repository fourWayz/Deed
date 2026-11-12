# Pitch outline (10 slides)

Every number has a source. `demo.md` is [docs/demo.md](demo.md), `e2e` is [docs/e2e-results.json](e2e-results.json),
`mezo-notes` is [docs/mezo-notes.md](mezo-notes.md). TODO means there is no verified figure yet, so say nothing on the slide
or show the TODO as an open item. Nothing from Wave 2 is deployed, so no slide may call it live.

| # | Slide | What to say | Numbers to use | Source |
| --- | --- | --- | --- | --- |
| 1 | Title | Deed: sell or rescue a Mezo MUSD loan | Mezo testnet, chain id 31611 | README |
| 2 | Problem | A MUSD loan is stuck to the wallet that opened it. You cannot sell a healthy position or hand a risky one to someone who will rescue it | Liquidation at 110% ICR. Minimum net debt 1,800 MUSD | mezo-notes (MCR, `minNetDebt`) |
| 3 | Idea | Each loan lives in its own vault. Control of the vault is an NFT, the Deed. Sell the Deed, sell the position | 2 venues: fixed price market, rescue auction | README, How it works |
| 4 | Fixed price sale | List for MUSD, the Deed locks, the buyer sends a snapshot hash and the sale reverts if the position changed | Live sale: 100 MUSD paid, 100 MUSD received. A stale snapshot reverts with `SnapshotMismatch` | e2e `.sale`, demo.md (Live run on the second deployment) |
| 5 | Rescue auction | A Dutch auction from the owner's equity down to a floor. The winner adds BTC and the position leaves safe | ICR 116.99% to 150.33%. Start 539.93 MUSD, floor 431.95 MUSD (80%), paid 539.48 MUSD, top-up 0.008268 BTC | e2e `.rescue`, demo.md |
| 6 | Safety rules | A stranger starts a rescue only under 120%. Every floor is at least 80% of equity. The oracle prices, the DEX only guards. No owner, no pause, no upgrade | Max a stranger can take: 20% of equity. DEX limit 1000 bps on testnet (1 to 2% suggested for mainnet) | security.md, README |
| 7 | Proof it runs | Live run on Mezo testnet with two wallets, including the reverts that prove the rules | 31 transactions in the run, passed first attempt. Browser pass: 25 of 28, 13 of 14, 14 of 14 checks, with the two failures explained | demo.md |
| 8 | Wave 2 | Capped fee, TWAP guard, indexer, keeper, SDK and MCP. State plainly that these are built on branches and not deployed | Fee cap 1% (`MAX_FEE_BPS = 100`). Fee value TODO. Deployment TODO | `feat/contracts-v3` working tree, business-model.md |
| 9 | Business model | A small fee on sales and rescues, paid by the seller, capped in the contract and immutable. Premium data API later | At the 1% cap: 1.00 MUSD on the 100 MUSD sale, 5.39 MUSD on the 539.48 MUSD rescue (arithmetic, not collected). Volume TODO | business-model.md, demo.md |
| 10 | Ask and next steps | Wave 2 deploy, indexer live, keeper running, audit. Not audited today | Users, volume, revenue: TODO (no indexer data yet) | security.md (Limitations), indexer TODO |

## Notes per slide

- Slide 2: the 110% and 1,800 figures were live reads at research time, re-read before presenting.
- Slide 5: demo.md records the winner paying 539.48 MUSD and the seller receiving 539.41 MUSD, and explains it as the price
  falling a little more between quote and mining. Use the headline numbers. If asked about the 0.07 gap, quote demo.md
  and say it was not separately re-derived (TODO).
- Slide 7: do not round the browser pass up. Run 1 had a real bug (the floor default of 50% against the new 80% minimum),
  found and fixed. Saying so is a strength.
- Slide 8 and 10: the only way a Wave 2 number can appear is from a deployment transaction or the indexer. Until then it
  stays TODO.

## Do not say

- That fees are live or collected. The deployed contracts have no fee.
- Users, TVL, volume or revenue figures. There are none yet.
- That the contracts are audited. A manual review is in security.md, it is not an audit.
- That extension wallets, WalletConnect sessions or "End auction" were tested. They were not (demo.md, Not tested).
