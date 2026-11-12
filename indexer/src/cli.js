#!/usr/bin/env node
import { env, loadDeployments, sourceFor } from './config.js'
import { connect, migrate } from './db.js'
import { rpcClient } from './rpc.js'
import { runForever } from './sync.js'
import { startApi } from './api.js'

const log = (m) => console.log(new Date().toISOString(), m)
const cmd = process.argv[2] || 'run'
const once = process.argv.includes('--once')
const e = env()

if (!e.databaseUrl) {
  console.error('DATABASE_URL is not set (see .env.example)')
  process.exit(1)
}

// deployments with an address, an ABI and a start block
function activeSources() {
  const out = []
  for (const dep of loadDeployments()) {
    const src = sourceFor(dep)
    if (!dep.startBlock || src.missing.length) {
      log(`${dep.version}: skipped (${!dep.startBlock ? 'no startBlock' : src.missing.join('; ')})`)
      continue
    }
    out.push(src)
  }
  return out
}

const db = await connect(e.databaseUrl)
await migrate(db)

if (cmd === 'migrate') {
  log('migrated')
  await db.close()
} else if (cmd === 'sync') {
  const ctx = { db, client: rpcClient(e.rpc), log, ...e }
  await runForever(ctx, activeSources(), { once })
  if (once) await db.close()
} else if (cmd === 'serve') {
  startApi(db, e.port, log)
} else if (cmd === 'run') {
  // one process: the API plus the sync loop
  startApi(db, e.port, log)
  const ctx = { db, client: rpcClient(e.rpc), log, ...e }
  runForever(ctx, activeSources()).catch((err) => {
    log(`fatal: ${err.message}`)
    process.exit(1)
  })
} else {
  console.error('usage: cli.js [migrate | sync [--once] | serve | run]')
  process.exit(1)
}
