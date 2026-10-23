"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import type { PublicClient } from "viem";
import { deployed } from "./config";
import { loadPositions } from "./positions";

export function usePositions() {
  const client = usePublicClient();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["positions"],
    enabled: deployed && !!client,
    refetchInterval: 15_000,
    queryFn: () => loadPositions(client as PublicClient),
  });
  return { ...query, refresh: () => qc.invalidateQueries({ queryKey: ["positions"] }) };
}

/** Ticks once a second so countdowns and falling prices move. */
export function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
