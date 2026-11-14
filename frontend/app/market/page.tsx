"use client";

import { useMemo, useState } from "react";
import { deployed } from "@/lib/config";
import { usePositions, useNow } from "@/lib/usePositions";
import { fmtLeft, fmtMUSD, fmtPct } from "@/lib/format";
import { PositionCard } from "@/components/PositionCard";
import { BuyButton } from "@/components/Actions";
import { Empty, ErrorBox, NotDeployed, Reveal, Skeletons, Stat } from "@/components/ui";

type Sort = "new" | "price" | "equity" | "ending" | "icr";
type Filter = "all" | "healthy" | "under" | "day";

const SORTS: [Sort, string][] = [
  ["new", "Newest"],
  ["price", "Lowest price"],
  ["equity", "Best equity vs price"],
  ["ending", "Ending soon"],
  ["icr", "Highest ICR"],
];
const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["healthy", "Above the rescue line"],
  ["under", "Priced under equity"],
  ["day", "Ends within a day"],
];

export default function Market() {
  const { data, isLoading, error, refresh, refetch } = usePositions();
  const now = useNow();
  const [sort, setSort] = useState<Sort>("new");
  const [filter, setFilter] = useState<Filter>("all");
  const all = useMemo(() => data?.positions.filter((p) => p.listing && p.status === 1) ?? [], [data]);

  const shown = useMemo(() => {
    const edge = (p: (typeof all)[number]) => (p.equity === null ? null : p.equity - p.listing!.price);
    const list = all.filter((p) => {
      if (filter === "healthy") return p.icr !== null && data !== undefined && p.icr >= data.rescueICR;
      if (filter === "under") return (edge(p) ?? -1n) >= 0n;
      if (filter === "day") return Number(p.listing!.expiry) - now < 86400;
      return true;
    });
    const cmp = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);
    return [...list].sort((a, b) => {
      if (sort === "price") return cmp(a.listing!.price, b.listing!.price);
      if (sort === "equity") return cmp(edge(b) ?? -(10n ** 30n), edge(a) ?? -(10n ** 30n));
      if (sort === "ending") return cmp(a.listing!.expiry, b.listing!.expiry);
      if (sort === "icr") return cmp(b.icr ?? 0n, a.icr ?? 0n);
      return cmp(b.id, a.id);
    });
  }, [all, sort, filter, now, data]);

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
      {data && all.length === 0 && (
        <Empty art="market" title="Nothing is listed right now">
          When a holder lists a position it shows up here with its price, its snapshot and what it is worth.
        </Empty>
      )}
      {data && all.length > 0 && (
        <>
          <div className="toolbar" role="group" aria-label="Sort and filter listings">
            <div className="chips" role="group" aria-label="Sort by">
              <span className="chip-label">Sort</span>
              {SORTS.map(([k, label]) => (
                <button key={k} type="button" className="chip" aria-pressed={sort === k} onClick={() => setSort(k)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="chips" role="group" aria-label="Filter">
              <span className="chip-label">Show</span>
              {FILTERS.map(([k, label]) => (
                <button key={k} type="button" className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="muted" style={{ fontSize: "var(--fs-sm)", margin: "0 0 var(--s-3)" }} aria-live="polite">
            Showing {shown.length} of {all.length} {all.length === 1 ? "listing" : "listings"}
          </div>
        </>
      )}
      {data && all.length > 0 && shown.length === 0 && (
        <Empty art="list" title="No listing matches">
          Nothing fits those filters right now. Try “All” to see every listing.
        </Empty>
      )}
      {data && shown.length > 0 && (
        <Reveal className="grid">
          {shown.map((p) => {
            const l = p.listing!;
            const left = Number(l.expiry) - now;
            const edge = p.equity === null ? null : p.equity - l.price;
            return (
              <PositionCard key={p.id.toString()} p={p} rescueICR={data.rescueICR}>
                <div className="stats" style={{ marginTop: 0 }}>
                  <Stat k="Price" v={fmtMUSD(l.price)} />
                  <Stat k="Seller promises ICR ≥" v={fmtPct(l.minICR)} />
                  <Stat k="Equity vs price" v={edge === null ? "n/a" : `${edge >= 0n ? "+" : "−"}${fmtMUSD(edge >= 0n ? edge : -edge)}`} />
                  <Stat k="Expires in" v={left > 0 ? fmtLeft(left) : "expired"} />
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
