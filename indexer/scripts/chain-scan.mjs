// Independent check of /stats. It does not import the indexer's decoder, ABIs or SQL: it computes topic0 from
// signature strings, reads raw logs from the RPC and slices the data words by hand.
// usage: node scripts/chain-scan.mjs   (prints JSON with the same fields as /stats)
import { keccak256, toBytes } from 'viem'
import { readFileSync } from 'node:fs'

const RPC = process.env.MEZO_TESTNET_RPC || 'https://rpc.test.mezo.org'
const root = JSON.parse(readFileSync(new URL('../../deployments.json', import.meta.url)))
const v2 = JSON.parse(readFileSync(new URL('../config/deployments.json', import.meta.url))).deployments[0]
const t0 = (sig) => keccak256(toBytes(sig))
const ZERO = '0x' + '0'.repeat(40)

const deployments = [
  { version: 'v2', start: v2.startBlock, factory: v2.contracts.DeedFactory, market: v2.contracts.DeedMarket, auction: v2.contracts.RescueAuction, nft: v2.contracts.DeedNFT,
    sold: 'Sold(uint256,address,address,uint256)', won: 'Won(uint256,address,address,uint256,uint256)', soldFee: null, wonFee: null },
  { version: 'v3', start: root.deployBlock, factory: root.factory, market: root.market, auction: root.auction, nft: root.deedNFT,
    sold: 'Sold(uint256,address,address,uint256,uint256)', won: 'Won(uint256,address,address,uint256,uint256,uint256)', soldFee: 1, wonFee: 1 },
]

async function rpc(method, params) {
  for (let i = 0; i < 6; i++) {
    try {
      const j = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30000) })).json()
      if (j.result !== undefined) return j.result
    } catch {}
    await new Promise((r) => setTimeout(r, 700 * 2 ** i))
  }
  throw new Error('rpc failed ' + method)
}
const logs = async (address, topic0, from, to) => {
  const out = []
  for (let f = from; f <= to; f += 9000) {
    out.push(...(await rpc('eth_getLogs', [{ address, topics: [topic0], fromBlock: '0x' + f.toString(16), toBlock: '0x' + Math.min(f + 8999, to).toString(16) }])))
  }
  return out
}
const word = (data, i) => BigInt('0x' + data.slice(2 + i * 64, 2 + (i + 1) * 64))
const addrOf = (topic) => '0x' + topic.slice(26).toLowerCase()

const head = Number(await rpc('eth_blockNumber', [])) - 1
const res = { positions: 0, listings: 0, sales: 0, auctions_started: 0, rescues: 0, volume: 0n, fees: 0n }
const wallets = new Set()
const vaults = new Set()
for (const d of deployments) {
  const created = await logs(d.factory, t0('PositionCreated(uint256,address,address,uint256,uint256)'), d.start, head)
  res.positions += created.length
  for (const l of created) { vaults.add(addrOf(l.topics[2])); wallets.add(addrOf(l.topics[3])) }
  const listed = await logs(d.market, t0('Listed(uint256,address,uint256,uint64,uint256,bytes32)'), d.start, head)
  res.listings += listed.length
  for (const l of listed) wallets.add(addrOf(l.topics[2]))
  const sold = await logs(d.market, t0(d.sold), d.start, head)
  res.sales += sold.length
  for (const l of sold) {
    res.volume += word(l.data, 0)
    if (d.soldFee !== null) res.fees += word(l.data, d.soldFee)
    wallets.add(addrOf(l.topics[2])); wallets.add(addrOf(l.topics[3]))
  }
  res.auctions_started += (await logs(d.auction, t0('Started(uint256,address,bool,uint256,uint256,uint64)'), d.start, head)).length
  const won = await logs(d.auction, t0(d.won), d.start, head)
  res.rescues += won.length
  for (const l of won) {
    res.volume += word(l.data, 0)
    if (d.wonFee !== null) res.fees += word(l.data, d.wonFee)
    wallets.add(addrOf(l.topics[2])); wallets.add(addrOf(l.topics[3]))
  }
  console.error(d.version, 'scanned to', head)
}
// owners of tokens after transfers, cancellers etc. are also wallets in the indexer; add the Transfer parties
for (const d of deployments) {
  for (const l of await logs(d.nft, t0('Transfer(address,address,uint256)'), d.start, head)) {
    wallets.add(addrOf(l.topics[1])); wallets.add(addrOf(l.topics[2]))
  }
}
const contracts = new Set(deployments.flatMap((d) => [d.nft, d.factory, d.market, d.auction]).map((a) => a.toLowerCase()))
for (const a of [ZERO, ...vaults, ...contracts]) wallets.delete(a)
console.log(JSON.stringify({ scanned_to: head, positions: res.positions, listings: res.listings, sales: res.sales, auctions_started: res.auctions_started, rescues: res.rescues, unique_wallets: wallets.size, volume_musd_wei: res.volume.toString(), fees_musd_wei: res.fees.toString() }, null, 1))
