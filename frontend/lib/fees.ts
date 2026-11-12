"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Address, PublicClient } from "viem";
import { ADDR, VAULT_HAS_BORROW, feeAbi } from "./config";

export type FeeQuote = { fee: bigint; known: boolean };

/**
 * What the venue takes from a sale at this price. v3 venues answer feeFor(price). The v2 venues have no fee and no such
 * function, so with the v3 switch off the answer is a known zero. With it on, a failed read is reported as unknown
 * instead of pretending the fee is zero.
 */
export function useFee(venue: "market" | "auction", price: bigint | null): FeeQuote {
  const client = usePublicClient() as PublicClient;
  const address: Address = venue === "market" ? ADDR.market : ADDR.auction;
  const q = useQuery({
    queryKey: ["fee", venue, price?.toString() ?? "none"],
    enabled: VAULT_HAS_BORROW && price !== null && price > 0n,
    queryFn: () => client.readContract({ address, abi: feeAbi, functionName: "feeFor", args: [price!] }),
  });
  if (!VAULT_HAS_BORROW) return { fee: 0n, known: true };
  if (q.data !== undefined) return { fee: q.data, known: true };
  return { fee: 0n, known: false };
}
