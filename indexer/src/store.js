// All writes go through here. Everything is keyed on (chain, tx, log index), so replaying a block range
// can never create a second row.

export async function getCursor(db, version) {
  const r = await db.query('select block, hash from sync_state where version = $1', [version])
  return r.rows[0] ? { block: Number(r.rows[0].block), hash: r.rows[0].hash } : null
}

// events: [{ row, wallets }]; blocks: [{ number, hash }]; head is the last block this batch covers
export async function applyBatch(db, version, { events, blocks, head }) {
  await db.tx(async (t) => {
    for (const { row, wallets } of events) {
      await t.query(
        `insert into events (chain_id, version, block_number, block_hash, block_time, tx_hash, log_index,
           address, contract, name, token_id, args, volume, fee)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         on conflict (chain_id, tx_hash, log_index) do nothing`,
        [row.chain_id, row.version, row.block_number, row.block_hash, row.block_time, row.tx_hash, row.log_index,
         row.address, row.contract, row.name, row.token_id, JSON.stringify(row.args), row.volume, row.fee],
      )
      for (const w of wallets) {
        await t.query(
          `insert into event_wallets (chain_id, tx_hash, log_index, wallet, role) values ($1,$2,$3,$4,$5)
           on conflict do nothing`,
          [row.chain_id, row.tx_hash, row.log_index, w.wallet, w.role],
        )
      }
    }
    for (const b of [...blocks, { number: head.number, hash: head.hash }]) {
      await t.query(
        `insert into blocks (version, number, hash) values ($1,$2,$3)
         on conflict (version, number) do update set hash = excluded.hash`,
        [version, b.number, b.hash],
      )
    }
    await t.query(
      `insert into sync_state (version, block, hash) values ($1,$2,$3)
       on conflict (version) do update set block = excluded.block, hash = excluded.hash, updated_at = now()`,
      [version, head.number, head.hash],
    )
  })
}

// drop everything after `block` for one version and move the cursor back to it
export async function rollback(db, version, block, hash = null) {
  await db.tx(async (t) => {
    await t.query('delete from events where version = $1 and block_number > $2', [version, block])
    await t.query('delete from blocks where version = $1 and number > $2', [version, block])
    await t.query(
      `insert into sync_state (version, block, hash) values ($1,$2,$3)
       on conflict (version) do update set block = excluded.block, hash = excluded.hash, updated_at = now()`,
      [version, block, hash],
    )
  })
}

// stored block hashes, newest first
export async function recentBlocks(db, version, limit = 200) {
  const r = await db.query('select number, hash from blocks where version = $1 order by number desc limit $2', [version, limit])
  return r.rows.map((x) => ({ number: Number(x.number), hash: x.hash }))
}

export async function vaultAddresses(db, version) {
  const r = await db.query(
    `select distinct args->>'vault' as vault from events
     where version = $1 and contract = 'DeedFactory' and name = 'PositionCreated'`,
    [version],
  )
  return r.rows.map((x) => x.vault)
}

// a pass that found nothing new still counts as a sync: move updated_at so clients can see the indexer is alive
export async function touchCursor(db, version) {
  await db.query('update sync_state set updated_at = now() where version = $1', [version])
}
