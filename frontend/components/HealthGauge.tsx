"use client";

import { useEffect, useRef } from "react";
import { animate } from "animejs";

// the dial runs from 100% to 200% ICR, anything above reads as full
const MIN = 1.0;
const MAX = 2.0;
const R = 70;
const ARC = Math.PI * R; // half circle length

function pos(icr: number) {
  return Math.min(1, Math.max(0, (icr - MIN) / (MAX - MIN)));
}

/** Half-circle ICR dial with the liquidation, rescue and safe lines marked. */
export function HealthGauge({ icr, rescueICR, safeICR }: { icr: bigint | null; rescueICR: bigint; safeICR: bigint }) {
  const arc = useRef<SVGPathElement>(null);
  const val = icr === null || icr > 10n ** 24n ? null : Number(icr) / 1e18;
  const resc = Number(rescueICR) / 1e18;
  const safe = Number(safeICR) / 1e18;
  const tone = val === null ? "var(--muted)" : val < 1.1 ? "var(--bad)" : val < resc ? "var(--warn)" : "var(--good)";
  const label = val === null ? "no reading" : val < 1.1 ? "liquidatable" : val < resc ? "at risk" : val < safe ? "fine" : "healthy";

  useEffect(() => {
    const el = arc.current;
    if (!el) return;
    const target = ARC * (1 - (val === null ? 0 : pos(val)));
    const a = animate(el, { strokeDashoffset: [ARC, target], duration: 900, ease: "outExpo" });
    return () => {
      a.pause();
      el.style.strokeDashoffset = String(target);
    };
  }, [val]);

  // point on the arc for a tick, angle 180deg at MIN to 0deg at MAX
  const tick = (x: number) => {
    const ang = Math.PI * (1 - pos(x));
    const cx = 90 + Math.cos(ang) * R;
    const cy = 90 - Math.sin(ang) * R;
    const ix = 90 + Math.cos(ang) * (R - 11);
    const iy = 90 - Math.sin(ang) * (R - 11);
    return { cx, cy, ix, iy };
  };
  const lines = [
    { x: 1.1, name: "110" },
    { x: resc, name: String(Math.round(resc * 100)) },
    { x: safe, name: String(Math.round(safe * 100)) },
  ];

  return (
    <div className="gauge" role="img" aria-label={`Health: ${val === null ? "no reading" : `${(val * 100).toFixed(1)} percent`}, ${label}`}>
      <svg viewBox="0 0 180 104" width="100%">
        <path d={`M ${90 - R} 90 A ${R} ${R} 0 0 1 ${90 + R} 90`} fill="none" stroke="rgba(120,138,175,.2)" strokeWidth="12" strokeLinecap="round" />
        <path
          ref={arc}
          d={`M ${90 - R} 90 A ${R} ${R} 0 0 1 ${90 + R} 90`}
          fill="none"
          stroke={tone}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={ARC}
          strokeDashoffset={ARC}
        />
        {lines.map((l) => {
          const t = tick(l.x);
          return <line key={l.name} x1={t.cx} y1={t.cy} x2={t.ix} y2={t.iy} stroke="rgba(26,34,51,.55)" strokeWidth="1.5" />;
        })}
        <text x="90" y="80" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--ink)">
          {val === null ? "n/a" : `${(val * 100).toFixed(0)}%`}
        </text>
        <text x="90" y="97" textAnchor="middle" fontSize="9.5" fill={tone} fontWeight="600">
          {label}
        </text>
      </svg>
      <div className="gauge-legend">
        <span>
          <i style={{ background: "var(--bad)" }} /> under 110% liquidated
        </span>
        <span>
          <i style={{ background: "var(--warn)" }} /> under {Math.round(resc * 100)}% rescue
        </span>
        <span>
          <i style={{ background: "var(--good)" }} /> {Math.round(safe * 100)}% safe
        </span>
      </div>
    </div>
  );
}
