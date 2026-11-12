"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { PublicClient } from "viem";
import { deployed } from "./config";
import { scanActivity } from "./stats";

/** Totals and recent activity read from chain events, cached so the landing and activity pages share one scan. */
export function useStats() {
  const client = usePublicClient();
  const [progress, setProgress] = useState(0);
  const query = useQuery({
    queryKey: ["stats"],
    enabled: deployed && !!client,
    staleTime: 120_000,
    refetchInterval: 120_000,
    retry: 1,
    queryFn: async () => {
      setProgress(0);
      return scanActivity(client as PublicClient, (d, t) => setProgress(d / t));
    },
  });
  return { ...query, progress };
}
