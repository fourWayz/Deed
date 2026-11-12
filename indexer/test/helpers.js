import { encodeAbiParameters, encodeEventTopics, toHex, pad } from 'viem'
import { loadAbi } from '../src/config.js'

export const A = {
  nft: '0x848063cbd0230b6a4345311ec090fdb51f49b681',
  factory: '0x25adc1306c9ad1529ec00b14ed353b4b198eb8fc',
  market: '0x7e8a3d9624a4b69b5adcd362028422b85edf2e99',
  auction: '0x190fb7559bb8023ecaa7c90cfcc17187042b89f9',
  vault1: '0x00000000000000000000000000000000000000a1',
  alice: '0x00000000000000000000000000000000000a11ce',
  bob: '0x0000000000000000000000000000000000000b0b',
  carol: '0x000000000000000000000000000000000000ca01',
}
export const ZERO = '0x0000000000000000000000000000000000000000'

export const abis = Object.fromEntries(
  ['DeedNFT', 'DeedFactory', 'DeedMarket', 'RescueAuction', 'PositionVault'].map((n) => [n, loadAbi('v2', n)]),
)

export function src() {
  return {
    version: 'v2',
    startBlock: 100,
    watched: [
      { contract: 'DeedNFT', address: A.nft, abi: abis.DeedNFT },
      { contract: 'DeedFactory', address: A.factory, abi: abis.DeedFactory },
      { contract: 'DeedMarket', address: A.market, abi: abis.DeedMarket },
      { contract: 'RescueAuction', address: A.auction, abi: abis.RescueAuction },
    ],
    vaultAbi: abis.PositionVault,
  }
}

// builds a raw eth_getLogs entry the way the node returns it
export function rawLog({ abi, address, eventName, args, block, hash, logIndex = 0, tx }) {
  const ev = abi.find((x) => x.type === 'event' && x.name === eventName)
  const topics = encodeEventTopics({ abi, eventName, args })
  const nonIndexed = ev.inputs.filter((i) => !i.indexed)
  const data = nonIndexed.length ? encodeAbiParameters(nonIndexed, nonIndexed.map((i) => args[i.name])) : '0x'
  return {
    address,
    topics,
    data,
    blockNumber: toHex(block),
    blockHash: hash,
    transactionHash: tx ?? pad(toHex(block * 1000 + logIndex), { size: 32 }),
    logIndex: toHex(logIndex),
  }
}

export const E18 = 10n ** 18n

// a fake chain: blocks keyed by number, logs by block. Mutate `chain.forkFrom(n)` to simulate a reorg.
export function fakeChain(head) {
  const c = {
    head,
    salt: 'a',
    logs: [], // { block, log } where log has no blockHash yet
    blockHash(n) {
      return pad(toHex(BigInt(n) * 7919n + BigInt(c.forkSalt?.[n] ?? c.saltFor(n))), { size: 32 })
    },
    saltFor() { return 0 },
    forkSalt: {},
    forkFrom(n) { for (let i = n; i <= c.head; i++) c.forkSalt[i] = 5 },
    client: {
      getBlockNumber: async () => c.head,
      getBlock: async (n) => (n > c.head ? null : { number: n, hash: c.blockHash(n), timestamp: 1_700_000_000 + n }),
      getLogs: async ({ address, fromBlock, toBlock }) => {
        const addrs = (Array.isArray(address) ? address : [address]).map((a) => a.toLowerCase())
        return c.logs
          .filter((x) => x.block >= fromBlock && x.block <= toBlock && addrs.includes(x.address.toLowerCase()))
          .map((x) => ({ ...x.log, blockHash: c.blockHash(x.block), blockNumber: toHex(x.block) }))
      },
    },
    add(spec) {
      const log = rawLog({ ...spec, hash: '0x00' })
      c.logs.push({ block: spec.block, address: spec.address, log })
    },
  }
  return c
}
