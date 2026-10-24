/** What the app shows when the DEX price and the Mezo oracle disagree by more than the auction allows. */
export const PRICE_SOURCE_MESSAGE = "Price source out of range, try again shortly.";

/**
 * Same test RescueAuction runs before it acts: |spot - oracle| * 10_000 <= oracle * maxDeviationBps.
 * Doing it here lets the page say so before anyone signs, the contract still enforces it.
 */
export function priceSourceInRange(oracle: bigint, spot: bigint, maxDeviationBps: bigint): boolean {
  const gap = spot > oracle ? spot - oracle : oracle - spot;
  return gap * 10_000n <= oracle * maxDeviationBps;
}
