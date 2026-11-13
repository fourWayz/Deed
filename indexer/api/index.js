// Vercel serverless entry. vercel.json rewrites every public path to /api/index?route=...&id=..., and this
// rebuilds the original path so the same handler that runs the standalone server answers the request.
import { handler } from '../src/api.js'
import { connect } from '../src/db.js'

const CACHE = 'public, s-maxage=15, stale-while-revalidate=60'

// getDb returns the database (or a promise of it) the first time a request needs it
export function makeFunction(getDb) {
  let handle // kept between invocations of a warm instance
  const lazy = {
    query: async (t, p) => (await getDb()).query(t, p),
    tx: async (f) => (await getDb()).tx(f),
  }
  return async function (req, res) {
    if (!handle) handle = handler(lazy, { perMinute: 0, cacheControl: CACHE }) // the CDN cache replaces the rate limit
    const u = new URL(req.url, 'http://x')
    const route = u.searchParams.get('route') || ''
    const id = u.searchParams.get('id')
    u.searchParams.delete('route')
    u.searchParams.delete('id')
    const qs = u.searchParams.toString()
    req.url = `/${route}${id ? `/${encodeURIComponent(id)}` : ''}${qs ? `?${qs}` : ''}`
    return handle(req, res)
  }
}

// one connection per warm instance, pool max 1, so a burst of requests cannot open many sessions on the pooler
let db
const fromEnv = () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
  return (db ??= connect(process.env.DATABASE_URL, { max: 1, idleMs: 5_000 }))
}

const fn = makeFunction(fromEnv)

export default async function (req, res) {
  if (!process.env.DATABASE_URL) {
    res.writeHead(500, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' })
    return res.end(JSON.stringify({ error: 'server is not configured' }))
  }
  return fn(req, res)
}
