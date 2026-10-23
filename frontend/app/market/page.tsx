"use client";

import { deployed } from "@/lib/config";
import { usePositions, useNow } from "@/lib/usePositions";
import { fmtDuration, fmtMUSD, fmtPct } from "@/lib/format";
import { PositionCard } from "@/components/PositionCard";
import { BuyButton } from "@/components/Actions";
import { ErrorBox, NotDeployed, Reveal, Skeletons, Stat } from "@/components/ui";

export default function Market() {
  const { data, isLoading, error, refresh, refetch } = usePositions();
  const now = useNow();
  const listed = data?.positions.filter((p) => p.listing && p.status === 1) ?? [];

  return (
    <>
      <h1>Market</h1>
      <p className="lede">
        Positions for sale at a fixed MUSD price. Each listing stores a snapshot of the collateral, debt and rate. If the position
        changes before your purchase lands, the purchase reverts instead of selling you something different.
      </p>
      {!deployed && <NotDeployed />}
      {isLoading && <Skeletons />}
      {error && <ErrorBox error={error} retry={() => refetch()} />}
      {data && listed.length === 0 && <div className="glass empty">Nothing is listed right now.</div>}
      {data && (
        <Reveal className="grid">
          {listed.map((p) => {
            const l = p.listing!;
            const left = Number(l.expiry) - now;
            const edge = p.equity === null ? null : p.equity - l.price;
            return (
              <PositionCard key={p.id.toString()} p={p} rescueICR={data.rescueICR}>
                <div className="stats" style={{ marginTop: 0 }}>
                  <Stat k="Price" v={fmtMUSD(l.price)} />
                  <Stat k="Seller promises ICR ≥" v={fmtPct(l.minICR)} />
                  <Stat k="Equity vs price" v={edge === null ? "n/a" : `${edge >= 0n ? "+" : "−"}${fmtMUSD(edge >= 0n ? edge : -edge)}`} />
                  <Stat k="Expires in" v={left > 0 ? fmtDuration(left) : "expired"} />
                </div>
                <BuyButton p={p} onDone={refresh} />
              </PositionCard>
            );
          })}
        </Reveal>
      )}
    </>
  );
}
