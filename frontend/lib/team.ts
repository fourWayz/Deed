import { TEAM_WALLETS } from "./config";

/**
 * True when any of these addresses is not one of the team's test wallets. With no team list configured nothing can be
 * called "outside", so the label stays on, which is the cautious way round.
 */
export function hasOutsider(addresses: string[]): boolean {
  if (TEAM_WALLETS.length === 0) return false;
  return addresses.some((a) => !TEAM_WALLETS.includes(a.toLowerCase()));
}
