// Minimal JSON-RPC client with retries. Mezo's public RPC drops requests now and then.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const hex = (n) => '0x' + BigInt(n).toString(16)

export function rpcClient(url, { retries = 5 } = {}) {
  let id = 0
  async function call(method, params) {
    let err
    for (let i = 0; i <= retries; i++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
          signal: AbortSignal.timeout(30_000),
        })
        if (!res.ok) throw new Error(`rpc http ${res.status}`)
        const j = await res.json()
        if (j.error) throw new Error(`rpc ${method}: ${j.error.message}`)
        return j.result
      } catch (e) {
        err = e
        await sleep(500 * 2 ** i)
      }
    }
    throw err
  }
  return {
    async getBlockNumber() {
      return Number(await call('eth_blockNumber', []))
    },
    async getBlock(n) {
      const b = await call('eth_getBlockByNumber', [hex(n), false])
      return b ? { number: Number(b.number), hash: b.hash.toLowerCase(), timestamp: Number(b.timestamp) } : null
    },
    async getLogs({ address, fromBlock, toBlock }) {
      return call('eth_getLogs', [{ address, fromBlock: hex(fromBlock), toBlock: hex(toBlock) }])
    },
  }
}
