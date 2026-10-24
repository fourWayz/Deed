"use client";

import { useCallback } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import type { Abi, Address, PublicClient } from "viem";

export type WriteReq = {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};

// Lowest gas limit we will send. Unused gas is refunded and gas is very cheap on Mezo.
const FLOOR_DEFAULT = 700_000n;
const FLOOR_CREATE = 2_500_000n; // deploys a vault and opens a trove

/**
 * The Mezo testnet RPC sometimes answers eth_estimateGas with the bare 21k transaction cost, even for calls that need
 * hundreds of thousands (see scripts/estimate-probe.mjs). A wallet that trusts that sends a transaction that runs out
 * of gas. So: simulate first (eth_call, gives a readable revert), take the largest of a few estimates, never go
 * under a floor, and send with an explicit gas limit.
 */
export function useSafeWrite() {
  const { address } = useAccount();
  const client = usePublicClient() as PublicClient;
  const { writeContractAsync } = useWriteContract();

  return useCallback(
    async (req: WriteReq): Promise<`0x${string}`> => {
      const call = req as never as Parameters<PublicClient["simulateContract"]>[0];
      await client.simulateContract({ ...call, account: address } as never);

      let best = 0n;
      for (let i = 0; i < 3; i++) {
        try {
          const g = await client.estimateContractGas({ ...call, account: address } as never);
          if (g > best) best = g;
        } catch {
          // an estimate that fails after a good simulation is the RPC misbehaving, the floor covers it
        }
      }
      const floor = (req as { functionName?: string }).functionName === "createPosition" ? FLOOR_CREATE : FLOOR_DEFAULT;
      const gas = (best * 13n) / 10n > floor ? (best * 13n) / 10n : floor;
      return writeContractAsync({ ...req, gas } as never);
    },
    [address, client, writeContractAsync],
  );
}
