// Turns raw logs into rows for the `events` table.
// Anything money related (volume, fee) is read from the event arguments only, never guessed.
import { decodeEventLog, getAddress } from 'viem'

const ZERO = '0x0000000000000000000000000000000000000000'

// events whose `volume` is the MUSD that changed hands, and which argument holds it
export const VOLUME_FIELD = {
  'DeedMarket.Sold': 'price',
  'RescueAuction.Won': 'price',
}

// events that carry a protocol fee. v2 has no fee anywhere, so this is empty until a v3 ABI says otherwise.
export const FEE_FIELD = {}

// address arguments that name a participant, and the role they get
const WALLET_ARGS = ['owner', 'seller', 'buyer', 'winner', 'by', 'from', 'to']

const lower = (a) => a.toLowerCase()

// args as json: bigints become decimal strings, addresses lowercase
export function jsonArgs(args) {
  const out = {}
  for (const [k, v] of Object.entries(args ?? {})) {
    if (typeof v === 'bigint') out[k] = v.toString()
    else if (typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)) out[k] = lower(v)
    else out[k] = v
  }
  return out
}

// abiList: [{ contract, address, abi }]; known: Set of lowercase addresses that are contracts, not wallets
export function makeDecoder(abiList, known = new Set()) {
  const byAddress = new Map()
  for (const c of abiList) byAddress.set(lower(c.address), c)
  return {
    // returns null when the log is not one of ours
    decode(log, chainId, version, blockTime) {
      const src = byAddress.get(lower(log.address))
      if (!src) return null
      let ev
      try {
        ev = decodeEventLog({ abi: src.abi, data: log.data, topics: log.topics })
      } catch {
        return null // an event the ABI does not describe
      }
      const args = jsonArgs(ev.args)
      const key = `${src.contract}.${ev.eventName}`
      const tokenRaw = args.tokenId ?? args.id
      const wallets = []
      for (const f of WALLET_ARGS) {
        const w = args[f]
        if (typeof w === 'string' && w.startsWith('0x') && w !== ZERO && !known.has(w)) {
          if (!wallets.some((x) => x.wallet === w && x.role === f)) wallets.push({ wallet: w, role: f })
        }
      }
      return {
        row: {
          chain_id: chainId,
          version,
          block_number: Number(log.blockNumber),
          block_hash: lower(log.blockHash),
          block_time: blockTime,
          tx_hash: lower(log.transactionHash),
          log_index: Number(log.logIndex),
          address: lower(log.address),
          contract: src.contract,
          name: ev.eventName,
          token_id: tokenRaw === undefined ? null : tokenRaw,
          args,
          volume: VOLUME_FIELD[key] ? args[VOLUME_FIELD[key]] ?? '0' : '0',
          fee: FEE_FIELD[key] ? args[FEE_FIELD[key]] ?? '0' : '0',
        },
        wallets,
      }
    },
  }
}

export { getAddress, ZERO }
