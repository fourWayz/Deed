import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { handler } from '../src/api.js'
import { memoryDb, migrate } from '../src/db.js'
import { syncSource } from '../src/sync.js'
import { compileRewrites, rewrite, devServer } from '../scripts/dev-vercel.mjs'
import { makeFunction } from '../api/index.js'
import { src, fakeChain, abis, A, E18 } from './helpers.js'

const rules = compileRewrites(JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url))).rewrites)

test('vercel.json rewrites map public paths to the function with route and id', () => {
  assert.equal(rewrite(rules, '/stats'), '/api/index?route=stats')
  assert.equal(rewrite(rules, '/positions'), '/api/index?route=positions')
  assert.equal(rewrite(rules, '/positions?owner=0xabc&limit=2'), '/api/index?route=positions&owner=0xabc&limit=2')
  assert.equal(rewrite(rules, '/positions/v3-12'), '/api/index?route=positions&id=v3-12')
  assert.equal(rewrite(rules, '/'), '/api/index?route=health')
  assert.equal(rewrite(rules, '/secret'), null)
})

// the function body, driven with an in-process database instead of DATABASE_URL
async function bootServerless() {
  const db = await memoryDb()
  await migrate(db)
  const chain = fakeChain(130)
  chain.add({ abi: abis.DeedFactory, address: A.factory, eventName: 'PositionCreated', block: 105, args: { tokenId: 1n, vault: A.vault1, owner: A.alice, collateral: 4n * E18, debt: 1800n * E18 } })
  chain.add({ abi: abis.DeedNFT, address: A.nft, eventName: 'Transfer', block: 105, logIndex: 1, args: { from: '0x0000000000000000000000000000000000000000', to: A.alice, tokenId: 1n } })
  await syncSource({ db, client: chain.client, batchBlocks: 50, confirmations: 0, log: () => {} }, src())
  const server = devServer(makeFunction(() => db)) // the real function body, with the test database injected
  await new Promise((r) => server.listen(0, r))
  return { db, base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }
}
const get = async (base, path, init) => {
  const r = await fetch(base + path, init)
  return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) }
}

test('serverless handler: cache headers, no rate limit, lastSyncedAt on /stats and /health', async () => {
  const { base, close } = await bootServerless()
  try {
    const s = await get(base, '/stats')
    assert.equal(s.status, 200)
    assert.equal(s.headers.get('cache-control'), 'public, s-maxage=15, stale-while-revalidate=60')
    assert.equal(s.headers.get('access-control-allow-origin'), '*')
    assert.match(s.body.lastSyncedAt, /^\d{4}-\d\d-\d\dT/)
    const h = await get(base, '/health')
    assert.equal(h.body.ok, true)
    assert.equal(h.body.lastSyncedAt, s.body.lastSyncedAt)
    assert.equal(h.headers.get('cache-control'), 'no-store')
    // 300 requests, no 429: the CDN cache is the protection here
    for (let i = 0; i < 300; i++) assert.equal((await get(base, '/stats')).status, 200)
    assert.equal((await get(base, '/positions/v2-1')).body.owner, A.alice)
    assert.equal((await get(base, '/positions?owner=' + A.alice)).body.total, 1)
    assert.equal((await get(base, '/positions/v2-99')).status, 404)
    assert.equal((await get(base, '/positions/v2-99')).headers.get('cache-control'), 'no-store')
    assert.equal((await get(base, '/stats', { method: 'OPTIONS' })).status, 204)
  } finally { close() }
})

test('health answers 503 when the database is down', async () => {
  const broken = { query: async () => { throw new Error('boom') } }
  const server = http.createServer(handler(broken, { perMinute: 0 }))
  await new Promise((r) => server.listen(0, r))
  try {
    const r = await get(`http://127.0.0.1:${server.address().port}`, '/health')
    assert.equal(r.status, 503)
    assert.equal(r.body.ok, false)
  } finally { server.close() }
})

test('function module: unset DATABASE_URL gives a 500 that is not cached and leaks nothing', async () => {
  const saved = process.env.DATABASE_URL
  delete process.env.DATABASE_URL
  const { default: fn } = await import('../api/index.js')
  const server = http.createServer(fn)
  await new Promise((r) => server.listen(0, r))
  try {
    const r = await get(`http://127.0.0.1:${server.address().port}`, '/api/index?route=stats')
    assert.equal(r.status, 500)
    assert.equal(r.headers.get('cache-control'), 'no-store')
    assert.deepEqual(r.body, { error: 'server is not configured' })
  } finally { server.close(); if (saved) process.env.DATABASE_URL = saved }
})
