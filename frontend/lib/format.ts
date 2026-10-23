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

export function errMessage(e: unknown): string {
  const any = e as { shortMessage?: string; message?: string };
  return any.shortMessage ?? any.message ?? "Something went wrong";
}
