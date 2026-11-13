import { decodeEventLog, type Address, type PublicClient } from "viem";
import { ADDR, START_BLOCK, eventsAbi } from "./config";
import { hasOutsider } from "./team";

export type Activity = {
  kind: "opened" | "listed" | "sold" | "auction" | "won";
  // deployment the event belongs to, only the indexer reports it. Anything but the current version is an earlier deployment.
  version?: string;
  tokenId: bigint;
  block: bigint;
  tx: `0x${string}`;
  // wallets involved, used to count unique wallets
  wallets: Address[];
  // MUSD that changed hands, zero for events that move none
  amount: bigint;
  fee: bigint;
};

export type Earlier = { version: string; positions: number; volume: bigint; fees: bigint };

export type Stats = {
  // where the numbers came from: the indexer (every deployment) or a scan of this deployment's events
  source: "indexer" | "chain";
  // history of earlier deployments, only the indexer has it
  earlier: Earlier[];
  // when the indexer last finished a sync pass (ISO time), only the indexer reports it
  lastSyncedAt?: string | null;
  // true once a wallet that is not on the team list has taken part, then the "team test wallets" label goes away
  outsideWallets: boolean;
  positions: number;
  volume: bigint;
  fees: bigint;
  wallets: number;
  sales: number;
  rescues: number;
  recent: Activity[];
  fromBlock: bigint;
  toBlock: bigint;
};

const CHUNK = 10_000n; // the Mezo RPC refuses wider log ranges
const PARALLEL = 6;

/** Reads every Deed event since the deployment, in 10k block windows, a few at a time. */
export async function scanActivity(client: PublicClient, onProgress?: (done: number, total: number) => void): Promise<Stats> {
  const head = await client.getBlockNumber();
  const from = START_BLOCK > 0n ? START_BLOCK : head > 200_000n ? head - 200_000n : 0n;
  const windows: [bigint, bigint][] = [];
  for (let b = from; b <= head; b += CHUNK) windows.push([b, b + CHUNK - 1n < head ? b + CHUNK - 1n : head]);

  const out: Activity[] = [];
  let done = 0;
  let next = 0;
  const addresses = [ADDR.factory, ADDR.market, ADDR.auction];
  async function worker() {
    while (next < windows.length) {
      const [a, b] = windows[next++];
      let logs;
      // a flaky window is retried a few times, then the whole scan fails loudly instead of showing wrong totals
      for (let attempt = 0; ; attempt++) {
        try {
          logs = await client.getLogs({ address: addresses, fromBlock: a, toBlock: b });
          break;
        } catch (e) {
          if (attempt >= 3) throw e;
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }
      for (const l of logs) {
        const act = toActivity(l);
        if (act) out.push(act);
      }
      onProgress?.(++done, windows.length);
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  out.sort((x, y) => (x.block === y.block ? 0 : x.block > y.block ? -1 : 1));
  const wallets = new Set<string>();
  let volume = 0n;
  let fees = 0n;
  let positions = 0;
  let sales = 0;
  let rescues = 0;
  for (const a of out) {
    a.wallets.forEach((w) => wallets.add(w.toLowerCase()));
    if (a.kind === "opened") positions++;
    if (a.kind === "sold") sales++;
    if (a.kind === "won") rescues++;
    if (a.kind === "sold" || a.kind === "won") {
      volume += a.amount;
      fees += a.fee;
    }
  }
  return { source: "chain", earlier: [], positions, volume, fees, wallets: wallets.size, outsideWallets: hasOutsider([...wallets]), sales, rescues, recent: out.slice(0, 12), fromBlock: from, toBlock: head };
}

function toActivity(l: { topics: readonly `0x${string}`[]; data: `0x${string}`; blockNumber: bigint; transactionHash: `0x${string}` }): Activity | null {
  let ev;
  try {
    ev = decodeEventLog({ abi: eventsAbi, topics: l.topics as [`0x${string}`], data: l.data });
  } catch {
    return null; // some other event (Claimed, Cancelled, Ended), not part of the numbers
  }
  const base = { block: l.blockNumber, tx: l.transactionHash };
  const a = ev.args as Record<string, unknown>;
  const tokenId = a.tokenId as bigint;
  switch (ev.eventName) {
    case "PositionCreated":
      return { ...base, kind: "opened", tokenId, wallets: [a.owner as Address], amount: 0n, fee: 0n };
    case "Listed":
      return { ...base, kind: "listed", tokenId, wallets: [a.seller as Address], amount: 0n, fee: 0n };
    case "Sold":
      return { ...base, kind: "sold", tokenId, wallets: [a.seller as Address, a.buyer as Address], amount: a.price as bigint, fee: a.fee as bigint };
    case "Started":
      return { ...base, kind: "auction", tokenId, wallets: [a.seller as Address], amount: 0n, fee: 0n };
    case "Won":
      return { ...base, kind: "won", tokenId, wallets: [a.seller as Address, a.winner as Address], amount: a.price as bigint, fee: a.fee as bigint };
  }
  return null;
}
