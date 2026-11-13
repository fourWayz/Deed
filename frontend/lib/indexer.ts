import type { Address } from "viem";
import { CURRENT_VERSION, INDEXER_URL } from "./config";
import { hasOutsider } from "./team";
import type { Activity, Earlier, Stats } from "./stats";

const TIMEOUT_MS = 6_000;

async function getJson(path: string): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${INDEXER_URL}${path}`, { signal: ctl.signal });
    if (!r.ok) throw new Error(`indexer answered ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

type ApiStats = {
  positions: number;
  sales: number;
  rescues: number;
  unique_wallets: number;
  volume_musd_wei: string;
  fees_musd_wei: string;
  lastSyncedAt: string | null;
  by_version: { version: string; positions: number; volume_musd_wei: string; fees_musd_wei: string }[];
};
type ApiEvent = {
  version: string;
  name: string;
  token_id: string | null;
  args: Record<string, string>;
  volume: string;
  fee: string;
  block_number: number;
  tx_hash: `0x${string}`;
};

const KIND: Record<string, Activity["kind"]> = {
  PositionCreated: "opened",
  Listed: "listed",
  Sold: "sold",
  Started: "auction",
  Won: "won",
};

const big = (v: unknown): bigint => {
  try {
    return BigInt(String(v ?? "0"));
  } catch {
    throw new Error("indexer sent a number that is not a number");
  }
};

/**
 * Stats and recent activity from the indexer. Throws on anything unexpected (down, slow, wrong shape, or an indexer that
 * does not follow this deployment), the caller then falls back to counting events on chain. Totals cover every deployment
 * the indexer follows, with the earlier ones listed separately so they can be labelled.
 */
export async function fetchIndexerStats(): Promise<Stats> {
  const [stats, feed, pos] = await Promise.all([getJson("/stats"), getJson("/activity?limit=100"), getJson("/positions?limit=200")]);
  const s = stats as ApiStats;
  const events = (feed as { items?: ApiEvent[] }).items;
  if (typeof s?.positions !== "number" || !Array.isArray(s.by_version) || !Array.isArray(events)) {
    throw new Error("indexer answered with an unexpected shape");
  }
  // its totals would silently leave this deployment out, so an indexer that does not follow it counts as unusable
  if (!s.by_version.some((v) => v.version === CURRENT_VERSION)) throw new Error(`indexer does not follow ${CURRENT_VERSION}`);
  const seen = new Set<string>();
  for (const e of events) for (const w of [e.args?.owner, e.args?.seller, e.args?.buyer, e.args?.winner]) if (w) seen.add(w);
  for (const p of (pos as { items?: { creator?: string; owner?: string }[] }).items ?? []) {
    if (p.creator) seen.add(p.creator);
    if (p.owner) seen.add(p.owner);
  }
  const earlier: Earlier[] = s.by_version
    .filter((v) => v.version !== CURRENT_VERSION)
    .map((v) => ({ version: v.version, positions: v.positions, volume: big(v.volume_musd_wei), fees: big(v.fees_musd_wei) }));
  const recent: Activity[] = [];
  for (const e of events) {
    const kind = KIND[e.name];
    if (!kind || e.token_id === null) continue;
    const a = e.args ?? {};
    const wallets = [a.owner, a.seller, a.buyer, a.winner].filter((x): x is string => !!x) as Address[];
    recent.push({
      kind,
      version: e.version,
      tokenId: big(e.token_id),
      block: BigInt(e.block_number),
      tx: e.tx_hash,
      wallets,
      amount: kind === "sold" || kind === "won" ? big(e.volume) : 0n,
      fee: kind === "sold" || kind === "won" ? big(e.fee) : 0n,
    });
    if (recent.length === 12) break;
  }
  return {
    source: "indexer",
    lastSyncedAt: s.lastSyncedAt ?? null,
    outsideWallets: hasOutsider([...seen]),
    earlier,
    positions: s.positions,
    volume: big(s.volume_musd_wei),
    fees: big(s.fees_musd_wei),
    wallets: s.unique_wallets,
    sales: s.sales,
    rescues: s.rescues,
    recent,
    fromBlock: 0n,
    toBlock: 0n,
  };
}
