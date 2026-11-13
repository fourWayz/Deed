import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { memoryDb, migrate } from '../src/db.js'
import { syncSource } from '../src/sync.js'
import { handler } from '../src/api.js'
import { src, fakeChain, abis, A, E18 } from './helpers.js'

async function boot(opts) {
  const db = await memoryDb()
  await migrate(db)
  const chain = fakeChain(130)
  const f = { abi: abis.DeedFactory, address: A.factory }
  chain.add({ ...f, eventName: 'PositionCreated', block: 105, args: { tokenId: 1n, vault: A.vault1, owner: A.alice, collateral: 4n * E18, debt: 1800n * E18 } })
  chain.add({ abi: abis.DeedNFT, address: A.nft, eventName: 'Transfer', block: 105, logIndex: 1, args: { from: '0x0000000000000000000000000000000000000000', to: A.alice, tokenId: 1n } })
  chain.add({ abi: abis.DeedMarket, address: A.market, eventName: 'Listed', block: 110, args: { tokenId: 1n, seller: A.alice, price: 9n * E18, expiry: 4_000_000_000n, minICR: E18, snapshot: '0x' + '33'.repeat(32) } })
  chain.add({ abi: abis.RescueAuction, address: A.auction, eventName: 'Started', block: 111, args: { tokenId: 1n, seller: A.alice, byOwner: true, startPrice: 5n * E18, floorPrice: 4n * E18, duration: 21600n } })
  await syncSource({ db, client: chain.client, batchBlocks: 50, confirmations: 0, log: () => {} }, src())
  const server = http.createServer(handler(db, opts))
  await new Promise((r) => server.listen(0, r))
  const base = `http://127.0.0.1:${server.address().port}`
  return { base, close: () => server.close() }
}
const get = async (base, path, init) => {
  const res = await fetch(base + path, init)
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) }
}

test('every route answers with the expected shape, and CORS is open for GET', async () => {
  const { base, close } = await boot()
  try {
    const h = await get(base, '/health')
    assert.equal(h.status, 200)
    const p = await get(base, '/positions')
    assert.equal(p.status, 200)
    assert.equal(p.headers.get('access-control-allow-origin'), '*')
    assert.equal(p.body.total, 1)
    assert.equal(p.body.items[0].status, 'auction') // auction is open
    assert.equal((await get(base, `/positions?owner=${A.alice}`)).body.total, 1)
    assert.equal((await get(base, '/positions/v2-1')).body.vault, A.vault1)
    assert.equal((await get(base, '/positions/1')).status, 200)
    assert.equal((await get(base, '/positions/v2-99')).status, 404)
    assert.equal((await get(base, '/positions/nope')).status, 400)
    assert.equal((await get(base, '/listings')).body.items.length, 1)
    assert.equal((await get(base, '/auctions')).body.items.length, 1)
    assert.ok((await get(base, '/activity')).body.items.length >= 3)
    assert.equal((await get(base, `/activity?wallet=${A.alice}`)).status, 200)
    assert.equal((await get(base, '/stats')).body.positions, 1)
    assert.equal((await get(base, '/positions?status=bogus')).status, 400)
    assert.equal((await get(base, '/positions?owner=zzz')).status, 400)
    assert.equal((await get(base, '/nothing')).status, 404)
    assert.equal((await get(base, '/stats', { method: 'POST' })).status, 405)
    const pre = await get(base, '/stats', { method: 'OPTIONS' })
    assert.equal(pre.status, 204)
    assert.equal(pre.headers.get('access-control-allow-methods'), 'GET, OPTIONS')
  } finally { close() }
})

test('rate limit returns 429 with retry-after, and /health is exempt', async () => {
  const { base, close } = await boot({ perMinute: 5 })
  try {
    const codes = []
    for (let i = 0; i < 8; i++) codes.push((await get(base, '/stats')).status)
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429, 429])
    const r = await get(base, '/stats')
    assert.ok(Number(r.headers.get('retry-after')) >= 1)
    assert.equal((await get(base, '/health')).status, 200)
    // a different client (fly-client-ip) has its own budget
    assert.equal((await get(base, '/stats', { headers: { 'fly-client-ip': '203.0.113.9' } })).status, 200)
  } finally { close() }
})
