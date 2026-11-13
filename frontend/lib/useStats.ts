"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { PublicClient } from "viem";
import { INDEXER_URL, deployed } from "./config";
import { scanActivity, type Stats } from "./stats";
import { fetchIndexerStats } from "./indexer";

export type StatsResult = Stats & {
  // set when an indexer is configured but could not be used, so the page can say the numbers are the fallback
  indexerDown: boolean;
};

/**
 * Totals and recent activity. The indexer when NEXT_PUBLIC_INDEXER_URL is set and answering, otherwise a scan of this
 * deployment's own events on chain. Cached so the landing and activity pages share one read.
 */
export function useStats() {
  const client = usePublicClient();
  const [progress, setProgress] = useState(0);
  const query = useQuery({
    queryKey: ["stats", INDEXER_URL],
    enabled: deployed && !!client,
    staleTime: 120_000,
    refetchInterval: 120_000,
    retry: 1,
    queryFn: async (): Promise<StatsResult> => {
      let down = false;
      if (INDEXER_URL) {
        try {
          return { ...(await fetchIndexerStats()), indexerDown: false };
        } catch {
          down = true;
        }
      }
      setProgress(0);
      const s = await scanActivity(client as PublicClient, (d, t) => setProgress(d / t));
      return { ...s, indexerDown: down };
    },
  });
  return { ...query, progress };
}
