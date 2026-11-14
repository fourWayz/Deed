"use client";

import Link from "next/link";
import { fmtMUSD } from "@/lib/format";
import { deployed, EXPLORER } from "@/lib/config";
import { useStats } from "@/lib/useStats";
import { useFeeTerms } from "@/lib/fees";
import { CountUp, ErrorBox, Reveal, StatsSource, StripSkeleton } from "@/components/ui";
import { Video } from "@/components/Video";

const audience = [
  { t: "BTC holders with a MUSD loan", d: "Your loan is stuck to the wallet that opened it. Put it in a vault and you can sell the whole position, collateral and debt together." },
  { t: "Position buyers", d: "Buy a healthy loan at a fixed price. A snapshot of the numbers you looked at protects you: if they change before you land, the buy reverts." },
  { t: "Rescue bidders", d: "When a position nears liquidation a Dutch auction runs. Win it, add BTC in the same transaction and the position leaves safely collateralised." },
  { t: "Keepers", d: "Anyone can start a rescue below 120% ICR, end expired auctions and clear expired listings. All of it is permissionless." },
];

const steps = [
  { t: "Open in a vault", d: "One transaction deploys a vault, opens your Mezo trove inside it and mints you a Deed NFT." },
  { t: "The Deed is the key", d: "Whoever holds the Deed is the only one who can add, repay, withdraw or close. Move the Deed and the loan moves." },
  { t: "Sell it", d: "List at a fixed price, or let a rescue auction price a position that is close to liquidation." },
];

const rules = [
  ["Strangers start rescues only under 120% ICR.", "Liquidation is at 110%, so a stranger can only act inside that 10 point band. The holder can start one at any ratio."],
  ["Every auction floor is at least 80% of equity.", "Nobody, owner included, can be tricked into a near-zero sale."],
  ["The oracle prices, the DEX only guards.", "Every amount comes from the Mezo price feed. A time-weighted DEX price is compared with it and the call reverts if they disagree."],
  ["A listing or auction freezes the vault for everyone.", "While a venue holds the Deed the holder cannot change the position under a buyer's feet."],
];

const int = (b: bigint) => b.toLocaleString("en-US");

export default function Landing() {
  const stats = useStats();
  const terms = useFeeTerms();
  const s = stats.data;
  return (
    <>
      <section className="hero">
        <span className="pill eyebrow">DeFi · Borrowing · Mezo testnet</span>
        <h1 className="hero-title">
          Your MUSD loan, as something <em>you can sell.</em>
        </h1>
        <p className="lede">
          A Mezo loan is stuck to the wallet that opened it. Deed puts each loan in its own vault and turns control of that vault into
          an NFT, so a healthy position can be sold and a risky one handed to someone who will rescue it.
        </p>
        <div className="hero-cta">
          <Link href="/start" className="btn cta">
            Get started
          </Link>
          <Link href="/market" className="btn ghost cta">
            Browse the market
          </Link>
        </div>
        <div className="venues reveal">
          <div className="glass venue card">
            <svg viewBox="0 0 44 44" aria-hidden="true">
              <rect width="44" height="44" rx="12" fill="rgba(58,88,214,.12)" />
              <path d="M14 15h10l8 8-8 8-10-10z" fill="none" stroke="#2f4fc9" strokeWidth="2.4" strokeLinejoin="round" />
              <circle cx="19" cy="20" r="1.8" fill="#2f4fc9" />
            </svg>
            <div>
              <b>Fixed price market</b>
              <span>List a position at a price you choose. A buyer sees a snapshot of what they get.</span>
            </div>
          </div>
          <div className="glass venue card">
            <svg viewBox="0 0 44 44" aria-hidden="true">
              <rect width="44" height="44" rx="12" fill="rgba(199,125,10,.15)" />
              <circle cx="22" cy="22" r="9" fill="none" stroke="#8a5300" strokeWidth="2.4" />
              <circle cx="22" cy="22" r="3.6" fill="none" stroke="#8a5300" strokeWidth="2.4" />
              <path d="M15.6 15.6l3.9 3.9M28.4 15.6l-3.9 3.9M15.6 28.4l3.9-3.9M28.4 28.4l-3.9-3.9" stroke="#8a5300" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
            <div>
              <b>Rescue auction</b>
              <span>A position near liquidation is sold down from its equity, and the winner tops it up with BTC.</span>
            </div>
          </div>
        </div>
      </section>

      <h2 className="section">Live on testnet</h2>
      {!deployed && (
        <div className="glass empty">
          <p>Contract addresses are not configured, so there are no numbers to show.</p>
        </div>
      )}
      {deployed && stats.isLoading && (
        <div>
          <StripSkeleton />
          <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 8 }}>
            Reading events from the chain… {Math.round(stats.progress * 100)}%
          </div>
        </div>
      )}
      {deployed && stats.error && <ErrorBox error={stats.error} retry={() => stats.refetch()} what="the activity" />}
      {s && (
        <div className="glass stack" style={{ gap: "var(--s-3)" }}>
          <div className="strip">
            <div className="strip-cell stat">
              <div className="k">Positions opened</div>
              <div className="v">
                <CountUp value={BigInt(s.positions)} format={int} />
              </div>
            </div>
            <div className="strip-cell stat">
              <div className="k">Volume</div>
              <div className="v">
                <CountUp value={s.volume} format={fmtMUSD} />
              </div>
            </div>
            <div className="strip-cell stat">
              <div className="k">Fees paid</div>
              <div className="v">
                <CountUp value={s.fees} format={fmtMUSD} />
              </div>
            </div>
            <div className="strip-cell stat">
              <div className="k">Unique wallets</div>
              <div className="v">
                <CountUp value={BigInt(s.wallets)} format={int} />
              </div>
            </div>
          </div>
          <StatsSource s={s} indexerDown={stats.data!.indexerDown} />
          <div style={{ fontSize: "var(--fs-sm)" }}>
            <Link href="/activity" style={{ textDecoration: "underline", fontWeight: 600 }}>
              Full activity
            </Link>
          </div>
        </div>
      )}

      <h2 className="section">How it works</h2>
      <Reveal className="grid">
        {steps.map((st, i) => (
          <div className="glass how card" key={st.t}>
            <div className="num">{i + 1}</div>
            <br />
            <b>{st.t}</b>
            <p>{st.d}</p>
          </div>
        ))}
      </Reveal>

      <h2 className="section">Who it is for</h2>
      <Reveal className="grid">
        {audience.map((a) => (
          <div className="glass aud card" key={a.t}>
            <b style={{ fontFamily: "var(--font-heading)", fontSize: "var(--fs-md)" }}>{a.t}</b>
            <p>{a.d}</p>
          </div>
        ))}
      </Reveal>

      <h2 className="section">Safety rules</h2>
      <div className="glass stack">
        {rules.map(([t, d]) => (
          <div key={t}>
            <b>{t}</b>
            <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 2 }}>
              {d}
            </div>
          </div>
        ))}
        <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          These are enforced by the deployed contracts and tested, they are not promises of the interface. The contracts are not
          audited.
        </div>
      </div>

      <h2 className="section">Fees</h2>
      <div className="glass fee-card">
        <div className="fee-figs">
          <div className="fee-fig">
            <b>{terms.data ? `${(Number(terms.data.market) / 100).toFixed(2)}%` : "…"}</b>
            <span>Fixed price sale</span>
          </div>
          <div className="fee-fig">
            <b>{terms.data ? `${(Number(terms.data.auction) / 100).toFixed(2)}%` : "…"}</b>
            <span>Rescue auction</span>
          </div>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <div>
            <b>Deed's fee:</b>{" "}
            {terms.data ? (
              <>
                {(Number(terms.data.market) / 100).toFixed(2)}% of the sale price on a fixed price sale and{" "}
                {(Number(terms.data.auction) / 100).toFixed(2)}% on a rescue auction, read from the contracts. The seller receives the
                price minus the fee and the fee goes to the treasury{" "}
                <a className="mono" href={`${EXPLORER}/address/${terms.data.treasury}`} target="_blank" rel="noreferrer">
                  {terms.data.treasury.slice(0, 6)}…{terms.data.treasury.slice(-4)}
                </a>
                . The contracts cap it at 1%, and you see the exact amount before you sign.
              </>
            ) : terms.isError ? (
              "could not be read from the contracts right now. You see the exact amount before you sign."
            ) : (
              "reading it from the contracts…"
            )}
          </div>
          <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            Mezo's own charges still apply: a 0.1% borrowing fee when you borrow, 1% a year simple interest at today's rate, and a
            200 MUSD gas deposit that is added to the debt and paid back when you close. Sale proceeds are paid into a balance you
            claim, nothing is pushed to you.
          </div>
        </div>
      </div>

      <h2 className="section">See it run</h2>
      <Video />
    </>
  );
}
