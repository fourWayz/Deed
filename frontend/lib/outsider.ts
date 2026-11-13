/**
 * True when any address is not on the team list. With an empty list nothing can be called "outside", so the team label
 * stays on, which is the cautious way round.
 */
export function anyOutside(addresses: string[], team: string[]): boolean {
  if (team.length === 0) return false;
  const t = new Set(team.map((a) => a.toLowerCase()));
  return addresses.some((a) => !t.has(a.toLowerCase()));
}
