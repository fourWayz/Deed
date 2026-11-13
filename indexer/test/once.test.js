import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { memoryDb, migrate } from '../src/db.js'
import { runOnce, syncSource } from '../src/sync.js'
import { getCursor } from '../src/store.js'
import { routes } from '../src/api.js'
import { src, fakeChain, abis, A, E18 } from './helpers.js'

const quiet = () => {}
async function seeded() {
  const db = await memoryDb()
  await migrate(db)
  const chain = fakeChain(130)
  chain.add({ abi: abis.DeedFactory, address: A.factory, eventName: 'PositionCreated', block: 105, args: { tokenId: 1n, vault: A.vault1, owner: A.alice, collateral: 4n * E18, debt: 1800n * E18 } })
  return { db, chain, ctx: { db, client: chain.client, batchBlocks: 50, confirmations: 0, log: quiet } }
}

test('once resumes from the stored cursor and makes no log calls when nothing is new', async () => {
  const { db, chain, ctx } = await seeded()
  await runOnce(ctx, [src()])
  assert.equal((await getCursor(db, 'v2')).block, 130)
  let calls = 0
  const counting = { ...chain.client, getLogs: async (a) => { calls++; return chain.client.getLogs(a) } }
  await runOnce({ ...ctx, client: counting }, [src()])
  assert.equal(calls, 0, 'caught up: no eth_getLogs at all')
  // two new blocks arrive: only those are read
  chain.head = 132
  const ranges = []
  const spy = { ...chain.client, getLogs: async (a) => { ranges.push([a.fromBlock, a.toBlock]); return chain.client.getLogs(a) } }
  await runOnce({ ...ctx, client: spy }, [src()])
  // one call for the four contracts and one for the known vault, both only over the new blocks
  assert.ok(ranges.length >= 1 && ranges.length <= 2)
  for (const r of ranges) assert.deepEqual(r, [131, 132])
})

test('a pass that finds nothing still moves lastSyncedAt', async () => {
  const { db, ctx } = await seeded()
  await runOnce(ctx, [src()])
  const first = (await routes(db).stats()).lastSyncedAt
  await new Promise((r) => setTimeout(r, 1100))
  await runOnce(ctx, [src()])
  const second = (await routes(db).stats()).lastSyncedAt
  assert.ok(new Date(second) > new Date(first), `${second} should be after ${first}`)
})

test('once throws on an RPC error, but still tries the other deployments', async () => {
  const { db, chain, ctx } = await seeded()
  const other = { ...src(), version: 'v3' }
  let boom = true
  const flaky = { ...chain.client, getBlockNumber: async () => { if (boom) { boom = false; throw new Error('rpc down') } return chain.head } }
  await assert.rejects(() => runOnce({ ...ctx, client: flaky }, [src(), other]), /v2: rpc down/)
  assert.equal((await getCursor(db, 'v3')).block, 130, 'second deployment still synced')
})

test('once fails when no deployment is configured', async () => {
  const { ctx } = await seeded()
  await assert.rejects(() => runOnce(ctx, []), /no deployment/)
})

test('migrations are recorded and not re-run', async () => {
  const db = await memoryDb()
  await migrate(db)
  const n = (await db.query('select count(*)::int c from schema_migrations')).rows[0].c
  assert.equal(n, 1)
  await db.query('drop view v_positions') // a second migrate must not recreate it, proving the file was skipped
  await migrate(db)
  await assert.rejects(() => db.query('select 1 from v_positions'))
})

test('cli: sync --once exits 1 quickly when the database is unreachable, and 1 without DATABASE_URL', () => {
  const env = { ...process.env, DATABASE_URL: 'postgres://u:p@127.0.0.1:1/db', MEZO_TESTNET_RPC: 'http://127.0.0.1:1' }
  const t = Date.now()
  const r = spawnSync('node', ['src/cli.js', 'sync', '--once'], { env, encoding: 'utf8', timeout: 30_000 })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /migrate failed/)
  assert.ok(Date.now() - t < 20_000)
  const { DATABASE_URL, ...rest } = process.env
  const r2 = spawnSync('node', ['src/cli.js', 'sync', '--once'], { env: rest, encoding: 'utf8', timeout: 30_000 })
  assert.equal(r2.status, 1)
  assert.match(r2.stderr, /DATABASE_URL is not set/)
})

test('workflow file: schedule, manual trigger, no overlap, 20 minute limit, secrets from GitHub, runs npm run once', () => {
  const y = readFileSync(new URL('../../.github/workflows/indexer-sync.yml', import.meta.url), 'utf8')
  assert.match(y, /cron: "\*\/5 \* \* \* \*"/)
  assert.match(y, /workflow_dispatch:/)
  assert.match(y, /concurrency:\n  group: indexer-sync\n  cancel-in-progress: false/)
  assert.match(y, /timeout-minutes: 20/)
  assert.match(y, /working-directory: indexer/)
  assert.match(y, /npm ci/)
  assert.match(y, /run: npm run once/)
  assert.match(y, /DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/)
  assert.match(y, /MEZO_TESTNET_RPC: \$\{\{ secrets\.MEZO_TESTNET_RPC \}\}/)
  assert.doesNotMatch(y, /continue-on-error/)
  assert.doesNotMatch(y, /postgres(ql)?:\/\//, 'no connection string in the file')
})
