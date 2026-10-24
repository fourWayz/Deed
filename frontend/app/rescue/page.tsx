"use client";

import { deployed } from "@/lib/config";
import { usePositions, useNow } from "@/lib/usePositions";
import { auctionPriceAt, type Position } from "@/lib/positions";
import { fmt, fmtDuration, fmtMUSD, fmtPct } from "@/lib/format";
import { PositionCard } from "@/components/PositionCard";
import { BidButton, StartRescueButton } from "@/components/Actions";
import { ErrorBox, NotDeployed, Reveal, Skeletons, Stat, Ticker } from "@/components/ui";
import { PRICE_SOURCE_MESSAGE } from "@/lib/priceSource";

function AuctionBody({
  p,
  safeICR,
  now,
  paused,
  onDone,
}: {
  p: Position;
  safeICR: bigint;
  now: number;
  paused: boolean;
  onDone: () => void;
}) {
  const a = p.auction!;
  const end = Number(a.start + a.duration);
  const left = end - now;
  const price = auctionPriceAt(a, now);
  const elapsed = Math.min(1, Math.max(0, (now - Number(a.start)) / Number(a.duration)));
  return (
    <>
      <div className="muted" style={{ fontSize: 12.5 }}>
        Current price
      </div>
      <div className="big">
        <Ticker value={Number(price) / 1e18} format={(n) => `${fmt(BigInt(Math.round(n * 1e6)) * 10n ** 12n, 2)} MUSD`} />
      </div>
      <div className="bar" style={{ margin: "10px 0" }}>
        <div style={{ width: `${(1 - elapsed) * 100}%` }} />
      </div>
      <div className="stats" style={{ marginTop: 0 }}>
        <Stat k="Starts at" v={fmtMUSD(a.startPrice)} />
        <Stat k="Floor" v={fmtMUSD(a.floorPrice)} />
        <Stat k="Time left" v={left > 0 ? fmtDuration(left) : "ended"} />
        <Stat k="Winner leaves ICR ≥" v={fmtPct(safeICR)} />
      </div>
      {left > 0 ? (
        <BidButton p={p} safeICR={safeICR} paused={paused} onDone={onDone} />
      ) : (
        <div className="muted">Auction over. Anyone can end it to return the Deed.</div>
      )}
    </>
  );
}

export default function Rescue() {
  const { data, isLoading, error, refresh, refetch } = usePositions();
  const now = useNow();
  const live = data?.positions.filter((p) => p.auction && p.status === 1) ?? [];
  const atRisk =
    data?.positions.filter((p) => !p.auction && !p.listing && p.status === 1 && p.icr !== null && p.icr < data.rescueICR) ?? [];

  return (
    <>
      <h1>Rescue</h1>
      <p className="lede">
        Positions near liquidation can be auctioned. The price starts at the owner's equity and falls to a floor. The winner pays the
        old owner in MUSD and adds BTC in the same transaction so the position ends up safely collateralised.
      </p>
      {!deployed && <NotDeployed />}
      {isLoading && <Skeletons />}
      {error && <ErrorBox error={error} retry={() => refetch()} />}
      {data && data.price === null && (
        <div className="notice">The Mezo oracle looks stale right now, so bids and new auctions are paused until it updates.</div>
      )}

      {data && data.priceSourceOk === false && <div className="notice">{PRICE_SOURCE_MESSAGE}</div>}

      {data && (
        <div className="stack" style={{ gap: 22 }}>
          <h2>Live auctions</h2>
          {live.length === 0 && <div className="glass empty">No auctions are running.</div>}
          <Reveal className="grid">
            {live.map((p) => (
              <PositionCard key={p.id.toString()} p={p} rescueICR={data.rescueICR}>
                <AuctionBody p={p} safeICR={data.safeICR} now={now} paused={data.priceSourceOk === false} onDone={refresh} />
              </PositionCard>
            ))}
          </Reveal>

          <h2>At risk (ICR under {fmtPct(data.rescueICR)})</h2>
          {atRisk.length === 0 && <div className="glass empty">No position is under the rescue line.</div>}
          <Reveal className="grid">
            {atRisk.map((p) => (
              <PositionCard key={p.id.toString()} p={p} rescueICR={data.rescueICR}>
                <StartRescueButton p={p} paused={data.priceSourceOk === false} onDone={refresh} />
              </PositionCard>
            ))}
          </Reveal>
        </div>
      )}
    </>
  );
}
