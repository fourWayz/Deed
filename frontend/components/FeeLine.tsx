"use client";

import { fmtMUSD } from "@/lib/format";
import type { FeeQuote } from "@/lib/fees";

/** Fee preview for a sale at `price`. `role` says whose side of the sale is shown. */
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
  return (
    <div className="fee">
      {role === "seller" ? (
        <>
          Fee {fmtMUSD(quote.fee)}, taken from the sale. You receive <b>{fmtMUSD(net)}</b>.
        </>
      ) : (
        <>
          You pay <b>{fmtMUSD(price)}</b>. {fmtMUSD(quote.fee)} of it is the protocol fee, paid out of the seller's side, nothing extra on top.
        </>
      )}
    </div>
  );
}
