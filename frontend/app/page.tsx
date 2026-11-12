"use client";

import Link from "next/link";
import { fmtMUSD } from "@/lib/format";
import { deployed } from "@/lib/config";
import { useStats } from "@/lib/useStats";
import { Reveal, Skeletons, Stat } from "@/components/ui";
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
  ["The oracle prices, the DEX only guards.", "Every amount comes from the Mezo price feed. The DEX price is compared with it and the call reverts if they disagree."],
  ["A listing or auction freezes the vault for everyone.", "While a venue holds the Deed the holder cannot change the position under a buyer's feet."],
];

export default function Landing() {
  const stats = useStats();
  const s = stats.data;
  return (
    <>
      <section className="hero">
        <span className="pill">DeFi · Borrowing · Mezo testnet</span>
        <h1 className="hero-title">Your MUSD loan, as something you can sell.</h1>
        <p className="lede" style={{ maxWidth: 680 }}>
          A Mezo loan is stuck to the wallet that opened it, so you can't sell a healthy position or hand a risky one to someone who
          will rescue it. Deed puts each loan in its own vault and turns control of that vault into an NFT.
        </p>
        <div className="row" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
          <Link href="/start" className="btn cta">
            Get started
          </Link>
          <Link href="/market" className="btn ghost cta">
            Browse the market
          </Link>
        </div>
      </section>

      <h2 className="section">Who it is for</h2>
      <Reveal className="grid">
        {audience.map((a) => (
          <div className="glass" key={a.t}>
            <b>{a.t}</b>
            <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.5, fontSize: 14 }}>
              {a.d}
            </p>
          </div>
        ))}
      </Reveal>

      <h2 className="section">How it works</h2>
      <Reveal className="grid">
        {steps.map((st, i) => (
          <div className="glass" key={st.t}>
            <div className="num">{i + 1}</div>
            <b>{st.t}</b>
            <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.5, fontSize: 14 }}>
              {st.d}
            </p>
          </div>
        ))}
      </Reveal>

      <h2 className="section">Live numbers</h2>
      {!deployed && <div className="glass empty">Contract addresses are not configured, so there are no numbers to show.</div>}
      {deployed && stats.isLoading && (
        <div>
          <Skeletons n={4} />
          <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
            Reading events from the chain… {Math.round(stats.progress * 100)}%
          </div>
        </div>
      )}
      {deployed && stats.error && (
        <div className="notice err" role="alert">
          Could not read the activity right now. <button className="btn ghost" style={{ marginLeft: 8, padding: "6px 12px" }} onClick={() => stats.refetch()}>Retry</button>
        </div>
      )}
      {s && (
        <div className="glass">
          <div className="stats four">
            <Stat k="Positions opened" v={s.positions.toLocaleString()} />
            <Stat k="Volume" v={fmtMUSD(s.volume)} />
            <Stat k="Fees paid" v={fmtMUSD(s.fees)} />
            <Stat k="Unique wallets" v={s.wallets.toLocaleString()} />
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            Read from chain events, blocks {s.fromBlock.toString()} to {s.toBlock.toString()}.{" "}
            <Link href="/activity" style={{ textDecoration: "underline" }}>
              Full activity
            </Link>
          </div>
        </div>
      )}

      <h2 className="section">Safety rules</h2>
      <div className="glass stack">
        {rules.map(([t, d]) => (
          <div key={t}>
            <b>{t}</b>
            <div className="muted" style={{ fontSize: 14, marginTop: 2 }}>
              {d}
            </div>
          </div>
        ))}
        <div className="muted" style={{ fontSize: 12.5 }}>
          These are enforced by the deployed contracts and tested, they are not promises of the interface. The contracts are not
          audited.
        </div>
      </div>

      <h2 className="section">Fees</h2>
      <div className="glass stack" style={{ gap: 8 }}>
        <div>
          <b>Deed's fee:</b> read from the contract at the moment of a sale and shown to you before you sign. The current
          deployment charges none.
        </div>
        <div className="muted" style={{ fontSize: 14 }}>
          Mezo's own charges still apply: a 0.1% borrowing fee when you borrow, 1% a year simple interest at today's rate, and a
          200 MUSD gas deposit that is added to the debt and paid back when you close. Sale proceeds are paid into a balance you
          claim, nothing is pushed to you.
        </div>
      </div>

      <h2 className="section">See it run</h2>
      <Video />
    </>
  );
}
