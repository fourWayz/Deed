"use client";

import { fmtMUSD } from "@/lib/format";
import type { FeeQuote } from "@/lib/fees";

/**
 * Fee preview for a sale at `price`, shown as a small receipt. `role` says whose side of the sale is shown. The sentence
 * is kept for screen readers (the rows are marked decorative), so both say the same thing.
 */
export function FeeLine({ price, quote, role }: { price: bigint | null; quote: FeeQuote; role: "seller" | "buyer" }) {
  if (price === null || price <= 0n) return null;
  if (!quote.known) {
    return (
      <div className="fee muted">
        Fee: could not be read from the contract right now. The price you confirm in your wallet is what you pay.
      </div>
    );
  }
  if (quote.fee === 0n) {
    return (
      <div className="fee">
        <span className="pill good">no fee</span> {role === "seller" ? `You receive ${fmtMUSD(price)}.` : `You pay ${fmtMUSD(price)}, nothing on top.`}
      </div>
    );
  }
  const net = price - quote.fee;
  // the fee as a share of the price, from the contract's own number
  const pct = ((Number(quote.fee) * 100) / Number(price)).toFixed(2);
  return (
    <div className="fee">
      <span className="sr-only">
        {role === "seller" ? (
          <>
            Fee {fmtMUSD(quote.fee)}, taken from the sale. You receive {fmtMUSD(net)}.
          </>
        ) : (
          <>
            You pay {fmtMUSD(price)}. {fmtMUSD(quote.fee)} of it is the protocol fee, paid out of the seller's side, nothing extra on top.
          </>
        )}
      </span>
      <div className="receipt" aria-hidden="true">
        <div className="r">
          <span>Price</span>
          <span>{fmtMUSD(price)}</span>
        </div>
        <div className="r">
          <span>{role === "seller" ? "Protocol fee" : "Included: protocol fee"} ({pct}%)</span>
          <span>{role === "seller" ? "−" : ""}{fmtMUSD(quote.fee)}</span>
        </div>
        <div className="r total">
          <span>{role === "seller" ? "You receive" : "You pay"}</span>
          <span>{fmtMUSD(role === "seller" ? net : price)}</span>
        </div>
      </div>
    </div>
  );
}
