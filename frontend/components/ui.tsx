"use client";

import { useEffect, useRef } from "react";
import { animate, stagger } from "animejs";
import { EXPLORER } from "@/lib/config";
import type { TxState } from "@/lib/useTx";

/** Fades children in with a small stagger when they first show up. */
export function Reveal({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const items = Array.from(el.children);
    if (items.length === 0) return;
    items.forEach((c) => ((c as HTMLElement).style.opacity = "0"));
    const a = animate(items, {
      opacity: [0, 1],
      translateY: [14, 0],
      duration: 520,
      delay: stagger(60),
      ease: "outCubic",
    });
    return () => {
      a.pause();
      items.forEach((c) => ((c as HTMLElement).style.opacity = "1"));
    };
    // run once per mount, new cards appear without replaying the whole list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/** Tweens a number on screen when its value changes. */
export function Ticker({ value, format }: { value: number; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef(value);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const state = { v: last.current };
    const a = animate(state, {
      v: value,
      duration: 700,
      ease: "outExpo",
      onUpdate: () => {
        el.textContent = format(state.v);
      },
    });
    last.current = value;
    return () => {
      a.pause();
    };
    // format is a stable inline function in callers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <span ref={ref}>{format(value)}</span>;
}

export function Stat({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

export function TxStatus({ state }: { state: TxState }) {
  if (state.status === "wallet") return <div className="txline">Confirm in your wallet…</div>;
  if (state.status === "pending")
    return (
      <div className="txline">
        Waiting for confirmation…{" "}
        <a href={`${EXPLORER}/tx/${state.hash}`} target="_blank" rel="noreferrer">
          view
        </a>
      </div>
    );
  if (state.status === "done")
    return (
      <div className="txline ok">
        Done.{" "}
        <a href={`${EXPLORER}/tx/${state.hash}`} target="_blank" rel="noreferrer">
          view transaction
        </a>
      </div>
    );
  if (state.status === "error") return <div className="txline err">{state.message}</div>;
  return <div className="txline" />;
}

export function TxButton({
  label,
  onClick,
  state,
  disabled,
  variant,
}: {
  label: string;
  onClick: () => void;
  state: TxState;
  disabled?: boolean;
  variant?: "ghost" | "danger";
}) {
  const busy = state.status === "wallet" || state.status === "pending";
  return (
    <div>
      <button className={`btn ${variant ?? ""}`} onClick={onClick} disabled={disabled || busy}>
        {busy && <span className="spinner" />}
        {busy ? (state.status === "wallet" ? "Confirm in wallet" : "Confirming") : label}
      </button>
      <TxStatus state={state} />
    </div>
  );
}

export function Skeletons({ n = 3 }: { n?: number }) {
  return (
    <div className="grid">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry: () => void }) {
  const msg = (error as { shortMessage?: string; message?: string })?.shortMessage ?? (error as Error)?.message ?? "Failed to load";
  return (
    <div className="notice err">
      Could not load positions: {msg}{" "}
      <button className="btn ghost" style={{ marginLeft: 10, padding: "6px 12px" }} onClick={retry}>
        Retry
      </button>
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
