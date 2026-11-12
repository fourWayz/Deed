import test from 'node:test'
import assert from 'node:assert/strict'
import { makeDecoder } from '../src/decode.js'
import { loadAbi, loadDeployments, sourceFor } from '../src/config.js'
import { memoryDb, migrate } from '../src/db.js'
import { syncSource } from '../src/sync.js'
import { routes } from '../src/api.js'
import { A, rawLog, E18, fakeChain } from './helpers.js'

const v3 = (n) => loadAbi('v3', n)
const H = '0x' + 'cd'.repeat(32)

test('v3 deployment comes from the root deployments.json and every abi is present', () => {
  const dep = loadDeployments().find((d) => d.version === 'v3')
  const src = sourceFor(dep)
  assert.deepEqual(src.missing, [])
  assert.equal(src.watched.length, 4)
  assert.ok(dep.startBlock > 16_000_000)
  assert.ok(src.vaultAbi)
})

test('v3 Sold and Won carry a fee: price is gross, fee is the treasury share', () => {
  const dec = makeDecoder([
    { contract: 'DeedMarket', address: A.market, abi: v3('DeedMarket') },
    { contract: 'RescueAuction', address: A.auction, abi: v3('RescueAuction') },
  ])
  const sold = dec.decode(rawLog({ hash: H, block: 9, abi: v3('DeedMarket'), address: A.market, eventName: 'Sold',
    args: { tokenId: 1n, seller: A.alice, buyer: A.bob, price: 1000n * E18, fee: 5n * E18 } }), 31611, 'v3', new Date())
  assert.equal(sold.row.volume, (1000n * E18).toString())
  assert.equal(sold.row.fee, (5n * E18).toString())
  const won = dec.decode(rawLog({ hash: H, block: 9, abi: v3('RescueAuction'), address: A.auction, eventName: 'Won',
    args: { tokenId: 2n, seller: A.alice, winner: A.carol, price: 400n * E18, fee: 2n * E18, topUp: E18 } }), 31611, 'v3', new Date())
  assert.equal(won.row.volume, (400n * E18).toString())
  assert.equal(won.row.fee, (2n * E18).toString())
})

test('v3 stats add fees and borrowed debt, v2 and v3 stay separate by version', async () => {
  const db = await memoryDb()
  await migrate(db)
  const chain = fakeChain(120)
  const src = {
    version: 'v3', startBlock: 100,
    watched: [
      { contract: 'DeedNFT', address: A.nft, abi: v3('DeedNFT') },
      { contract: 'DeedFactory', address: A.factory, abi: v3('DeedFactory') },
      { contract: 'DeedMarket', address: A.market, abi: v3('DeedMarket') },
      { contract: 'RescueAuction', address: A.auction, abi: v3('RescueAuction') },
    ],
    vaultAbi: v3('PositionVault'),
  }
  chain.add({ abi: v3('DeedFactory'), address: A.factory, eventName: 'PositionCreated', block: 105, args: { tokenId: 1n, vault: A.vault1, owner: A.alice, collateral: 4n * E18, debt: 1800n * E18 } })
  chain.add({ abi: v3('PositionVault'), address: A.vault1, eventName: 'Borrowed', block: 106, args: { amount: 100n * E18 } })
  chain.add({ abi: v3('PositionVault'), address: A.vault1, eventName: 'Refinanced', block: 107, args: { oldRate: 100, newRate: 50 } })
  chain.add({ abi: v3('DeedMarket'), address: A.market, eventName: 'Sold', block: 110, args: { tokenId: 1n, seller: A.alice, buyer: A.bob, price: 1000n * E18, fee: 5n * E18 } })
  await syncSource({ db, client: chain.client, batchBlocks: 50, confirmations: 0, log: () => {} }, src)
  const api = routes(db)
  const s = await api.stats()
  assert.equal(s.fees_musd_wei, (5n * E18).toString())
  assert.equal(s.volume_musd_wei, (1000n * E18).toString())
  assert.equal(s.unique_wallets, 2)
  const p = await api.position('v3-1')
  assert.equal(p.debt_principal, (1900n * E18).toString())
  assert.ok(p.history.some((e) => e.name === 'Refinanced'))
})
