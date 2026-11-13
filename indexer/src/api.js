import http from 'node:http'

const MAX_LIMIT = 200

const clampInt = (v, def, max) => {
  const n = Number.parseInt(v ?? '', 10)
  if (!Number.isFinite(n) || n < 0) return def
  return Math.min(n, max)
}
const isAddr = (s) => /^0x[0-9a-fA-F]{40}$/.test(s || '')

// numeric columns come back from pg as strings already; pglite may give numbers, normalise
const str = (v) => (v === null || v === undefined ? null : typeof v === 'bigint' ? v.toString() : String(v))

const num = (...cols) => (row) => {
  for (const c of cols) if (c in row) row[c] = str(row[c])
  return row
}

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// "v3-12" is token 12 of deployment v3. A bare "12" means the newest deployment that has it.
function parseId(id) {
  const m = /^(?:(v\d+)-)?(\d+)$/.exec(id)
  if (!m) throw new HttpError(400, 'id must look like v3-12 or 12')
  return { version: m[1] ?? null, tokenId: m[2] }
}

export function routes(db) {
  const positionCols = `version, token_id, vault, creator, owner, collateral, debt_principal, opened_collateral, opened_debt,
    status, created_block, created_tx, created_at`
  const fixPos = (r) => ({ id: `${r.version}-${r.token_id}`, ...num('token_id', 'collateral', 'debt_principal', 'opened_collateral', 'opened_debt')(r) })

  return {
    async positions(q) {
      const where = []
      const p = []
      if (q.owner) {
        if (!isAddr(q.owner)) throw new HttpError(400, 'owner must be an address')
        p.push(q.owner.toLowerCase()); where.push(`lower(owner) = $${p.length}`)
      }
      if (q.status) {
        if (!['held', 'listed', 'auction', 'closed'].includes(q.status)) throw new HttpError(400, 'bad status')
        p.push(q.status); where.push(`status = $${p.length}`)
      }
      if (q.version) { p.push(q.version); where.push(`version = $${p.length}`) }
      const limit = clampInt(q.limit, 50, MAX_LIMIT)
      const offset = clampInt(q.offset, 0, 1e9)
      const w = where.length ? 'where ' + where.join(' and ') : ''
      const total = (await db.query(`select count(*) c from v_positions ${w}`, p)).rows[0].c
      const rows = (await db.query(
        `select ${positionCols} from v_positions ${w} order by created_block desc, token_id desc limit ${limit} offset ${offset}`, p)).rows
      return { total: Number(total), limit, offset, items: rows.map(fixPos) }
    },

    async position(id) {
      const { version, tokenId } = parseId(id)
      const p = [tokenId]
      let w = 'token_id = $1'
      if (version) { p.push(version); w += ' and version = $2' }
      const r = (await db.query(`select ${positionCols} from v_positions where ${w} order by version desc limit 1`, p)).rows[0]
      if (!r) throw new HttpError(404, 'no such position')
      const history = (await db.query(
        `select version, name, contract, args, block_number, block_time, tx_hash, log_index from events
         where version = $1 and (token_id = $2 or address = $3)
         order by block_number, log_index`, [r.version, tokenId, r.vault])).rows
      const listings = (await db.query(`select * from v_listings where version = $1 and token_id = $2 order by block_number desc, log_index desc`, [r.version, tokenId])).rows
      const auctions = (await db.query(`select * from v_auctions where version = $1 and token_id = $2 order by block_number desc, log_index desc`, [r.version, tokenId])).rows
      return {
        ...fixPos(r),
        listings: listings.map(fixListing),
        auctions: auctions.map(fixAuction),
        history: history.map(fixEvent),
      }
    },

    async listings(q) {
      const status = q.status || 'active'
      if (!['active', 'sold', 'cancelled', 'all'].includes(status)) throw new HttpError(400, 'bad status')
      const p = []
      const where = []
      if (status !== 'all') { p.push(status); where.push(`status = $${p.length}`) }
      if (q.seller) {
        if (!isAddr(q.seller)) throw new HttpError(400, 'seller must be an address')
        p.push(q.seller.toLowerCase()); where.push(`lower(seller) = $${p.length}`)
      }
      if (q.version) { p.push(q.version); where.push(`version = $${p.length}`) }
      const limit = clampInt(q.limit, 50, MAX_LIMIT)
      const offset = clampInt(q.offset, 0, 1e9)
      const w = where.length ? 'where ' + where.join(' and ') : ''
      const rows = (await db.query(`select * from v_listings ${w} order by block_number desc, log_index desc limit ${limit} offset ${offset}`, p)).rows
      return { limit, offset, items: rows.map(fixListing) }
    },

    async auctions(q) {
      const status = q.status || 'open'
      if (!['open', 'won', 'ended', 'all'].includes(status)) throw new HttpError(400, 'bad status')
      const p = []
      const where = []
      if (status !== 'all') { p.push(status); where.push(`status = $${p.length}`) }
      if (q.version) { p.push(q.version); where.push(`version = $${p.length}`) }
      const limit = clampInt(q.limit, 50, MAX_LIMIT)
      const offset = clampInt(q.offset, 0, 1e9)
      const w = where.length ? 'where ' + where.join(' and ') : ''
      const rows = (await db.query(`select * from v_auctions ${w} order by block_number desc, log_index desc limit ${limit} offset ${offset}`, p)).rows
      return { limit, offset, items: rows.map(fixAuction) }
    },

    // newest first. Pass before=<block> to page.
    async activity(q) {
      const p = []
      const where = [`contract <> 'PositionVault' or name in ('CollateralAdded','Repaid','Withdrawn','Borrowed','Refinanced','Closed','SurplusClaimed')`]
      // Transfer is noise on top of Listed/Sold/PositionCreated, so keep it out of the feed unless asked
      if (q.include !== 'transfers') where.push(`name <> 'Transfer'`)
      if (q.type) { p.push(q.type); where.push(`name = $${p.length}`) }
      if (q.token) { p.push(String(q.token)); where.push(`token_id = $${p.length}`) }
      if (q.version) { p.push(q.version); where.push(`version = $${p.length}`) }
      if (q.wallet) {
        if (!isAddr(q.wallet)) throw new HttpError(400, 'wallet must be an address')
        p.push(q.wallet.toLowerCase())
        where.push(`exists (select 1 from event_wallets w where w.chain_id = events.chain_id and w.tx_hash = events.tx_hash and w.log_index = events.log_index and w.wallet = $${p.length})`)
      }
      if (q.before) { p.push(clampInt(q.before, 0, 1e12)); where.push(`block_number < $${p.length}`) }
      const limit = clampInt(q.limit, 50, MAX_LIMIT)
      const rows = (await db.query(
        `select version, name, contract, address, token_id, args, volume, fee, block_number, block_time, tx_hash, log_index
         from events where ${where.map((x) => `(${x})`).join(' and ')}
         order by block_number desc, log_index desc limit ${limit}`, p)).rows
      return { limit, items: rows.map(fixEvent) }
    },

    async stats() {
      const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
      const agg = await one(`
        select
          count(*) filter (where contract = 'DeedFactory' and name = 'PositionCreated')  as positions,
          count(*) filter (where contract = 'DeedMarket' and name = 'Listed')            as listings,
          count(*) filter (where contract = 'DeedMarket' and name = 'Sold')              as sales,
          count(*) filter (where contract = 'RescueAuction' and name = 'Started')        as auctions_started,
          count(*) filter (where contract = 'RescueAuction' and name = 'Won')            as rescues,
          coalesce(sum(volume), 0)                                                       as volume,
          coalesce(sum(fee), 0)                                                          as fees
        from events`)
      // a wallet is any address that played a role in an event, minus vaults and the Deed contracts
      const wallets = await one(`
        select count(distinct w.wallet) as n from event_wallets w
        where not exists (select 1 from events c where c.contract = 'DeedFactory' and c.name = 'PositionCreated' and c.args->>'vault' = w.wallet)
          and not exists (select 1 from events e where e.address = w.wallet)`)
      const perVersion = (await db.query(`
        select version,
          count(*) filter (where name = 'PositionCreated') as positions,
          coalesce(sum(volume), 0) as volume,
          coalesce(sum(fee), 0) as fees
        from events group by version order by version`)).rows
      const sync = (await db.query('select version, block, hash, updated_at from sync_state order by version')).rows
      return {
        positions: Number(agg.positions),
        listings: Number(agg.listings),
        sales: Number(agg.sales),
        auctions_started: Number(agg.auctions_started),
        rescues: Number(agg.rescues),
        unique_wallets: Number(wallets.n),
        volume_musd_wei: str(agg.volume),
        fees_musd_wei: str(agg.fees),
        by_version: perVersion.map((r) => ({ version: r.version, positions: Number(r.positions), volume_musd_wei: str(r.volume), fees_musd_wei: str(r.fees) })),
        indexed_to: sync.map((r) => ({ version: r.version, block: Number(r.block), updated_at: r.updated_at })),
      }
    },
  }
}

function fixListing(r) {
  return {
    id: `${r.version}-${r.token_id}`,
    ...num('token_id', 'price', 'expiry', 'min_icr')({ ...r }),
    expired: r.status === 'active' ? Number(r.expiry) * 1000 < Date.now() : false,
  }
}
function fixAuction(r) {
  const out = num('token_id', 'start_price', 'floor_price', 'duration', 'final_price', 'top_up')({ ...r })
  const endsAt = new Date(new Date(r.started_at).getTime() + Number(r.duration) * 1000)
  return { id: `${r.version}-${r.token_id}`, ...out, ends_at: endsAt.toISOString(), expired: r.status === 'open' && endsAt < new Date() }
}
function fixEvent(r) {
  return { ...num('token_id', 'volume', 'fee')({ ...r }) }
}

// fixed-window counter per client. Fly sets fly-client-ip itself; x-forwarded-for is client controlled, so it is ignored.
export function rateLimiter({ perMinute = 120, now = () => Date.now() } = {}) {
  const hits = new Map()
  const timer = setInterval(() => {
    const t = now()
    for (const [k, v] of hits) if (t - v.start >= 60_000) hits.delete(k)
  }, 60_000)
  timer.unref?.()
  return (req) => {
    const key = req.headers['fly-client-ip'] || req.socket?.remoteAddress || 'unknown'
    const t = now()
    let h = hits.get(key)
    if (!h || t - h.start >= 60_000) {
      h = { start: t, n: 0 }
      hits.set(key, h)
    }
    h.n++
    return h.n > perMinute ? Math.max(1, Math.ceil((h.start + 60_000 - t) / 1000)) : 0 // seconds to wait, 0 = ok
  }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
}

export function handler(db, { perMinute = 120 } = {}) {
  const r = routes(db)
  const limited = rateLimiter({ perMinute })
  return async (req, res) => {
    const send = (status, body, extra = {}) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'cache-control': status === 200 ? 'public, max-age=3' : 'no-store',
        ...extra,
      })
      res.end(JSON.stringify(body))
    }
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS)
        return res.end()
      }
      if (new URL(req.url, 'http://x').pathname !== '/health') {
        const wait = limited(req)
        if (wait) return send(429, { error: 'rate limit exceeded' }, { 'retry-after': String(wait) })
      }
      if (req.method !== 'GET') throw new HttpError(405, 'GET only')
      const url = new URL(req.url, 'http://x')
      const q = Object.fromEntries(url.searchParams)
      const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean)
      if (parts.length === 0 || parts[0] === 'health') return send(200, { ok: true })
      if (parts[0] === 'positions' && parts.length === 1) return send(200, await r.positions(q))
      if (parts[0] === 'positions' && parts.length === 2) return send(200, await r.position(parts[1]))
      if (parts[0] === 'listings' && parts.length === 1) return send(200, await r.listings(q))
      if (parts[0] === 'auctions' && parts.length === 1) return send(200, await r.auctions(q))
      if (parts[0] === 'activity' && parts.length === 1) return send(200, await r.activity(q))
      if (parts[0] === 'stats' && parts.length === 1) return send(200, await r.stats())
      throw new HttpError(404, 'not found')
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message })
      console.error(e)
      send(500, { error: 'internal error' })
    }
  }
}

export function startApi(db, port, log = console.log, opts = {}) {
  const server = http.createServer(handler(db, opts))
  server.listen(port, () => log(`api on :${port}`))
  return server
}
