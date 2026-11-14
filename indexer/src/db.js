// Thin wrapper so the same code runs on Supabase/Postgres (pg) and on an in-process Postgres (pglite) in tests.
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { root } from './config.js'

export async function connect(url, { max = 5, idleMs = 10_000 } = {}) {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({
    connectionString: url,
    max,
    idleTimeoutMillis: idleMs,
    allowExitOnIdle: true,
    // Supabase needs TLS; local postgres usually does not
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
  })
  return {
    query: (text, params) => pool.query(text, params),
    async tx(fn) {
      const c = await pool.connect()
      try {
        await c.query('begin')
        const r = await fn({ query: (t, p) => c.query(t, p) })
        await c.query('commit')
        return r
      } catch (e) {
        await c.query('rollback').catch(() => {})
        throw e
      } finally {
        c.release()
      }
    },
    close: () => pool.end(),
  }
}

export async function memoryDb() {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = new PGlite()
  return {
    query: (text, params) => pg.query(text, params),
    tx: (fn) => pg.transaction((t) => fn({ query: (q, p) => t.query(q, p) })),
    close: () => pg.close(),
  }
}

// runs sql/*.sql in order. Files are idempotent (create ... if not exists / create or replace).
export async function migrate(db) {
  const dir = path.join(root, 'sql')
  // remember which files ran, so a cron run that finds nothing new does not redo the schema every time
  await db.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())')
  const done = new Set((await db.query('select name from schema_migrations')).rows.map((r) => r.name))
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (done.has(f)) continue
    const sql = readFileSync(path.join(dir, f), 'utf8')
    // pglite's query() takes one statement, pg takes several; split on blank-line separated statements
    for (const stmt of splitSql(sql)) await db.query(stmt)
    await db.query('insert into schema_migrations (name) values ($1) on conflict do nothing', [f])
  }
}

// statements end with ';' at the end of a line; none of ours contain a ';' inside a string
export function splitSql(sql) {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}
