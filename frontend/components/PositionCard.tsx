"use client";

import Link from "next/link";
import { fmtBTC, fmtMUSD, fmtPct, fmtRate, short } from "@/lib/format";
import type { Position } from "@/lib/positions";
import { CopyButton, Stat } from "./ui";

export function icrTone(icr: bigint | null, rescueICR: bigint): "good" | "warn" | "bad" {
  if (icr === null) return "warn";
  if (icr < 11n * 10n ** 17n) return "bad";
  if (icr < rescueICR) return "warn";
  return "good";
}

export function StatusPill({ p }: { p: Position }) {
  if (p.status !== 1) return <span className="pill bad">{p.status === 3 ? "liquidated" : p.status === 4 ? "redeemed" : "closed"}</span>;
  if (p.auction) return <span className="pill warn">in rescue auction</span>;
  if (p.listing) return <span className="pill">listed</span>;
  return <span className="pill good">open</span>;
}

export function PositionCard({
  p,
  rescueICR,
  href,
  flat,
  children,
}: {
  p: Position;
  rescueICR: bigint;
  href?: string;
  // no hover lift, for a card that is not a link target (the position page's own header)
  flat?: boolean;
  children?: React.ReactNode;
}) {
  const tone = icrTone(p.icr, rescueICR);
  return (
    <div className={`glass${flat ? "" : " card"}`}>
      <div className="row">
        <Link href={href ?? `/position/${p.id}`} style={{ fontWeight: 800, fontSize: "var(--fs-md)", fontFamily: "var(--font-heading)" }}>
          Deed #{p.id.toString()}
        </Link>
        <StatusPill p={p} />
      </div>
      <div className="muted mono" style={{ marginTop: 4 }}>
        owner {short(p.owner)}
        <CopyButton value={p.owner} label="owner address" />
      </div>
      <div className="stats">
        <Stat k="Collateral" v={fmtBTC(p.collateral)} />
        <Stat k="Debt" v={fmtMUSD(p.debt)} />
        <Stat k="ICR" v={<span className={`pill ${tone}`}>{fmtPct(p.icr)}</span>} />
        <Stat k="Rate" v={fmtRate(p.rate)} />
        <Stat k="Implied equity" v={p.equity === null ? "n/a" : fmtMUSD(p.equity)} />
      </div>
      {children}
    </div>
  );
}
