import { formatUnits, parseUnits } from "viem";
import { PRICE_SOURCE_MESSAGE } from "./priceSource";

export function fmt(v: bigint, digits = 2, decimals = 18): string {
  const n = Number(formatUnits(v, decimals));
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export const fmtMUSD = (v: bigint) => `${fmt(v, 2)} MUSD`;
export const fmtBTC = (v: bigint) => `${fmt(v, 5)} BTC`;

/** ICR comes as 1e18 fixed point, 1.5e18 = 150% */
export function fmtPct(v: bigint | null | undefined): string {
  if (v === null || v === undefined) return "n/a";
  if (v > 10n ** 24n) return "no debt";
  return `${(Number(formatUnits(v, 18)) * 100).toFixed(1)}%`;
}

export const fmtRate = (bps: number) => `${(bps / 100).toFixed(2)}%`;

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function parseAmount(s: string): bigint | null {
  try {
    if (!s || Number(s) <= 0) return null;
    return parseUnits(s as `${number}`, 18);
  } catch {
    return null;
  }
}

export function fmtDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0s";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Fixed-width clock for a countdown (02:14:05), so the digits do not jitter as it ticks. */
export function fmtClock(totalSeconds: number): string {
  const t = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(t % 60)}`;
}

/** Time left in the two biggest units that matter: "3d 4h", "5h 12m", "42s". */
export function fmtLeft(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0s";
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${Math.floor(totalSeconds % 60)}s`;
  return `${Math.floor(totalSeconds)}s`;
}

const FRIENDLY: Record<string, string> = {
  SnapshotMismatch: "The position changed since you looked at it. Refresh and check the new numbers before buying.",
  Expired: "This listing or auction has ended.",
  NotExpired: "This can only be done once the listing or auction has run out.",
  PriceTooHigh: "The price is above the maximum you agreed to.",
  IcrTooLow: "The position is now below the collateral ratio the seller promised.",
  StillRisky: "That top-up is too small. The position would still be too close to liquidation.",
  SpotDeviation: PRICE_SOURCE_MESSAGE,
  NotAllowed: "A rescue someone else started can only be cancelled once the position is back above the rescue line. Add collateral first.",
  RecoveryModeActive: "Mezo is in Recovery Mode, which switches this action off until the system recovers.",
  NothingToClaim: "Nothing to claim.",
  NotController: "This position is locked by a listing or auction, or you do not hold its Deed.",
  Locked: "This Deed is locked by a listing or auction.",
  AlreadyLocked: "This Deed is already in a listing or auction.",
  NotListed: "That listing no longer exists.",
  AlreadyListed: "This Deed is already listed.",
  AlreadyRunning: "An auction is already running for this Deed.",
  NotRunning: "There is no running auction for this Deed.",
  NoEquity: "This position has no equity to sell.",
  Healthy: "This position is not under the rescue line.",
  NotOwner: "Only the Deed holder can do this.",
  NotSeller: "Only the seller can do this right now.",
  NotActive: "The trove behind this Deed is closed or liquidated.",
  BadMinICR: "The promised minimum ICR must be at least 110% and no higher than the position has now.",
  BadExpiry: "The expiry has to be in the future.",
  BadPrice: "The price has to be above zero.",
  BadParams: "Those settings are outside what the contract allows.",
};

export function errMessage(e: unknown): string {
  const err = e as {
    shortMessage?: string;
    message?: string;
    walk?: (fn: (x: unknown) => boolean) => { data?: { errorName?: string } } | null;
  };
  const inner = err.walk?.((x) => !!(x as { data?: { errorName?: string } })?.data?.errorName);
  const name = inner?.data?.errorName;
  if (name && FRIENDLY[name]) return FRIENDLY[name];
  return cleanMessage(err.shortMessage ?? err.message);
}

/**
 * Wallet and RPC errors sometimes carry a bare 4-byte selector or a wall of request details. People should get a sentence,
 * never `0x1f2a3b4c`, so anything with that shape is replaced.
 */
export function cleanMessage(raw: string | undefined): string {
  if (!raw) return "Something went wrong. Try again.";
  if (/0x[0-9a-fA-F]{8}\b/.test(raw) && !/0x[0-9a-fA-F]{9,}/.test(raw.replace(/0x[0-9a-fA-F]{8}\b/g, ""))) {
    return "The contract refused this action. Refresh the numbers and try again.";
  }
  if (/User rejected|User denied|rejected the request/i.test(raw)) return "You rejected the request in your wallet.";
  const reason = raw.match(/reverted with the following reason:\s*\n?\s*([^\n]+)/i);
  if (reason) return `The contract refused this action: ${reason[1].trim()}`;
  if (/reverted with the following signature|unrecognized selector|custom error|reverted/i.test(raw)) {
    return "The contract refused this action. Refresh the numbers and try again.";
  }
  const first = raw.split("\n")[0].trim();
  return first.length > 160 ? `${first.slice(0, 157)}…` : first;
}
