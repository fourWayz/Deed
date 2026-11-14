#!/usr/bin/env node
import { env, loadDeployments, sourceFor } from './config.js'
import { connect, migrate } from './db.js'
import { rpcClient } from './rpc.js'
import { runForever, runOnce } from './sync.js'
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
try {
  await migrate(db)
} catch (err) {
  console.error(`migrate failed: ${err.message}`)
  process.exit(1)
}

if (cmd === 'migrate') {
  log('migrated')
  await db.close()
} else if (cmd === 'sync') {
  const ctx = { db, client: rpcClient(e.rpc), log, ...e }
  if (once) {
    // cron mode: any error exits 1 so the scheduled job turns red
    try {
      await runOnce(ctx, activeSources())
    } catch (err) {
      console.error(`sync failed: ${err.message}`)
      process.exitCode = 1
    } finally {
      await db.close()
    }
  } else {
    await runForever(ctx, activeSources())
  }
} else if (cmd === 'serve') {
  startApi(db, e.port, log, { perMinute: e.rateLimitPerMin })
} else if (cmd === 'run') {
  // one process: the API plus the sync loop
  startApi(db, e.port, log, { perMinute: e.rateLimitPerMin })
  const ctx = { db, client: rpcClient(e.rpc), log, ...e }
  runForever(ctx, activeSources()).catch((err) => {
    log(`fatal: ${err.message}`)
    process.exit(1)
  })
} else {
  console.error('usage: cli.js [migrate | sync [--once] | serve | run]')
  process.exit(1)
}
