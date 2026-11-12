import test from 'node:test'
import assert from 'node:assert/strict'
import { makeDecoder } from '../src/decode.js'
import { A, abis, rawLog, E18, ZERO } from './helpers.js'

const known = new Set([A.nft, A.factory, A.market, A.auction])
const list = [
  { contract: 'DeedNFT', address: A.nft, abi: abis.DeedNFT },
  { contract: 'DeedFactory', address: A.factory, abi: abis.DeedFactory },
  { contract: 'DeedMarket', address: A.market, abi: abis.DeedMarket },
  { contract: 'RescueAuction', address: A.auction, abi: abis.RescueAuction },
  { contract: 'PositionVault', address: A.vault1, abi: abis.PositionVault },
]
const dec = makeDecoder(list, known)
const H = '0x' + 'ab'.repeat(32)
const T = new Date(1_700_000_000_000)
const go = (spec) => dec.decode(rawLog({ hash: H, block: 5, ...spec }), 31611, 'v2', T)

test('PositionCreated: token, vault, owner and amounts', () => {
  const d = go({ abi: abis.DeedFactory, address: A.factory, eventName: 'PositionCreated',
    args: { tokenId: 7n, vault: A.vault1, owner: A.alice, collateral: 4n * E18, debt: 1800n * E18 } })
  assert.equal(d.row.name, 'PositionCreated')
  assert.equal(d.row.token_id, '7')
  assert.equal(d.row.args.vault, A.vault1)
  assert.equal(d.row.args.owner, A.alice)
  assert.equal(d.row.args.collateral, (4n * E18).toString())
  assert.equal(d.row.volume, '0')
  assert.deepEqual(d.wallets, [{ wallet: A.alice, role: 'owner' }])
})

test('Sold: volume is the price, buyer and seller are wallets', () => {
  const d = go({ abi: abis.DeedMarket, address: A.market, eventName: 'Sold',
    args: { tokenId: 7n, seller: A.alice, buyer: A.bob, price: 2500n * E18 } })
  assert.equal(d.row.volume, (2500n * E18).toString())
  assert.deepEqual(d.wallets.map((w) => w.role).sort(), ['buyer', 'seller'])
})

test('Won: volume is the price paid, topUp is not volume', () => {
  const d = go({ abi: abis.RescueAuction, address: A.auction, eventName: 'Won',
    args: { tokenId: 3n, seller: A.alice, winner: A.carol, price: 900n * E18, topUp: E18 } })
  assert.equal(d.row.volume, (900n * E18).toString())
  assert.equal(d.row.args.topUp, E18.toString())
})

test('Listed keeps expiry, minICR and snapshot', () => {
  const d = go({ abi: abis.DeedMarket, address: A.market, eventName: 'Listed',
    args: { tokenId: 1n, seller: A.alice, price: 10n * E18, expiry: 1_800_000_000n, minICR: 13n * E18 / 10n, snapshot: '0x' + '11'.repeat(32) } })
  assert.equal(d.row.args.expiry, '1800000000')
  assert.equal(d.row.args.snapshot, '0x' + '11'.repeat(32))
  assert.equal(d.row.volume, '0')
})

test('mint and contract addresses are not counted as wallets', () => {
  const mint = go({ abi: abis.DeedNFT, address: A.nft, eventName: 'Transfer', args: { from: ZERO, to: A.alice, tokenId: 1n } })
  assert.deepEqual(mint.wallets, [{ wallet: A.alice, role: 'to' }])
  const toMarket = go({ abi: abis.DeedNFT, address: A.nft, eventName: 'Transfer', args: { from: A.alice, to: A.market, tokenId: 1n } })
  assert.deepEqual(toMarket.wallets, [{ wallet: A.alice, role: 'from' }])
})

test('vault events decode by the vault address, without a token id', () => {
  const d = go({ abi: abis.PositionVault, address: A.vault1, eventName: 'CollateralAdded', args: { amount: E18 } })
  assert.equal(d.row.contract, 'PositionVault')
  assert.equal(d.row.token_id, null)
  assert.equal(d.row.address, A.vault1)
})

test('logs from other addresses or with unknown topics are ignored', () => {
  const other = rawLog({ hash: H, block: 5, abi: abis.DeedMarket, address: '0x000000000000000000000000000000000000dEaD', eventName: 'Cancelled', args: { tokenId: 1n, by: A.alice } })
  assert.equal(dec.decode(other, 31611, 'v2', T), null)
  const junk = { ...rawLog({ hash: H, block: 5, abi: abis.DeedMarket, address: A.market, eventName: 'Cancelled', args: { tokenId: 1n, by: A.alice } }), topics: ['0x' + '99'.repeat(32)] }
  assert.equal(dec.decode(junk, 31611, 'v2', T), null)
})
