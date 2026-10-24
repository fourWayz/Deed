"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useAccount, usePublicClient } from "wagmi";
import type { PublicClient } from "viem";
import { ADDR, auctionAbi, deployed, EXPLORER } from "@/lib/config";
import { usePositions, useNow } from "@/lib/usePositions";
import { fmtDuration, fmtMUSD, fmtPct, parseAmount, short } from "@/lib/format";
import { getHints } from "@/lib/hints";
import { useTx } from "@/lib/useTx";
import { useSafeWrite } from "@/lib/useSafeWrite";
import { PositionCard } from "@/components/PositionCard";
import { BuyButton, ManagePanel } from "@/components/Actions";
import { ErrorBox, NotDeployed, Skeletons, Stat, TxButton } from "@/components/ui";

function SellerAuctionTools({ id, coll, principal, onDone }: { id: bigint; coll: bigint; principal: bigint; onDone: () => void }) {
  const client = usePublicClient() as PublicClient;
  const writeContractAsync = useSafeWrite();
  const [amount, setAmount] = useState("");
  const top = useTx(onDone);
  const amt = parseAmount(amount);
  return (
    <div className="glass stack">
      <h2>Top up during auction</h2>
      <div className="muted" style={{ fontSize: 13 }}>
        Add BTC to lift the position back above the rescue line. Once it is above, you can cancel the auction.
      </div>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="BTC" inputMode="decimal" />
      <TxButton
        label="Add collateral"
        state={top.state}
        disabled={!amt}
        onClick={() =>
          top.run(async () => {
            const hints = await getHints(client, coll + amt!, principal);
            return writeContractAsync({
              address: ADDR.auction,
              abi: auctionAbi,
              functionName: "topUp",
              args: [id, hints.upper, hints.lower],
              value: amt!,
            });
          })
        }
      />
    </div>
  );
}

export default function PositionPage() {
  const params = useParams<{ id: string }>();
  const { address } = useAccount();
  const { data, isLoading, error, refresh, refetch } = usePositions();
  const now = useNow();
  const id = BigInt(params.id);
  const p = data?.positions.find((x) => x.id === id);
  const mine = p && address && p.owner.toLowerCase() === address.toLowerCase();
  const endAuction = useTx(refresh);
  const writeContractAsync = useSafeWrite();

  return (
    <>
      <h1>Deed #{params.id}</h1>
      {!deployed && <NotDeployed />}
      {isLoading && <Skeletons n={1} />}
      {error && <ErrorBox error={error} retry={() => refetch()} />}
      {data && !p && <div className="glass empty">This Deed is not in the latest {60} positions or does not exist.</div>}

      {data && p && (
        <div className="stack" style={{ gap: 22 }}>
          <PositionCard p={p} rescueICR={data.rescueICR} href={`/position/${p.id}`}>
            <div className="stats" style={{ marginTop: 0 }}>
              <Stat
                k="Vault"
                v={
                  <a className="mono" href={`${EXPLORER}/address/${p.vault}`} target="_blank" rel="noreferrer">
                    {short(p.vault)}
                  </a>
                }
              />
              <Stat k="Stored principal" v={fmtMUSD(p.principal)} />
              <Stat k="Oracle price" v={data.price === null ? "stale" : fmtMUSD(data.price)} />
              <Stat k="Rescue line" v={fmtPct(data.rescueICR)} />
            </div>
            {p.listing && (
              <div className="notice" style={{ marginBottom: 0 }}>
                Listed for {fmtMUSD(p.listing.price)}, expires in {fmtDuration(Number(p.listing.expiry) - now)}.
              </div>
            )}
          </PositionCard>

          {p.listing && !mine && p.status === 1 && (
            <div className="glass">
              <BuyButton p={p} onDone={refresh} />
            </div>
          )}

          {p.auction && mine && !p.auction.byOwner && (
            <SellerAuctionTools id={p.id} coll={p.coll} principal={p.principal} onDone={refresh} />
          )}

          {p.auction && now >= Number(p.auction.start + p.auction.duration) && (
            <div className="glass row">
              <span className="muted">This auction has run out.</span>
              <TxButton
                label="End auction"
                variant="ghost"
                state={endAuction.state}
                onClick={() =>
                  endAuction.run(() => writeContractAsync({ address: ADDR.auction, abi: auctionAbi, functionName: "end", args: [p.id] }))
                }
              />
            </div>
          )}

          <ManagePanel p={p} safeICR={data.safeICR} minFloorBps={data.minFloorBps} onDone={refresh} />
        </div>
      )}
    </>
  );
}
