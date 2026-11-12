import { memoryDb, migrate } from '../src/db.js'
import { rpcClient } from '../src/rpc.js'
import { syncSource } from '../src/sync.js'
import { loadDeployments, sourceFor } from '../src/config.js'
import { routes } from '../src/api.js'
const db = await memoryDb(); await migrate(db)
const client = rpcClient('https://rpc.test.mezo.org')
const src = sourceFor(loadDeployments()[0])
const ctx = { db, client, batchBlocks: Number(process.env.B || 2000), confirmations: 1, log: (m) => process.stdout.write(m.slice(0, 60) + '\n') }
const t = Date.now()
await syncSource(ctx, src)
console.log('secs', (Date.now() - t) / 1000)
const api = routes(db)
console.log(JSON.stringify(await api.stats(), null, 1))
console.log((await api.positions({ limit: 3 })).items.map((p) => `${p.id} ${p.status} owner=${p.owner?.slice(0,8)} coll=${p.collateral}`))
console.log('listings', (await api.listings({ status: 'all' })).items.length, 'auctions', (await api.auctions({ status: 'all' })).items.length)
