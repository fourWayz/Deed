# Business model

Status: **design, not deployed.** The Wave 1 contracts on testnet have no fee. The fee below exists only as uncommitted code
on the `feat/contracts-v3` branch (`DeedMarket.sol`, `RescueAuction.sol`). Every figure marked TODO needs a deployment or
a running indexer before it can be quoted as fact. Figures marked "arithmetic" are plain math on the stated inputs, not
measurements.

## Fee design

- One fee, one place per venue: a fixed share of the **sale price** on `DeedMarket.buy`, and of the **winning price** on
  `RescueAuction.bid`. Nothing is charged for opening a position, holding one, listing, cancelling, or topping up.
- The share is `feeBps`, set once in the constructor, with a hard ceiling `MAX_FEE_BPS = 100` (1%) enforced in the
  constructor. A deploy with a higher value reverts.
- The treasury address is a constructor value too. Both are `immutable`: no owner, no setter, no pause, no upgrade.
- Math: `fee = price * feeBps / 10_000`, rounded down. The seller is credited `price - fee` and the treasury is credited `fee`,
  so the two always add up to the price. Both are pulled with `claim()`, like all other payouts.
- Deployed value of `feeBps`: **TODO** (chosen at deploy, not yet deployed). Treasury address: **TODO**.
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

## Per-event numbers (arithmetic)

Sizes come from the live run in `docs/demo.md`. The fee on those runs was zero, because the Wave 1 contracts have none.

| Event in the run | Price | Fee at the 1% cap | Fee at 0.5% | Seller keeps at the cap |
| --- | --- | --- | --- | --- |
| Market sale (Deed #1) | 100 MUSD | 1.00 MUSD | 0.50 MUSD | 99.00 MUSD |
| Rescue win (Deed #2) | 539.48 MUSD | 5.39 MUSD | 2.70 MUSD | 534.09 MUSD |

0.5% is an example rate, not a chosen one.

## Volume scenarios (arithmetic on assumed volume)

Monthly volume is an **assumption**, not data. TODO: replace with indexer figures once it runs.

| Monthly volume sold through Deed | Fee at 0.25% | Fee at 0.5% | Fee at the 1% cap |
| --- | --- | --- | --- |
| 100,000 MUSD | 250 MUSD | 500 MUSD | 1,000 MUSD |
| 1,000,000 MUSD | 2,500 MUSD | 5,000 MUSD | 10,000 MUSD |
| 10,000,000 MUSD | 25,000 MUSD | 50,000 MUSD | 100,000 MUSD |

Sanity bound for testnet only: at research time SortedTroves held 297 troves (`docs/mezo-notes.md`) and `minNetDebt` is
1,800 MUSD, so testnet debt is at least 534,600 MUSD (297 x 1,800, arithmetic). Testnet volume tells you nothing about
mainnet revenue, so none of these rows is a forecast. TODO: mainnet MUSD trove count and debt, from a source.

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

The indexer (`feat/indexer`) will hold every position, listing, auction and fee event. The on-chain contracts stay free to
read. A paid tier on the API would sell what is expensive to compute, not access to the chain:

- historical ICR and equity curves per position, and a risk score for positions close to the rescue line
- alerts when a position crosses a threshold (for rescuers and keepers)
- bulk exports and higher rate limits for builders and analysts

Free tier: current listings and auctions. Pricing and customers: **TODO**, nothing is built and no user has been asked.
This is later revenue and not part of the on-chain design, and the protocol fee does not depend on it.

## What is not decided

- `feeBps` and the treasury address. TODO.
- Who controls the treasury key (single key, multisig). TODO.
- Whether the fee applies on the testnet deployment at all. TODO.
- API pricing. TODO.
