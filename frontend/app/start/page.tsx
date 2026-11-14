"use client";

import Link from "next/link";
import { useAccount, useBalance } from "wagmi";
import { parseEther } from "viem";
import { deployed, FAUCET } from "@/lib/config";
import { fmtBTC } from "@/lib/format";
import { usePositions } from "@/lib/usePositions";
import { CreatePosition, ListForm } from "@/components/Actions";
import { ErrorBox, NotDeployed } from "@/components/ui";

// enough for the default 0.04 BTC position plus gas
const NEEDED = parseEther("0.05");

function Step({ n, title, state, children }: { n: number; title: string; state: "todo" | "now" | "done" | "loading"; children?: React.ReactNode }) {
  return (
    <div className={`glass step ${state}`}>
      <div className="step-head">
        <span className="num">{state === "done" ? "✓" : n}</span>
        <h2 style={{ margin: 0 }}>{title}</h2>
      </div>
      {state === "loading" && <div className="skeleton" style={{ height: 44, marginTop: 12 }} />}
      {state !== "todo" && state !== "loading" && <div className="stack" style={{ marginTop: 12 }}>{children}</div>}
    </div>
  );
}

export default function Start() {
  const { address, isConnected } = useAccount();
  const bal = useBalance({ address, query: { refetchInterval: 10_000 } });
  const { data, isLoading, error, refresh, refetch } = usePositions();

  const mine = data?.positions.filter((p) => address && p.owner.toLowerCase() === address.toLowerCase() && p.status === 1) ?? [];
  const hasPosition = mine.length > 0;
  const listed = mine.find((p) => p.listing);
  const toList = mine.find((p) => !p.listing && !p.auction);
  const hasBtc = (bal.data?.value ?? 0n) >= NEEDED;

  // until positions and the balance are known, guessing which step is open makes the page flip, so show a loading state
  const loading = isConnected && (isLoading || bal.isLoading);
  type S = "todo" | "now" | "done" | "loading";
  const s1: S = loading ? "loading" : !isConnected ? "now" : hasBtc || hasPosition ? "done" : "now";
  const s2: S = loading ? "loading" : s1 !== "done" ? "todo" : hasPosition ? "done" : "now";
  const s3: S = loading ? "loading" : s2 !== "done" ? "todo" : listed ? "done" : "now";

  return (
    <>
      <h1>Get started</h1>
      <p className="lede">Three steps from an empty wallet to a position for sale. Each step opens when the one before it is done.</p>
      {!deployed && <NotDeployed />}
      {deployed && (
        <div className="stack" style={{ gap: 16 }}>
          <Step n={1} title="Get test BTC" state={s1}>
            {!isConnected ? (
              <div className="notice" style={{ marginBottom: 0 }}>
                Connect a wallet on Mezo testnet (chain id 31611) with the button in the top right.
              </div>
            ) : (
              <>
                <div className="muted">
                  {hasBtc || hasPosition
                    ? `You have ${bal.data ? fmtBTC(bal.data.value) : "enough"} in this wallet.`
                    : `This wallet holds ${bal.data ? fmtBTC(bal.data.value) : "…"}. A position needs a little BTC as collateral, ask the faucet for some, then come back here, this page notices on its own.`}
                </div>
                <div>
                  <a className="btn cta" href={FAUCET} target="_blank" rel="noreferrer">
                    Open the Mezo faucet
                  </a>
                </div>
              </>
            )}
          </Step>

          <Step n={2} title="Open a position" state={s2}>
            {isLoading && <div className="skeleton" aria-hidden="true" />}
            {error && <ErrorBox error={error} retry={() => refetch()} />}
            {data &&
              (hasPosition ? (
                <div className="muted">
                  You hold Deed #{mine[0].id.toString()}.{" "}
                  <Link href={`/position/${mine[0].id}`} style={{ textDecoration: "underline" }}>
                    View it
                  </Link>
                </div>
              ) : (
                <CreatePosition price={data.price} onDone={refresh} />
              ))}
          </Step>

          <Step n={3} title="List it for sale" state={s3}>
            {data && listed && (
              <div className="stack">
                <div className="muted">
                  Deed #{listed.id.toString()} is listed. It shows on the market, and another wallet can buy it.
                </div>
                <div className="row" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
                  <Link href="/market" className="btn cta">
                    See it on the market
                  </Link>
                  <Link href={`/position/${listed.id}`} className="btn ghost cta">
                    Manage it
                  </Link>
                </div>
              </div>
            )}
            {data && !listed && toList && <ListForm p={toList} locked={toList.lockedBy !== "0x0000000000000000000000000000000000000000"} price={data.price} onDone={refresh} />}
            {data && !listed && !toList && hasPosition && (
              <div className="muted">Your position is in a rescue auction right now, so it can't be listed until that ends.</div>
            )}
          </Step>
        </div>
      )}
    </>
  );
}
