"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { Address, PublicClient } from "viem";
import { ADDR, auctionAbi, marketAbi } from "./config";

export type FeeQuote = { fee: bigint; known: boolean };

/** What the venue takes from a sale at this price, straight from its own feeFor. known is false until the read succeeds. */
export function useFee(venue: "market" | "auction", price: bigint | null): FeeQuote {
  const client = usePublicClient() as PublicClient;
  const address: Address = venue === "market" ? ADDR.market : ADDR.auction;
  const q = useQuery({
    queryKey: ["fee", venue, price?.toString() ?? "none"],
    enabled: price !== null && price > 0n,
    staleTime: 30_000,
    queryFn: () =>
      client.readContract({ address, abi: venue === "market" ? marketAbi : auctionAbi, functionName: "feeFor", args: [price!] }),
  });
  return q.data !== undefined ? { fee: q.data, known: true } : { fee: 0n, known: false };
}

/** The venues' fee rates and treasury, for the plain-language disclosure. */
export function useFeeTerms() {
  const client = usePublicClient() as PublicClient;
  return useQuery({
    queryKey: ["feeTerms"],
    staleTime: 300_000,
    queryFn: async () => {
      const [market, auction, treasury] = await Promise.all([
        client.readContract({ address: ADDR.market, abi: marketAbi, functionName: "feeBps" }),
        client.readContract({ address: ADDR.auction, abi: auctionAbi, functionName: "feeBps" }),
        client.readContract({ address: ADDR.market, abi: marketAbi, functionName: "treasury" }),
      ]);
      return { market, auction, treasury };
    },
  });
}
