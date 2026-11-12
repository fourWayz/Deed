"use client";

import { useAccount, usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import type { PublicClient } from "viem";
import { ADDR, deployed, marketAbi, auctionAbi } from "@/lib/config";
import { usePositions } from "@/lib/usePositions";
import { fmtMUSD } from "@/lib/format";
import { useTx } from "@/lib/useTx";
import { useSafeWrite } from "@/lib/useSafeWrite";
import { PositionCard } from "@/components/PositionCard";
import { CreatePosition } from "@/components/Actions";
import { ErrorBox, NotDeployed, Reveal, Skeletons, TxButton } from "@/components/ui";

function Proceeds({ address }: { address: `0x${string}` }) {
  const client = usePublicClient() as PublicClient;
  const write = useSafeWrite();
  const q = useQuery({
    queryKey: ["proceeds", address],
    refetchInterval: 20_000,
    queryFn: async () => {
      const [m, a] = await Promise.all([
        client.readContract({ address: ADDR.market, abi: marketAbi, functionName: "claimable", args: [address] }),
        client.readContract({ address: ADDR.auction, abi: auctionAbi, functionName: "claimable", args: [address] }),
      ]);
      return { m, a };
    },
  });
  const done = () => q.refetch();
  const m = useTx(done);
  const a = useTx(done);
  // keep the panel while a claim just went through, so the confirmation stays on screen
  const justClaimed = m.state.status === "done" || a.state.status === "done";
  if (!q.data || (q.data.m === 0n && q.data.a === 0n && !justClaimed)) return null;
  return (
    <div className="glass row" style={{ marginBottom: 18, flexWrap: "wrap" }}>
      <div>
        <b>Sale proceeds waiting</b>
        <div className="muted" style={{ fontSize: 13 }}>
          Payments are pulled, nothing is sent until you claim.
        </div>
      </div>
      <div className="row">
        {(q.data.m > 0n || m.state.status === "done") && (
          <TxButton
            label={`Claim ${fmtMUSD(q.data.m)} (market)`}
            state={m.state}
            onClick={() => m.run(() => write({ address: ADDR.market, abi: marketAbi, functionName: "claim" }))}
          />
        )}
        {(q.data.a > 0n || a.state.status === "done") && (
          <TxButton
            label={`Claim ${fmtMUSD(q.data.a)} (auction)`}
            state={a.state}
            onClick={() => a.run(() => write({ address: ADDR.auction, abi: auctionAbi, functionName: "claim" }))}
          />
        )}
      </div>
    </div>
  );
}

export default function MyPositions() {
  const { address, isConnected } = useAccount();
  const { data, isLoading, error, refresh, refetch } = usePositions();

  const mine = data?.positions.filter((p) => address && p.owner.toLowerCase() === address.toLowerCase()) ?? [];

  return (
    <>
      <h1>My positions</h1>
      <p className="lede">
        Open a Mezo borrowing position inside its own vault. The Deed NFT is the key to it: whoever holds the Deed controls the
        collateral and the debt, and can sell it.
      </p>

      {!deployed && <NotDeployed />}
      {deployed && !isConnected && <div className="notice">Connect a wallet to open or manage positions.</div>}
      {isConnected && address && <Proceeds address={address} />}

      {deployed && (
        <div className="stack" style={{ gap: 22 }}>
          <CreatePosition price={data?.price ?? null} onDone={refresh} />
          <h2 style={{ marginTop: 10 }}>Your Deeds</h2>
          {isLoading && <Skeletons />}
          {error && <ErrorBox error={error} retry={() => refetch()} />}
          {data && mine.length === 0 && isConnected && <div className="glass empty">No positions yet. Open one above.</div>}
          {data && (
            <Reveal className="grid">
              {mine.map((p) => (
                <PositionCard key={p.id.toString()} p={p} rescueICR={data.rescueICR} />
              ))}
            </Reveal>
          )}
        </div>
      )}
    </>
  );
}
