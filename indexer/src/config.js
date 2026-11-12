import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
export const root = path.join(here, '..')

export const CHAIN_ID = 31611

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

// event-only ABI files, one per contract: abis/<version>/<Contract>.json
export function loadAbi(version, contract) {
  const p = path.join(root, 'abis', version, `${contract}.json`)
  if (!existsSync(p)) return null
  const j = readJson(p)
  const abi = Array.isArray(j) ? j : j.abi
  return abi
}

// config/deployments.json lists every deployment the indexer follows
export function loadDeployments(file = path.join(root, 'config', 'deployments.json')) {
  const j = readJson(file)
  return j.deployments
}

// builds the list of contracts to watch for one deployment; skips ones without an address or an ABI
export function sourceFor(dep) {
  const contracts = []
  const missing = []
  for (const name of ['DeedNFT', 'DeedFactory', 'DeedMarket', 'RescueAuction']) {
    const address = dep.contracts?.[name]
    const abi = loadAbi(dep.version, name)
    if (!address) missing.push(`${name}: no address`)
    else if (!abi) missing.push(`${name}: no abi in abis/${dep.version}/`)
    else contracts.push({ contract: name, address: address.toLowerCase(), abi })
  }
  return { ...dep, watched: contracts, missing, vaultAbi: loadAbi(dep.version, 'PositionVault') }
}

export function env() {
  return {
    databaseUrl: process.env.DATABASE_URL,
    rpc: process.env.MEZO_TESTNET_RPC || 'https://rpc.test.mezo.org',
    port: Number(process.env.PORT || 8787),
    // Mezo's RPC rejects eth_getLogs ranges over 10000 blocks
    batchBlocks: Math.min(Number(process.env.BATCH_BLOCKS || 9000), 10000),
    pollMs: Number(process.env.POLL_MS || 4000),
    confirmations: Number(process.env.CONFIRMATIONS || 1),
  }
}

