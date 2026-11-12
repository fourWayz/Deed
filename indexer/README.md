# Deed indexer

Reads Deed events from Mezo testnet (chain 31611), stores them in Postgres (Supabase) and serves them over a small
read-only REST API. Nothing is seeded: every row in the database is a decoded log, and every number in `/stats` is
computed from those rows.

## What it indexes

| Deployment | Source of addresses and start block | ABIs |
| --- | --- | --- |
| `v2` | `config/deployments.json`, from first deploy block `16339552` | `abis/v2/` (event-only, written from the source) |
| `v3` | the repo-root `deployments.json` (`deployBlock`, `deedNFT`, `factory`, `market`, `auction`) | `abis/v3/`, copies of the compiled root `abis/` |

Each deployment has its own cursor. Contracts that emit nothing the API needs (`PairTwapPrice`, `DeedLens`) are not indexed.
Fees: v3 `Sold.fee` and `Won.fee` are the treasury share of the gross `price`, so `fees_musd_wei` sums them and
`volume_musd_wei` sums the gross prices. v2 has no fee.

Per deployment it follows `DeedNFT`, `DeedFactory`, `DeedMarket`, `RescueAuction`, and also every `PositionVault` that
`PositionCreated` announces (the vault events are how collateral and debt move).

The v2 ABIs in `abis/v2/` are event-only and were written from the event declarations in `src/*.sol`
(`forge inspect` did not finish in reasonable time here). A mismatch would show as events silently not decoding, so
check `select name, count(*) from events group by 1` against the explorer after any contract change.

## How it stays correct

- **Idempotent.** `events` has primary key `(chain_id, tx_hash, log_index)` and every insert is `on conflict do nothing`.
  Replaying a range, restarting, or losing the cursor adds no rows. Rows and cursor move in one transaction.
- **Reorgs.** The cursor stores a block hash. On every pass the indexer re-checks that hash against the chain. If it
  differs it walks back through the stored block hashes to the last block the chain still agrees with, deletes every event
  after it and re-reads. A reorg that happens while a batch is being read is caught by comparing each log's `blockHash`
  with the block header, and the batch is retried. `CONFIRMATIONS` (default 1) keeps it off the very tip.
- **Views, not copies.** `v_positions`, `v_listings` and `v_auctions` are SQL views over `events`, so a rollback cannot leave
  derived state behind.
- **Mezo RPC limit.** `eth_getLogs` rejects ranges over 10,000 blocks, so batches are capped at that (`BATCH_BLOCKS`,
  default 9000).

## Run it

```bash
cd indexer
cp .env.example .env        # fill DATABASE_URL
npm install
set -a; . ./.env; set +a
npm run migrate             # creates tables and views, safe to repeat
npm run start               # API + sync loop in one process
```

Other modes: `npm run once` (catch up to the head and exit, for a cron job), `npm run sync` (sync loop only),
`npm run serve` (API only, for a second instance next to a separate sync worker).

## Deployment

1. **Supabase.** Create a project, copy the connection string (Project settings, Database, Connection string, session
   pooler) into `DATABASE_URL`. The schema is created by `npm run migrate`; there is no Supabase-specific setup. Row level
   security is not enabled because the API talks to Postgres directly with the connection string. If you expose the
   tables through Supabase's own REST layer, enable RLS first.
2. **Long-running service** (Fly, Railway, Render, a VM): run `npm run start` with `DATABASE_URL`, `PORT` set. One
   process serves the API and keeps syncing. Run exactly one syncing process per database; two would only waste RPC
   calls (rows stay correct, because inserts are idempotent).
3. **Or a scheduled job** (cron, GitHub Actions, Railway cron): run `npm run once` every minute or so, and run
   `npm run serve` as the API.
4. First sync of v2 reads about 400k blocks in 9000-block batches. Expect a few minutes.

Environment: `DATABASE_URL` (required), `MEZO_TESTNET_RPC`, `PORT` (8787), `BATCH_BLOCKS` (9000, max 10000),
`POLL_MS` (4000), `CONFIRMATIONS` (1). Secrets stay in `.env`, which is git-ignored.

## API

JSON, GET only, CORS open. Numbers that can exceed 2^53 (token ids, amounts) are decimal **strings**. MUSD amounts are
in wei (18 decimals). Addresses are lowercase. `limit` defaults to 50, max 200; `offset` pages the list endpoints.

A position id is `<version>-<tokenId>`, for example `v2-12`. A bare `12` means the newest deployment that has token 12.

### `GET /positions`
Filters: `owner` (address), `status` (`held` | `listed` | `auction` | `closed`), `version`, `limit`, `offset`.
Returns `{ total, limit, offset, items }`, newest first.

```json
{ "id": "v2-3", "version": "v2", "token_id": "3", "vault": "0x...", "creator": "0x...", "owner": "0x...",
  "collateral": "40000000000000000", "debt_principal": "1800000000000000000000",
  "opened_collateral": "...", "opened_debt": "...", "status": "held",
  "created_block": 16345000, "created_tx": "0x...", "created_at": "2026-..." }
```

`owner` is the last ERC-721 `Transfer` recipient. `collateral` and `debt_principal` follow the vault's own events
(deposit, `CollateralAdded`, `Withdrawn`, `Repaid`). They do **not** include interest, borrowing fees, redemptions or
liquidations, which happen inside Mezo and emit nothing from the vault. Treat them as what was put through the vault, and
read `TroveManager` for the live numbers.

### `GET /positions/:id`
The position plus `listings`, `auctions` and `history` (every event for the token and its vault, oldest first). 404 if
unknown.

### `GET /listings`
Filters: `status` (`active` default | `sold` | `cancelled` | `all`), `seller`, `version`. Each item has `price`,
`expiry` (unix seconds), `min_icr`, `snapshot`, `status`, `buyer` and `closed_at` when sold, and `expired` (true when an
active listing is past `expiry` and nobody has cleared it yet).

### `GET /auctions`
Filters: `status` (`open` default | `won` | `ended` | `all`), `version`. Each item has `seller`, `by_owner`, `start_price`,
`floor_price`, `duration`, `started_at`, `ends_at`, `expired`, and for a finished one `winner`, `final_price`, `top_up`.
`ended` means cancelled or ended after expiry without a winner.

### `GET /activity`
Newest first. Filters: `type` (event name, for example `Sold`), `token`, `wallet`, `version`, `before` (block number, for
paging), `limit`. ERC-721 `Transfer` is hidden unless `include=transfers`.

### `GET /stats`

```json
{ "positions": 0, "listings": 0, "sales": 0, "auctions_started": 0, "rescues": 0, "unique_wallets": 0,
  "volume_musd_wei": "0", "fees_musd_wei": "0", "by_version": [], "indexed_to": [] }
```

- `positions`: `PositionCreated` events.
- `volume_musd_wei`: the sum of `DeedMarket.Sold.price` and `RescueAuction.Won.price`. Collateral top-ups and listing
  prices that never sold are not volume.
- `fees_musd_wei`: from fee fields in events. The v2 contracts have no fee (README: no owner, no fee), so this is 0 for v2.
  v3 entries go in `FEE_FIELD` in `src/decode.js` once the v3 ABIs show which event carries one.
- `rescues`: `RescueAuction.Won` events (auctions that found a winner). `auctions_started` counts `Started`.
- `unique_wallets`: distinct addresses that appear as owner, seller, buyer, winner, `by` or ERC-721 `Transfer` party,
  excluding the zero address, vaults and the Deed contracts. Wallets that only called a function with no event of their
  own (for example a bidder whose bid reverted) are not counted.
- `indexed_to`: the cursor per deployment, so a client can tell how fresh the data is.

## Tests

```bash
npm test
```

Runs against an in-process Postgres (`@electric-sql/pglite`), so no database is needed. Covered: decoding each event
type, volume and wallet extraction, replaying a range twice, restarting with a lost cursor, batch size independence, a
reorg that removes a `Sold` and replaces it with a `Cancelled`, and vault events created in the same batch as the vault.
The sync tests use a fake chain, so they show the logic, not the behaviour of Mezo's real RPC.

## Live check

`node scripts/live-smoke.mjs` syncs the real v2 deployment from Mezo testnet into an in-process Postgres and prints the
stats. On 2026-11-12 it indexed 3 positions, 6 listings, 2 sales, 3 auctions and 2 rescues in about 3 minutes, and the owners
of tokens 1 to 3 matched `DeedNFT.ownerOf` on chain. It was not run against a real Supabase database.

## Independent check

`node scripts/chain-scan.mjs` recomputes the stats without the indexer's ABIs, decoder or SQL: it hashes event signatures,
reads raw logs and slices the data words by hand. On 2026-11-12 (blocks to 16740688) it matched the indexer exactly on
positions (6), listings (11), sales (3), auctions started (4), rescues (3), unique wallets (2), volume
(`2527240285832979884033`) and fees (`3190112384145783899`). Sync time from empty: v2 about 280 s, v3 about 7 s.

## Hosting files

`Dockerfile` (build from the repo root: `docker build -f indexer/Dockerfile -t deed-indexer .`) and `fly.toml` (one
always-on machine, `/health` check). Untested: Docker is not usable in the dev environment.
