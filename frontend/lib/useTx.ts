"use client";

import { useCallback, useState } from "react";
import { usePublicClient } from "wagmi";
import { errMessage } from "./format";

export type TxState =
  | { status: "idle" }
  | { status: "wallet" }
  | { status: "pending"; hash: `0x${string}` }
  | { status: "done"; hash: `0x${string}` }
  | { status: "error"; message: string };

/** Runs one or more wallet transactions in order and tracks them for the UI. */
export function useTx(onDone?: () => void) {
  const client = usePublicClient();
  const [state, setState] = useState<TxState>({ status: "idle" });

  const run = useCallback(
    async (send: (wait: (hash: `0x${string}`) => Promise<void>) => Promise<`0x${string}`>) => {
      setState({ status: "wallet" });
      try {
        const wait = async (hash: `0x${string}`) => {
          setState({ status: "pending", hash });
          const r = await client!.waitForTransactionReceipt({ hash });
          if (r.status !== "success") throw new Error("Transaction reverted");
        };
        const hash = await send(wait);
        await wait(hash);
        setState({ status: "done", hash });
        onDone?.();
      } catch (e) {
        setState({ status: "error", message: errMessage(e) });
      }
    },
    [client, onDone],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);
  return { state, run, reset, busy: state.status === "wallet" || state.status === "pending" };
}
