// Local stand-in for `vercel dev`: applies the rewrites from vercel.json, then calls the api/index.js function the
// way Vercel would. It is NOT Vercel (no edge cache, no real runtime); it shows the rewrites and the function work.
// usage: DATABASE_URL=... PORT=3000 node scripts/dev-vercel.mjs
import http from 'node:http'
import { readFileSync } from 'node:fs'
import defaultFn from '../api/index.js'

export function compileRewrites(rewrites) {
  return rewrites.map((r) => ({
    re: new RegExp('^' + r.source.replace(/:(\w+)\(([^)]+)\)/g, '(?<$1>$2)').replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'),
    destination: r.destination,
  }))
}

export function rewrite(rules, pathAndQuery) {
  const u = new URL(pathAndQuery, 'http://x')
  for (const r of rules) {
    const m = r.re.exec(u.pathname)
    if (!m) continue
    const dest = new URL(r.destination.replace(/:(\w+)/g, (_, k) => encodeURIComponent(m.groups?.[k] ?? '')), 'http://x')
    for (const [k, v] of u.searchParams) dest.searchParams.append(k, v) // Vercel keeps the original query string
    return dest.pathname + dest.search
  }
  return null
}

export function devServer(fn = defaultFn) {
  const rules = compileRewrites(JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url))).rewrites)
  return http.createServer((req, res) => {
    const dest = req.url.startsWith('/api/') ? req.url : rewrite(rules, req.url)
    if (!dest) {
      res.writeHead(404, { 'content-type': 'application/json' })
      return res.end('{"error":"not found"}')
    }
    req.url = dest
    return fn(req, res)
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 3000)
  devServer().listen(port, () => console.log(`dev-vercel on :${port}`))
}
