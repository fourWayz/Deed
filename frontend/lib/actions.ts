import { encodeAbiParameters, keccak256, type Address, type PublicClient } from "viem";
import { ADDR, erc20Abi } from "./config";
import type { Position } from "./positions";

/** Same hash DeedMarket.snapshot builds: (coll, principal, rate, minICR) */
export function snapshotHash(p: Position, minICR: bigint): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "uint16" }, { type: "uint256" }],
      [p.coll, p.principal, p.rate, minICR],
    ),
  );
}

type Write = (args: {
  address: Address;
  abi: typeof erc20Abi;
  functionName: "approve";
  args: [Address, bigint];
}) => Promise<`0x${string}`>;

/** Approves MUSD for a spender if the current allowance is too low. */
export async function ensureAllowance(
  client: PublicClient,
  write: Write,
  owner: Address,
  spender: Address,
  amount: bigint,
  wait: (hash: `0x${string}`) => Promise<void>,
) {
  const allowance = await client.readContract({
    address: ADDR.musd,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  });
  if (allowance >= amount) return;
  const hash = await write({ address: ADDR.musd, abi: erc20Abi, functionName: "approve", args: [spender, amount] });
  await wait(hash);
}
