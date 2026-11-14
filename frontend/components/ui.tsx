"use client";

import { useEffect, useRef, useState } from "react";
import { animate } from "animejs";
import { EXPLORER } from "@/lib/config";
import { cleanMessage, fmtMUSD } from "@/lib/format";
import { reducedMotion } from "@/lib/motion";
import type { TxState } from "@/lib/useTx";
import { Art, ErrorArt, type ArtName } from "./Art";

/** Children rise in one after another when the list first shows. Pure CSS, so nothing flashes before it animates. */
export function Reveal({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`reveal${className ? ` ${className}` : ""}`}>{children}</div>;
}

/**
 * Tweens a number on screen when its value changes. `from` makes the first render count up from that value (the stats
 * strip uses 0). Under reduced motion it just shows the value. The last frame is always the exact formatted value.
 */
export function Ticker({ value, format, from, ms = 380 }: { value: number; format: (n: number) => string; from?: number; ms?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef(from ?? value);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion() || last.current === value) {
      el.textContent = format(value);
      last.current = value;
      return;
    }
    const state = { v: last.current };
    const a = animate(state, {
      v: value,
      duration: ms,
      ease: "outCubic",
      onUpdate: () => {
        el.textContent = format(state.v);
      },
      onComplete: () => {
        el.textContent = format(value);
      },
    });
    last.current = value;
    return () => {
      a.pause();
      el.textContent = format(value);
    };
    // format is a stable inline function in callers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <span ref={ref}>{format(from ?? value)}</span>;
}

export function Stat({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

const STEPS = ["Confirm in wallet", "Pending", "Confirmed"] as const;

/**
 * One status display for every write: three steps, the explorer link, a plain failure message with Retry, and it stays
 * until it is dismissed. It only reads the TxState that useTx already keeps, nothing about sending changes.
 */
export function TxStatus({ state, onRetry }: { state: TxState; onRetry?: () => void }) {
  const [hidden, setHidden] = useState<string | null>(null);
  const key = state.status === "done" ? `done:${state.hash}` : state.status === "error" ? `err:${state.message}` : null;
  useEffect(() => {
    // a new attempt starts, so whatever was dismissed before does not apply any more
    if (state.status === "wallet" || state.status === "pending") setHidden(null);
  }, [state.status]);

  if (state.status === "idle") return <div className="tx" role="status" aria-live="polite" />;
  if (key !== null && hidden === key) return <div className="tx" role="status" aria-live="polite" />;

  const at = state.status === "wallet" ? 0 : state.status === "pending" ? 1 : 2;
  const steps = (
    <ol className="tx-steps" aria-label="Transaction steps">
      {STEPS.map((name, i) => {
        const s = state.status === "error" ? (i === 0 ? "fail" : "todo") : state.status === "done" ? "done" : i < at ? "done" : i === at ? "now" : "todo";
        return (
          <li key={name} data-s={s}>
            <span className="dot" aria-hidden="true">
              {s === "done" ? "✓" : s === "fail" ? "!" : ""}
            </span>
            {name}
          </li>
        );
      })}
    </ol>
  );
  const link = (label: string) =>
    "hash" in state ? (
      <a href={`${EXPLORER}/tx/${state.hash}`} target="_blank" rel="noreferrer">
        {label}
      </a>
    ) : null;

  return (
    <div className="tx" role="status" aria-live="polite">
      {state.status === "wallet" && (
        <div className="txline">
          {steps}
          <span className="tx-msg">Confirm in your wallet…</span>
        </div>
      )}
      {state.status === "pending" && (
        <div className="txline">
          {steps}
          <span className="tx-msg">Waiting for confirmation… {link("view")}</span>
        </div>
      )}
      {state.status === "done" && (
        <div className="txline ok">
          {steps}
          <span className="tx-msg">Done. {link("view transaction")}</span>
          <div className="tx-actions">
            <button type="button" className="btn ghost small" onClick={() => setHidden(key)}>
              Dismiss
            </button>
          </div>
        </div>
      )}
      {state.status === "error" && (
        <div className="txline err" role="alert">
          {steps}
          <span className="tx-msg">{state.message}</span>
          <div className="tx-actions">
            {onRetry && (
              <button type="button" className="btn small" onClick={onRetry}>
                Retry
              </button>
            )}
            <button type="button" className="btn ghost small" onClick={() => setHidden(key)}>
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const InfoIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 7v4M8 4.8v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

/** A write button with its status underneath. `why` is shown when the button is switched off, so it never just sits there grey. */
export function TxButton({
  label,
  onClick,
  state,
  disabled,
  variant,
  why,
}: {
  label: string;
  onClick: () => void;
  state: TxState;
  disabled?: boolean;
  variant?: "ghost" | "danger";
  why?: string;
}) {
  const busy = state.status === "wallet" || state.status === "pending";
  return (
    <div>
      <button className={`btn ${variant ?? ""}`} onClick={onClick} disabled={disabled || busy}>
        {busy && <span className="spinner" aria-hidden="true" />}
        {busy ? (state.status === "wallet" ? "Confirm in wallet" : "Confirming") : label}
      </button>
      {disabled && !busy && why && (
        <div className="why">
          <InfoIcon />
          <span>{why}</span>
        </div>
      )}
      <TxStatus state={state} onRetry={onClick} />
    </div>
  );
}

/** A card-shaped placeholder: same size as a position card so the grid does not move when real cards arrive. */
function CardSkeleton() {
  return (
    <div className="card-skel" aria-hidden="true">
      <div className="skeleton-line h" />
      <div className="skeleton-line" style={{ width: "30%" }} />
      <div className="sgrid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton-line" />
        ))}
      </div>
      <div className="skeleton-line btn" />
    </div>
  );
}

export function Skeletons({ n = 3 }: { n?: number }) {
  return (
    <div className="grid" role="status" aria-label="Loading">
      {Array.from({ length: n }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

/** A row of small placeholders for a stats strip. */
export function StripSkeleton() {
  return (
    <div className="strip" role="status" aria-label="Loading numbers">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="strip-cell">
          <div className="skeleton-line" style={{ width: "60%", height: 12 }} />
          <div className="skeleton-line" style={{ width: "80%", height: 28, marginTop: 10 }} />
        </div>
      ))}
    </div>
  );
}

export function ErrorBox({ error, retry, what = "positions" }: { error: unknown; retry: () => void; what?: string }) {
  const msg = cleanMessage((error as { shortMessage?: string; message?: string })?.shortMessage ?? (error as Error)?.message);
  return (
    <div className="notice err err-state" role="alert">
      <ErrorArt />
      <div>
        Could not load {what}: {msg}
        <div>
          <button className="btn ghost small" onClick={retry}>
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}

/** Empty state: a small picture, a short title and one plain sentence. */
export function Empty({ art, title, children }: { art: ArtName; title?: string; children: React.ReactNode }) {
  return (
    <div className="glass empty">
      <Art name={art} />
      {title && <div className="empty-title">{title}</div>}
      <p>{children}</p>
    </div>
  );
}

export function NotDeployed() {
  return (
    <div className="notice">
      Deed contract addresses are not configured. Copy <span className="mono">frontend/.env.example</span> to{" "}
      <span className="mono">.env.local</span> and fill in the deployed addresses.
    </div>
  );
}

/** Copies `value` to the clipboard and says so for a moment. `label` names what is copied, for screen readers. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // clipboard api is missing on plain http and in some webviews
      const t = document.createElement("textarea");
      t.value = value;
      t.style.position = "fixed";
      t.style.opacity = "0";
      document.body.appendChild(t);
      t.select();
      try {
        document.execCommand("copy");
      } catch {
        /* nothing more to try */
      }
      document.body.removeChild(t);
    }
    setDone(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 1600);
  };
  return (
    <>
      <button type="button" className={`copy${done ? " copied" : ""}`} onClick={copy} aria-label={`Copy ${label}`} title={`Copy ${label}`}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {done ? <path d="M3 8.5l3.2 3.2L13 4.8" /> : <><rect x="5.5" y="5.5" width="8" height="8" rx="2" /><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" /></>}
        </svg>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {done ? `${label} copied` : ""}
      </span>
      {done && (
        <span className="copy-note" aria-hidden="true">
          Copied
        </span>
      )}
    </>
  );
}

/** Says where stats came from and labels the earlier deployment's share, used on the landing and activity pages. */
function ago(iso: string): string {
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 90) return "under a minute ago";
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  return `${Math.round(sec / 86400)} days ago`;
}

export function StatsSource({ s, indexerDown }: { s: import("@/lib/stats").Stats; indexerDown: boolean }) {
  return (
    <div className="muted" style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
      {/* testnet only, and so far only the team has used it. The wording stays until another wallet shows up. */}
      <div data-testid="stats-label">
        {s.outsideWallets ? "Testnet activity." : "Testnet activity from the team's test wallets."}
      </div>
      {s.source === "indexer" ? (
        <div>
          Totals come from the Deed indexer, across every deployment it follows.
          {s.lastSyncedAt && (
            <>
              {" "}
              <span data-testid="last-synced" title={s.lastSyncedAt}>
                Last synced {ago(s.lastSyncedAt)}
              </span>
              .
            </>
          )}
          {/* a stalled sync makes every total too low, so say it instead of leaving the age to be noticed */}
          {s.lastSyncedAt && Date.now() - new Date(s.lastSyncedAt).getTime() > 30 * 60_000 && (
            <div data-testid="indexer-behind" style={{ marginTop: 4, color: "var(--warn-ink)", fontWeight: 600 }}>
              The indexer is behind, so the newest activity is not in these totals yet.
            </div>
          )}
        </div>
      ) : (
        <div>
          Counted from this deployment's chain events, blocks {s.fromBlock.toString()} to {s.toBlock.toString()}.
          {indexerDown && " The indexer did not answer, so earlier deployments are not included."}
        </div>
      )}
      {s.earlier.map((e) => (
        <div key={e.version}>
          Earlier deployment ({e.version}): {e.positions.toLocaleString()} positions, {fmtMUSD(e.volume)} volume, {fmtMUSD(e.fees)} fees.
        </div>
      ))}
    </div>
  );
}
