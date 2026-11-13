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

## Deployment (no card needed)

Two pieces, both free-tier friendly: a **GitHub Actions cron** keeps the database current, and a **Vercel project** serves
the read API from it. The database is the only shared state, so either side can restart or redeploy freely.

### 1. Supabase
Create a project and use its **transaction pooler** URI (port **6543**). That is the `DATABASE_URL` for everything below.
`npm run migrate` (or the first sync) creates the schema; there is no Supabase-specific setup. Row level security is off
because the API connects directly with the connection string; do not expose these tables through Supabase's own REST layer
without enabling it. TLS and port details are under "Supabase notes".

### 2. Sync: `.github/workflows/indexer-sync.yml`
Runs `npm run once` in `indexer/` every 5 minutes and on **Run workflow**. One run at a time (`concurrency` group
`indexer-sync`, queued, never cancelled), 20 minute timeout. `once` resumes from the stored cursor, reads only blocks newer
than it, touches the cursor so `lastSyncedAt` moves even when nothing is new, and **exits 1 on any RPC or database
error** so the run turns red. A pass with nothing new made no `eth_getLogs` call in the tests; against Supabase it took
about 26 s, almost all of it database round trips. The very first sync from empty takes about 7 minutes, inside the
timeout.

GitHub repository secrets (Settings, Secrets and variables, Actions, **Repository secrets**), exact names:

| Secret | Value |
| --- | --- |
| `DATABASE_URL` | Supabase transaction pooler URI, port 6543 |
| `MEZO_TESTNET_RPC` | `https://rpc.test.mezo.org` |

GitHub can delay scheduled runs and disables them after 60 days without repository activity; a missed run is simply caught
up by the next one.

### 3. API: Vercel project with root directory `indexer/`
`api/index.js` is one serverless function and `vercel.json` rewrites `/positions`, `/positions/:id`, `/listings`,
`/auctions`, `/activity`, `/stats` and `/health` to it, so the public paths are the ones in the API section below. It reuses
the same query code as the standalone server, keeps a pool of **one** connection per warm instance, answers `GET` and
`OPTIONS` with `access-control-allow-origin: *`, and sets `Cache-Control: public, s-maxage=15, stale-while-revalidate=60` on
successful responses (errors and `/health` are `no-store`). There is no in-memory rate limit there: the CDN cache absorbs
repeat requests.

Vercel settings: Root Directory `indexer`, Framework Preset `Other`, no build command. Environment variable (Production and
Preview): `DATABASE_URL`, the same transaction pooler URI. The function never runs migrations, so the sync job must have
run at least once before the API returns data.

`/stats` and `/health` carry `lastSyncedAt`, the time of the last finished sync pass (`null` before the first).

### 4. Optional: one long-running process
`npm run start` runs the API and the sync loop together with the in-memory rate limit (`RATE_LIMIT_PER_MIN`, default 120
per client, then `429` with `Retry-After`; `/health` exempt; client is `fly-client-ip` if present, else the socket address,
and `x-forwarded-for` is ignored because a client can forge it). The Dockerfile is `docker/indexer.Dockerfile` at the repo root, deliberately **outside** `indexer/`: Vercel auto-builds a
`Dockerfile` it finds in a project's root directory, which broke the first deploy. Build from the repo root with
`docker build -f docker/indexer.Dockerfile -t deed-indexer .`, run with `docker run -p 8787:8787 -e DATABASE_URL deed-indexer`. It was
built and run locally with Docker (image about 441 MB) against Supabase on 2026-11-13: `/health` and `/stats` answered
from the database and the sync loop resumed one block after the stored cursor. Run only one syncing process per database
if you use this path next to the GitHub job; extra ones only waste RPC calls, because inserts are idempotent.

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

## Supabase notes (tested 2026-11-13)

- **TLS.** The connection uses TLS with certificate verification **off** (`rejectUnauthorized: false` in `src/db.js`).
  With verification on, Supabase's pooler fails with `SELF_SIGNED_CERT_IN_CHAIN` because its chain is not in Node's trust
  store. Traffic is still encrypted, but the server's identity is not checked. To verify, download the project's CA
  certificate from the Supabase dashboard and pass it as the `ca` option.
- **Port.** The session pooler URI uses port 5432. From the dev machine that port accepted TCP but never answered the
  Postgres handshake (no reply to an SSLRequest in 10 s), while the transaction pooler on 6543 on the same host answered at
  once. All local Supabase tests used 6543, with the port swapped in memory only. The code works on either mode: every
  write is one explicit transaction on one checked-out connection, and no named prepared statements are used. If 5432 times
  out from your host, use 6543.
- **Results.** Migration took about 8 s, and the full sync of v2 and v3 from empty took about 6m50s (round trips to the remote
  database dominate). Every route answered over HTTP, and `/stats` matched `scripts/chain-scan.mjs` on all eight fields
  (7 positions, 12 listings, 4 sales, 5 auctions started, 4 rescues, 2 wallets, volume `3126730579642058144555`, fees
  `6187563853191175201`).
- **Restart.** After a SIGKILL of the running process, the next run started one block after the stored cursor. Rewinding the
  v3 cursor and replaying 54 stored events left the table at 139 events, 76 wallet rows and 0 duplicate keys.
- Migrations are recorded in `schema_migrations`, so only the first start pays the schema cost (about 8 s over this link). A start that finds nothing new takes seconds.
