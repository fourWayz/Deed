# Pitch outline (10 slides)

Every number has a source. `demo.md` is [docs/demo.md](demo.md), `e2e` is [docs/e2e-results.json](e2e-results.json),
`mezo-notes` is [docs/mezo-notes.md](mezo-notes.md). TODO means there is no verified figure yet, so say nothing on the slide
or show the TODO as an open item. The v3 contracts have a recorded testnet run in `docs/demo.md` on `feat/contracts-v3`, but they are not in this branch's `deployments.json` or README address table yet (TODO), and the indexer, keeper, SDK and MCP are not running, so no slide may call those live.

| # | Slide | What to say | Numbers to use | Source |
| --- | --- | --- | --- | --- |
| 1 | Title | Deed: sell or rescue a Mezo MUSD loan | Mezo testnet, chain id 31611 | README |
| 2 | Problem | A MUSD loan is stuck to the wallet that opened it. You cannot sell a healthy position or hand a risky one to someone who will rescue it | Liquidation at 110% ICR. Minimum net debt 1,800 MUSD | mezo-notes (MCR, `minNetDebt`) |
| 3 | Idea | Each loan lives in its own vault. Control of the vault is an NFT, the Deed. Sell the Deed, sell the position | 2 venues: fixed price market, rescue auction | README, How it works |
| 4 | Fixed price sale | List for MUSD, the Deed locks, the buyer sends a snapshot hash and the sale reverts if the position changed | Live sale: 100 MUSD paid, 100 MUSD received. A stale snapshot reverts with `SnapshotMismatch` | e2e `.sale`, demo.md (Live run on the second deployment) |
| 5 | Rescue auction | A Dutch auction from the owner's equity down to a floor. The winner adds BTC and the position leaves safe. Say it is a run that already happened on v3, shown from its hashes, not a new live run | ICR 116.98% to 150.70%. Winner paid 538.02 MUSD: seller 535.33 plus fee 2.69. Floor is 80% of equity by rule | v3 run in `docs/demo.md` on `feat/contracts-v3` (rows 16, 19, 20, 21): start `0x54d55873d048d6cfc2410c402184a9b28f22b5b9f00fa5cbf28aae36cdd7cdbf`, bid `0x8d6d412367d36476f4a62b101b87fb1651e757b65c27e031a5a23be19a38b872` |
| 6 | Safety rules | A stranger starts a rescue only under 120%. Every floor is at least 80% of equity. The oracle prices, the DEX only guards. No owner, no pause, no upgrade | Max a stranger can take: 20% of equity. DEX limit 1000 bps on testnet (1 to 2% suggested for mainnet) | security.md, README |
| 7 | Proof it runs | Live run on Mezo testnet with two wallets, including the reverts that prove the rules | 31 transactions in the run, passed first attempt. Browser pass: 25 of 28, 13 of 14, 14 of 14 checks, with the two failures explained | demo.md |
| 8 | Wave 2 | Capped fee, TWAP guard, indexer, keeper, SDK and MCP. State plainly what is only on branches: v3 contracts have a recorded run (TODO: merge their addresses here), the indexer, keeper, SDK and MCP do not run yet | Fee cap 1% (`MAX_FEE_BPS = 100`). v3 run used 50 bps (sale: seller 99.5, treasury 0.5). Address merge TODO | `feat/contracts-v3` working tree, business-model.md |
| 9 | Business model | A small fee on sales and rescues, paid by the seller, capped in the contract and immutable. Premium data API later | v3 run at 50 bps: 0.5 MUSD on the 100 MUSD sale, 2.69 MUSD on the 538.02 MUSD rescue. Cap is 1%. Volume TODO | business-model.md, v3 run in demo.md on `feat/contracts-v3` |
| 10 | Ask and next steps | Wave 2 deploy, indexer live, keeper running, audit. Not audited today | Users, volume, revenue: TODO (no indexer data yet) | security.md (Limitations), indexer TODO |

## Notes per slide

- Slide 2: the 110% and 1,800 figures were live reads at research time, re-read before presenting.
- Slide 5: all numbers are from the v3 run, the seller's 535.33 and the fee of 2.69 add up to the 538.02 paid. The earlier second
  deployment rescue (539.48 paid) is a different run, do not mix the two on one slide. TODO: v3 is not yet in this branch's address table.
- Slide 7: do not round the browser pass up. Run 1 had a real bug (the floor default of 50% against the new 80% minimum),
  found and fixed. Saying so is a strength.
- Slide 8 and 10: the only way a Wave 2 number can appear is from a deployment transaction or the indexer. Until then it
  stays TODO.

## Do not say

- That the rescue on slide 5 is a fresh live run. It is the v3 run that already happened, shown from its hashes.
- That a rescue always gets to run. Three positions were redeemed within a few blocks before an auction could start (see Q&A).
- Who redeemed them. We do not know.
- That fees are collected in volume. The only fee data is the v3 recorded run, and the Wave 1 contracts have no fee.
- Users, TVL, volume or revenue figures. There are none yet.
- That the contracts are audited. A manual review is in security.md, it is not an audit.
- That extension wallets, WalletConnect sessions or "End auction" were tested. They were not (demo.md, Not tested).

## Q&A: redemption before rescue

- **Can a rescue fail to start?** Yes, observed. On testnet three positions that had just become the lowest-ICR trove were redeemed in
  full within a few blocks, before a rescue auction could run: Deed #3 `0x69783574d2229eba5ad2444e1da5c43832688a00b227a9ba906d3afc3233f3ec`
  (2 blocks after open, v3 `docs/demo.md`), Deed #5 `0x6571a3bc16550cfdb58e196751c8f83d7621f10dabdb646ba47bc24db19a0cc3` (3 blocks after
  the withdraw) and Deed #6 `0x7731a6138212cf50933c4acf21d93d6af501ef0c6ad4f95d45c5d0469f9a1863` (4 blocks), both in `docs/ui-pass-v3.md`.
- **Is anyone's money lost?** Not in these cases: the holder claimed the surplus through the vault each time. What is lost is the rescue.
- **Who did it?** We do not know and do not say.
- **Always?** No. Deed #4 at 117% was not redeemed.
- **What next?** Redemption-queue-aware rescue, on the README roadmap. Not built.
