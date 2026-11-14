# Business model

Status: **the fee is deployed on Mezo testnet in v3** (addresses in the README). The Wave 1 and v2 contracts have no fee. All
numbers below come from `docs/demo.md` (v3 run), `docs/ui-pass-v3.md` and `deployments.json`. "Arithmetic" means plain math on
the stated inputs, not a measurement. Whatever has no source is marked TODO.

## Fee design

- One fee, one place per venue: a fixed share of the **sale price** on `DeedMarket.buy`, and of the **winning price** on
  `RescueAuction.bid`. Nothing is charged for opening a position, holding one, listing, cancelling, or topping up.
- The share is `feeBps`, set once in the constructor, with a hard ceiling `MAX_FEE_BPS = 100` (1%) enforced in the
  constructor. A deploy with a higher value reverts.
- The treasury address is a constructor value too. Both are `immutable`: no owner, no setter, no pause, no upgrade.
- Math: `fee = price * feeBps / 10_000`, rounded down. The seller is credited `price - fee` and the treasury is credited `fee`,
  so the two always add up to the price. Both are pulled with `claim()`, like all other payouts.
- Deployed values (v3, `deployments.json`): `feeBps` is 50 (0.5%) on `DeedMarket` and 50 (0.5%) on `RescueAuction`, cap 100 (1%).
  Treasury `0x4989CC7150a869D6b07540B54B96fD02c5e0537c`. On testnet the treasury is the deployer wallet. A multisig is planned for
  mainnet, TODO: not set up.
- Mezo's own fees are separate and unchanged: 0.1% borrowing fee on debt increases and 1% simple interest at research time
  (`docs/mezo-notes.md`, live reads). Deed adds nothing to those.

## Who pays

| Event | Who pays the Deed fee | Taken from |
| --- | --- | --- |
| Fixed price sale | the seller | the sale price, the buyer pays the listed price and no more |
| Rescue auction win | the previous owner (the seller of the position) | the winning price. The winner pays the price and adds BTC, with no extra charge |
| Open, list, cancel, top up, claim | nobody | no fee |

The buyer's cost is exactly the listed or current auction price. A fee never makes a purchase cost more than the price on
screen, and a `maxPrice` check still protects against a relist at a higher price.

## Per-event numbers

From the v3 run in `docs/demo.md`. These fees were actually charged and claimed.

| Event | Price | Fee (0.5%) | Seller receives |
| --- | --- | --- | --- |
| Market sale | 100 MUSD | 0.5 MUSD | 99.5 MUSD |
| Rescue win (Deed #2) | 538.022 MUSD | 2.690 MUSD | 535.332 MUSD |

At the 1% cap the same events would pay 1.00 and 5.38 MUSD (arithmetic, not charged).

## Testnet activity from the team's test wallets

This is not usage and it is not revenue. Both wallets that have touched the contracts are ours (2 unique wallets in the indexer),
and the treasury is the deployer wallet, so the fees below moved between our own wallets. Indexer `/stats`, all deployments
together, at the start of the 13 Nov 2026 pass (`docs/ui-pass-v3.md`): 4 sales, 4 rescues, volume 3126.730579642058144555 MUSD,
fees 6.187563853191175201 MUSD (v2 had no fee, so the fees are v3's). A later chain scan in the same pass read volume 3226.73
and fees 6.6876. Real users, volume and revenue: TODO, there are none yet.

## Volume scenarios (arithmetic on assumed volume)

Monthly volume is an **assumption**, not data, and none of it is a forecast.

| Monthly volume sold through Deed | Fee at 0.25% | Fee at 0.5% (deployed) | Fee at the 1% cap |
| --- | --- | --- | --- |
| 100,000 MUSD | 250 MUSD | 500 MUSD | 1,000 MUSD |
| 1,000,000 MUSD | 2,500 MUSD | 5,000 MUSD | 10,000 MUSD |
| 10,000,000 MUSD | 25,000 MUSD | 50,000 MUSD | 100,000 MUSD |

Sanity bound for testnet only: at research time SortedTroves held 297 troves (`docs/mezo-notes.md`) and `minNetDebt` is
1,800 MUSD, so testnet debt is at least 534,600 MUSD (297 x 1,800, arithmetic). Testnet volume says nothing about mainnet.
TODO: mainnet MUSD trove count and debt, from a source.

## Why fees stay capped and immutable

- The product is a market for other people's collateral. A seller or buyer who has to trust an owner not to raise the fee
  will not hold a position through a listing. A constructor-only fee they can read on chain removes that question.
- The cap is in the contract, so even the deployer cannot ship a version above 1%. It is checked in the constructor and
  anyone can read `MAX_FEE_BPS` and `feeBps`.
- It matches the rest of the design: no owner, no pause, no upgrade ([docs/security.md](security.md)). A fee admin would be
  the only privileged role left.
- The cost of immutability: a bad rate cannot be fixed on that deployment. The answer is a new deployment. `DeedNFT.init`
  registers the venues once, so a new market means a new set of contracts and existing positions do not move over. The fee
  value is therefore picked conservatively.
- Rescue fees are bounded for a second reason: the auction floor is at least 80% of equity, and the seller already pays up to
  20% for being rescued. A fee on top should stay small compared with that.

## Later revenue: premium data API

The indexer (`indexer/`, live on testnet) holds every position, listing, auction and fee event. The on-chain contracts stay free to
read. A paid tier on the API would sell what is expensive to compute, not access to the chain:

- historical ICR and equity curves per position, and a risk score for positions close to the rescue line
- alerts when a position crosses a threshold (for rescuers and keepers)
- bulk exports and higher rate limits for builders and analysts

Free tier: current listings and auctions. Pricing and customers: **TODO**. The paid tier is not built and no user has been asked.
This is later revenue and not part of the on-chain design, and the protocol fee does not depend on it.

## What is not decided

- Who controls the treasury key on mainnet. A multisig is planned, TODO: signers and setup.
- Whether 0.5% is the right mainnet rate. It is a testnet choice and is fixed on this deployment.
- API pricing and customers. TODO. The indexer API is live today (`indexer/README.md`).
