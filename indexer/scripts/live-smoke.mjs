// Syncs every configured deployment from the real chain into an in-process Postgres and prints /stats.
import { memoryDb, migrate } from '../src/db.js'
import { rpcClient } from '../src/rpc.js'
import { syncSource } from '../src/sync.js'
import { loadDeployments, sourceFor } from '../src/config.js'
import { routes } from '../src/api.js'
const db = await memoryDb(); await migrate(db)
const client = rpcClient(process.env.MEZO_TESTNET_RPC || 'https://rpc.test.mezo.org')
const ctx = { db, client, batchBlocks: 9000, confirmations: 1, log: (m) => process.stdout.write(m.slice(0, 70) + '\n') }
for (const dep of loadDeployments()) {
  const src = sourceFor(dep)
  const t = Date.now()
  await syncSource(ctx, src)
  console.log(dep.version, 'secs', (Date.now() - t) / 1000)
}
const api = routes(db)
console.log(JSON.stringify(await api.stats(), null, 1))
console.log('listings', (await api.listings({ status: 'all' })).items.length, 'auctions', (await api.auctions({ status: 'all' })).items.length)
