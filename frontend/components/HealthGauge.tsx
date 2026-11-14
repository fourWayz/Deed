"use client";

import { useEffect, useRef } from "react";
import { animate } from "animejs";
import { reducedMotion } from "@/lib/motion";

// the dial runs from 100% to 200% ICR, anything above reads as full
const MIN = 1.0;
const MAX = 2.0;
const CX = 100;
const CY = 100;
const R = 78;
const W = 14;
const ARC = Math.PI * R; // half circle length

const frac = (icr: number) => Math.min(1, Math.max(0, (icr - MIN) / (MAX - MIN)));
// point at a fraction along the dial (0 is the left end), at radius r
const pt = (f: number, r: number) => ({ x: CX + Math.cos(Math.PI * (1 - f)) * r, y: CY - Math.sin(Math.PI * (1 - f)) * r });
const arcPath = (f0: number, f1: number) => {
  const a = pt(f0, R);
  const b = pt(f1, R);
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${R} ${R} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
};

/**
 * Half-circle ICR dial. Three zones are painted on the track (under 110% liquidation, 110% to the rescue line, above it),
 * the filled part and the marker show where the position is, and a line of words says how far it is from each line, so
 * the color is never the only signal.
 */
export function HealthGauge({ icr, rescueICR, safeICR }: { icr: bigint | null; rescueICR: bigint; safeICR: bigint }) {
  const arc = useRef<SVGPathElement>(null);
  const dot = useRef<SVGCircleElement>(null);
  const val = icr === null || icr > 10n ** 24n ? null : Number(icr) / 1e18;
  const resc = Number(rescueICR) / 1e18;
  const safe = Number(safeICR) / 1e18;
  const tone = val === null ? "muted" : val < 1.1 ? "bad" : val < resc ? "warn" : "good";
  const ink = { muted: "var(--muted)", bad: "var(--bad-ink)", warn: "var(--warn-ink)", good: "var(--good-ink)" }[tone];
  const fill = { muted: "var(--muted)", bad: "var(--bad)", warn: "var(--warn)", good: "var(--good)" }[tone];
  const label = val === null ? "no reading" : val < 1.1 ? "liquidatable" : val < resc ? "at risk" : val < safe ? "fine" : "healthy";
  const pts = (x: number) => (x * 100).toFixed(1);
  const words =
    val === null
      ? "The ratio is not available right now."
      : val < 1.1
        ? `${pts(1.1 - val)} points under the 110% liquidation line.`
        : val < resc
          ? `${pts(val - 1.1)} points above liquidation, ${pts(resc - val)} under the ${Math.round(resc * 100)}% rescue line.`
          : `${pts(val - resc)} points above the ${Math.round(resc * 100)}% rescue line.`;

  useEffect(() => {
    const el = arc.current;
    const d = dot.current;
    if (!el || !d) return;
    const target = val === null ? 0 : frac(val);
    const set = (f: number) => {
      el.style.strokeDashoffset = String(ARC * (1 - f));
      const p = pt(f, R);
      d.setAttribute("cx", p.x.toFixed(2));
      d.setAttribute("cy", p.y.toFixed(2));
    };
    if (reducedMotion()) {
      set(target);
      return;
    }
    const s = { f: 0 };
    const a = animate(s, { f: target, duration: 380, ease: "outCubic", onUpdate: () => set(s.f), onComplete: () => set(target) });
    return () => {
      a.pause();
      set(target);
    };
  }, [val]);

  const marks = [
    { x: 1.1, name: "110" },
    { x: resc, name: String(Math.round(resc * 100)) },
    { x: safe, name: String(Math.round(safe * 100)) },
  ];
  const zones = [
    { f0: 0, f1: frac(1.1), c: "var(--bad)" },
    { f0: frac(1.1), f1: frac(resc), c: "var(--warn)" },
    { f0: frac(resc), f1: 1, c: "var(--good)" },
  ];

  return (
    <div className="gauge" role="img" aria-label={`Health: ${val === null ? "no reading" : `${(val * 100).toFixed(1)} percent`}, ${label}. ${words}`}>
      <svg viewBox="0 0 200 122" aria-hidden="true">
        {zones.map((z, i) => (
          <path key={i} d={arcPath(z.f0, z.f1)} fill="none" stroke={z.c} strokeOpacity="0.28" strokeWidth={W} />
        ))}
        <path
          ref={arc}
          d={arcPath(0, 1)}
          fill="none"
          stroke={fill}
          strokeWidth={W - 6}
          strokeLinecap="round"
          strokeDasharray={ARC}
          strokeDashoffset={ARC}
        />
        <circle ref={dot} cx={pt(0, R).x} cy={pt(0, R).y} r="9" fill="#fff" stroke={fill} strokeWidth="4" />
        <text x={CX} y="92" textAnchor="middle" fontSize="30" fontWeight="800" fill="var(--ink)" style={{ fontFamily: "var(--font-text)" }}>
          {val === null ? "n/a" : `${(val * 100).toFixed(0)}%`}
        </text>
        <text x={CX} y="110" textAnchor="middle" fontSize="11" fontWeight="800" fill={ink} style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {label}
        </text>
        {marks.map((m) => {
          const a = pt(frac(m.x), R + W / 2 + 2);
          const b = pt(frac(m.x), R + W / 2 + 7);
          const t = pt(frac(m.x), R + W / 2 + 15);
          return (
            <g key={m.name}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--ink)" strokeOpacity=".5" strokeWidth="1.5" />
              <text x={t.x} y={t.y + 3} textAnchor="middle" fontSize="8.5" fontWeight="700" fill="var(--muted)">
                {m.name}
              </text>
            </g>
          );
        })}
      </svg>
      <div className={`gauge-note ${tone === "muted" ? "" : tone}`}>{words}</div>
      <div className="gauge-legend" aria-hidden="true">
        <span>
          <i style={{ background: "var(--bad)" }} />
          under 110% liquidated
        </span>
        <span>
          <i style={{ background: "var(--warn)" }} />
          to {Math.round(resc * 100)}% rescue
        </span>
        <span>
          <i style={{ background: "var(--good)" }} />
          above is safe
        </span>
      </div>
    </div>
  );
}
