import { makeDecoder } from './decode.js'
import { applyBatch, getCursor, rollback, recentBlocks, vaultAddresses, touchCursor } from './store.js'
import { CHAIN_ID } from './config.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cmp = (a, b) => Number(a.blockNumber) - Number(b.blockNumber) || Number(a.logIndex) - Number(b.logIndex)
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

export class MidBatchReorg extends Error {}

// If the chain no longer has the block we stored at the cursor, walk back to the last block it still has
// and drop everything after it. Returns the block number rolled back to, or null if no reorg.
export async function handleReorg(ctx, src) {
  const { db, client, log } = ctx
  const cursor = await getCursor(db, src.version)
  if (!cursor?.hash) return null
  const now = await client.getBlock(cursor.block)
  if (now && now.hash === cursor.hash) return null
  let fork = null
  for (const b of await recentBlocks(db, src.version)) {
    const onChain = await client.getBlock(b.number)
    if (onChain && onChain.hash === b.hash) {
      fork = b
      break
    }
  }
  const to = fork ? fork.number : src.startBlock - 1
  log(`${src.version}: reorg at ${cursor.block}, rolling back to ${to}`)
  await rollback(db, src.version, to, fork?.hash ?? null)
  return to
}

// indexes one batch of blocks; returns { to, events } or null when already caught up
export async function syncBatch(ctx, src, from, to) {
  const { db, client } = ctx
  const known = new Set(src.watched.map((w) => w.address))
  const staticAddrs = src.watched.map((w) => w.address)

  const raw = await client.getLogs({ address: staticAddrs, fromBlock: from, toBlock: to })
  const abiList = [...src.watched]

  // vault events: the vaults found so far plus any created inside this very range
  const vaults = new Set(await vaultAddresses(db, src.version))
  if (src.vaultAbi) {
    const probe = makeDecoder(abiList, known)
    for (const l of raw) {
      const d = probe.decode(l, CHAIN_ID, src.version, new Date(0))
      if (d?.row.name === 'PositionCreated') vaults.add(d.row.args.vault)
    }
    for (const part of chunk([...vaults], 100)) {
      raw.push(...(await client.getLogs({ address: part, fromBlock: from, toBlock: to })))
    }
    for (const v of vaults) abiList.push({ contract: 'PositionVault', address: v, abi: src.vaultAbi })
  }
  raw.sort(cmp)

  // block timestamps, and a check that the logs and the block header agree
  const numbers = [...new Set(raw.map((l) => Number(l.blockNumber)))]
  const headers = new Map()
  for (const part of chunk(numbers, 8)) {
    for (const b of await Promise.all(part.map((n) => client.getBlock(n)))) if (b) headers.set(b.number, b)
  }
  const headBlock = await client.getBlock(to)
  if (!headBlock) throw new MidBatchReorg(`block ${to} vanished`)
  for (const l of raw) {
    const h = headers.get(Number(l.blockNumber))
    if (!h || h.hash !== l.blockHash.toLowerCase()) throw new MidBatchReorg(`block ${Number(l.blockNumber)} changed while reading`)
  }

  const decoder = makeDecoder(abiList, known)
  const events = []
  for (const l of raw) {
    const t = new Date(headers.get(Number(l.blockNumber)).timestamp * 1000)
    const d = decoder.decode(l, CHAIN_ID, src.version, t)
    if (d) events.push(d)
  }
  await applyBatch(db, src.version, {
    events,
    blocks: [...headers.values()].map((b) => ({ number: b.number, hash: b.hash })),
    head: { number: to, hash: headBlock.hash },
  })
  return { to, events: events.length }
}

// catches one deployment up to the chain head. Returns the number of events stored.
export async function syncSource(ctx, src) {
  const { client, batchBlocks, confirmations, log } = ctx
  let total = 0
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await handleReorg(ctx, src)
      const cursor = await getCursor(ctx.db, src.version)
      let next = (cursor ? cursor.block : src.startBlock - 1) + 1
      const head = (await client.getBlockNumber()) - confirmations
      while (next <= head) {
        const to = Math.min(next + batchBlocks - 1, head)
        const r = await syncBatch(ctx, src, next, to)
        total += r.events
        log(`${src.version}: blocks ${next}-${to}, ${r.events} events`)
        next = to + 1
      }
      await touchCursor(ctx.db, src.version)
      return total
    } catch (e) {
      if (!(e instanceof MidBatchReorg)) throw e
      log(`${src.version}: ${e.message}, retrying`)
      await sleep(1000)
    }
  }
  throw new Error(`${src.version}: gave up after repeated reorgs`)
}

// one pass over every deployment, for cron. Every deployment is tried even if an earlier one fails, and any
// failure is thrown at the end so the process exits non-zero.
export async function runOnce(ctx, sources) {
  if (!sources.length) throw new Error('no deployment is configured to sync')
  const errors = []
  for (const src of sources) {
    try {
      await syncSource(ctx, src)
    } catch (e) {
      ctx.log(`${src.version}: sync error: ${e.message}`)
      errors.push(`${src.version}: ${e.message}`)
    }
  }
  if (errors.length) throw new Error(errors.join('; '))
}

export async function runForever(ctx, sources) {
  for (;;) {
    for (const src of sources) {
      try {
        await syncSource(ctx, src)
      } catch (e) {
        ctx.log(`${src.version}: sync error: ${e.message}`)
      }
    }
    await sleep(ctx.pollMs)
  }
}
