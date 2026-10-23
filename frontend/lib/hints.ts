import type { Address, PublicClient } from "viem";
import { ADDR, ZERO, hintHelpersAbi, sortedTrovesAbi } from "./config";

export type Hints = { upper: Address; lower: Address };

/**
 * Finds the neighbours in SortedTroves for a trove ending up with this collateral and principal.
 * Wrong or missing hints only cost gas, so any failure falls back to zero addresses.
 */
export async function getHints(client: PublicClient, coll: bigint, principal: bigint): Promise<Hints> {
  try {
    const nicr = await client.readContract({
      address: ADDR.hintHelpers,
      abi: hintHelpersAbi,
      functionName: "computeNominalCR",
      args: [coll, principal],
    });
    const size = await client.readContract({ address: ADDR.sortedTroves, abi: sortedTrovesAbi, functionName: "getSize" });
    const trials = BigInt(Math.max(15, Math.ceil(15 * Math.sqrt(Number(size)))));
    const [hint] = await client.readContract({
      address: ADDR.hintHelpers,
      abi: hintHelpersAbi,
      functionName: "getApproxHint",
      args: [nicr, trials, 42n],
    });
    const [upper, lower] = await client.readContract({
      address: ADDR.sortedTroves,
      abi: sortedTrovesAbi,
      functionName: "findInsertPosition",
      args: [nicr, hint, hint],
    });
    return { upper, lower };
  } catch {
    return { upper: ZERO, lower: ZERO };
  }
}
