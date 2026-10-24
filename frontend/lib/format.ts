import { formatUnits, parseUnits } from "viem";

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

const FRIENDLY: Record<string, string> = {
  SnapshotMismatch: "The position changed since you looked at it. Refresh and check the new numbers before buying.",
  Expired: "This listing or auction has ended.",
  NotExpired: "This can only be done once the listing or auction has run out.",
  PriceTooHigh: "The price is above the maximum you agreed to.",
  IcrTooLow: "The position is now below the collateral ratio the seller promised.",
  StillRisky: "That top-up is too small. The position would still be too close to liquidation.",
  SpotDeviation: "The Mezo oracle and the DEX disagree too much right now, so this is paused. Try again later.",
  NotAllowed: "A rescue someone else started can only be cancelled once the position is back above the rescue line. Add collateral first.",
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
  NothingToClaim: "Nothing to claim.",
  BadMinICR: "The promised minimum ICR must be at least 110% and no higher than the position has now.",
  BadExpiry: "The expiry has to be in the future.",
  BadPrice: "The price has to be above zero.",
  BadParams: "Those auction settings are outside the allowed range.",
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
  return err.shortMessage ?? err.message ?? "Something went wrong";
}
