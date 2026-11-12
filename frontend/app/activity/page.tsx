"use client";

import { useStats } from "@/lib/useStats";
import { CURRENT_VERSION, deployed, EXPLORER } from "@/lib/config";
import { fmtMUSD, short } from "@/lib/format";
import type { Activity } from "@/lib/stats";
import { ErrorBox, NotDeployed, Skeletons, Stat, StatsSource } from "@/components/ui";

const LABEL: Record<Activity["kind"], string> = {
  opened: "Position opened",
  listed: "Listed for sale",
  sold: "Sold at a fixed price",
  auction: "Rescue auction started",
  won: "Rescue auction won",
};

export default function ActivityPage() {
  const { data: s, isLoading, error, refetch, progress, isFetching } = useStats();
  return (
    <>
      <h1>Activity</h1>
      <p className="lede">
        Everything the contracts have done since they were deployed, counted straight from chain events. Nothing here is
        estimated.
      </p>
      {!deployed && <NotDeployed />}
      {isLoading && (
        <>
          <Skeletons n={4} />
          <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
            Reading events from the chain… {Math.round(progress * 100)}%
          </div>
        </>
      )}
      {error && <ErrorBox error={error} retry={() => refetch()} what="activity" />}
      {s && (
        <div className="stack" style={{ gap: 22 }}>
          <div className="glass">
            <div className="stats four">
              <Stat k="Positions opened" v={s.positions.toLocaleString()} />
              <Stat k="Volume" v={fmtMUSD(s.volume)} />
              <Stat k="Fees paid" v={fmtMUSD(s.fees)} />
              <Stat k="Unique wallets" v={s.wallets.toLocaleString()} />
              <Stat k="Fixed price sales" v={s.sales.toLocaleString()} />
              <Stat k="Rescues won" v={s.rescues.toLocaleString()} />
            </div>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
              Volume is MUSD paid in sales and won auctions{isFetching ? ", refreshing…" : ""}.
            </div>
            <StatsSource s={s} indexerDown={s.indexerDown} />
          </div>

          <h2>Recent transactions</h2>
          {s.recent.length === 0 && <div className="glass empty">Nothing has happened on these contracts yet.</div>}
          {s.recent.length > 0 && (
            <div className="glass feed">
              {s.recent.map((a) => (
                <div className="feed-row" key={`${a.tx}-${a.kind}-${a.tokenId}`}>
                  <div>
                    <b>{LABEL[a.kind]}</b>
                    {a.version && a.version !== CURRENT_VERSION && <span className="pill" style={{ marginLeft: 8 }}>earlier deployment</span>}
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      Deed #{a.tokenId.toString()} · {a.wallets.map(short).join(" → ")}
                    </div>
                  </div>
                  <div className="feed-end">
                    {a.amount > 0n && <b>{fmtMUSD(a.amount)}</b>}
                    <a className="mono" href={`${EXPLORER}/tx/${a.tx}`} target="_blank" rel="noreferrer">
                      {short(a.tx)}
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
