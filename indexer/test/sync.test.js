import test from 'node:test'
import assert from 'node:assert/strict'
import { memoryDb, migrate } from '../src/db.js'
import { syncSource } from '../src/sync.js'
import { getCursor } from '../src/store.js'
import { routes } from '../src/api.js'
import { A, abis, src, fakeChain, E18 } from './helpers.js'

async function setup(head = 130) {
  const db = await memoryDb()
  await migrate(db)
  const chain = fakeChain(head)
  const ctx = { db, client: chain.client, batchBlocks: 7, confirmations: 0, log: () => {} }
  return { db, chain, ctx }
}
const n = async (db, sql) => Number((await db.query(sql)).rows[0].c)

// a small history: alice opens #1, lists it, bob buys; carol opens #2 and it is rescued by bob
function history(chain) {
  const f = { abi: abis.DeedFactory, address: A.factory }
  const m = { abi: abis.DeedMarket, address: A.market }
  const r = { abi: abis.RescueAuction, address: A.auction }
  const v = { abi: abis.PositionVault, address: A.vault1 }
  chain.add({ ...f, eventName: 'PositionCreated', block: 105, args: { tokenId: 1n, vault: A.vault1, owner: A.alice, collateral: 4n * E18, debt: 1800n * E18 } })
  chain.add({ ...v, eventName: 'CollateralAdded', block: 106, args: { amount: E18 } })
  chain.add({ ...m, eventName: 'Listed', block: 110, args: { tokenId: 1n, seller: A.alice, price: 2000n * E18, expiry: 4_000_000_000n, minICR: 13n * E18 / 10n, snapshot: '0x' + '22'.repeat(32) } })
  chain.add({ ...m, eventName: 'Sold', block: 112, logIndex: 1, args: { tokenId: 1n, seller: A.alice, buyer: A.bob, price: 2000n * E18 } })
  chain.add({ abi: abis.DeedNFT, address: A.nft, eventName: 'Transfer', block: 112, logIndex: 0, args: { from: A.alice, to: A.bob, tokenId: 1n } })
  chain.add({ ...f, eventName: 'PositionCreated', block: 120, args: { tokenId: 2n, vault: '0x00000000000000000000000000000000000000a2', owner: A.carol, collateral: 3n * E18, debt: 1800n * E18 } })
  chain.add({ ...r, eventName: 'Started', block: 122, args: { tokenId: 2n, seller: A.carol, byOwner: false, startPrice: 500n * E18, floorPrice: 400n * E18, duration: 21600n } })
  chain.add({ ...r, eventName: 'Won', block: 124, args: { tokenId: 2n, seller: A.carol, winner: A.bob, price: 450n * E18, topUp: E18 } })
}

test('indexes a history and derives positions, listings, auctions and stats from events only', async () => {
  const { db, chain, ctx } = await setup()
  history(chain)
  await syncSource(ctx, src())
  const api = routes(db)

  const s = await api.stats()
  assert.equal(s.positions, 2)
  assert.equal(s.sales, 1)
  assert.equal(s.rescues, 1)
  assert.equal(s.volume_musd_wei, (2450n * E18).toString())
  assert.equal(s.fees_musd_wei, '0')
  assert.equal(s.unique_wallets, 3) // alice, bob, carol: no vault, no contract, no zero address
  assert.equal(s.indexed_to[0].block, 130)

  const l = await api.listings({ status: 'sold' })
  assert.equal(l.items.length, 1)
  assert.equal(l.items[0].buyer, A.bob)
  assert.equal((await api.listings({})).items.length, 0) // none active

  const au = await api.auctions({ status: 'won' })
  assert.equal(au.items[0].winner, A.bob)
  assert.equal(au.items[0].final_price, (450n * E18).toString())

  const p1 = await api.position('v2-1')
  assert.equal(p1.owner, A.bob) // last Transfer
  assert.equal(p1.collateral, (5n * E18).toString()) // 4 opened + 1 added
  assert.equal(p1.status, 'held')
  assert.ok(p1.history.length >= 4)
  assert.equal((await api.positions({ owner: A.bob })).total, 1)
})

test('syncing the same range twice, or restarting from an old cursor, adds no rows', async () => {
  const { db, chain, ctx } = await setup()
  history(chain)
  await syncSource(ctx, src())
  const before = [await n(db, 'select count(*) c from events'), await n(db, 'select count(*) c from event_wallets')]
  await syncSource(ctx, src())
  // simulate a crash that lost the cursor: replay everything from the start block
  await db.query("delete from sync_state where version = 'v2'")
  await db.query("delete from blocks where version = 'v2'")
  await syncSource(ctx, src())
  assert.deepEqual([await n(db, 'select count(*) c from events'), await n(db, 'select count(*) c from event_wallets')], before)
  assert.equal(before[0], 8)
  assert.equal((await routes(db).stats()).volume_musd_wei, (2450n * E18).toString())
})

test('batch size does not change the result', async () => {
  const a = await setup()
  const b = await setup()
  history(a.chain); history(b.chain)
  a.ctx.batchBlocks = 3
  b.ctx.batchBlocks = 500
  await syncSource(a.ctx, src())
  await syncSource(b.ctx, src())
  const q = 'select tx_hash, log_index, name, args from events order by block_number, log_index'
  assert.deepEqual((await a.db.query(q)).rows, (await b.db.query(q)).rows)
})

test('a reorg removes orphaned events and indexes the replacement, with no duplicates', async () => {
  const { db, chain, ctx } = await setup(115)
  history(chain)
  await syncSource(ctx, src())
  assert.equal(await n(db, "select count(*) c from events where name = 'Sold'"), 1)

  // chain forks at 111: the Sold in block 112 disappears and a Cancelled lands in 113 instead
  chain.logs = chain.logs.filter((x) => x.block !== 112)
  chain.forkFrom(111)
  chain.add({ abi: abis.DeedMarket, address: A.market, eventName: 'Cancelled', block: 113, args: { tokenId: 1n, by: A.alice } })
  chain.head = 118
  await syncSource(ctx, src())

  assert.equal(await n(db, "select count(*) c from events where name = 'Sold'"), 0)
  assert.equal(await n(db, "select count(*) c from events where name = 'Cancelled'"), 1)
  assert.equal(await n(db, "select count(*) c from events where name = 'Transfer'"), 0)
  assert.equal((await routes(db).stats()).volume_musd_wei, '0')
  const cur = await getCursor(db, 'v2')
  assert.equal(cur.block, 118)
  assert.equal(cur.hash, chain.blockHash(118))
  // still idempotent afterwards
  await syncSource(ctx, src())
  assert.equal(await n(db, "select count(*) c from events where name = 'Cancelled'"), 1)
  const l = await routes(db).listings({ status: 'cancelled' })
  assert.equal(l.items.length, 1)
})

test('vault events created in the same batch as the vault are picked up', async () => {
  const { db, chain, ctx } = await setup()
  ctx.batchBlocks = 500
  history(chain)
  await syncSource(ctx, src())
  assert.equal(await n(db, "select count(*) c from events where contract = 'PositionVault'"), 1)
})
