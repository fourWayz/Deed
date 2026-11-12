"use client";

import { fmtPct } from "@/lib/format";
import type { RecoveryInfo } from "@/lib/positions";

/** What Mezo refuses while the system is in Recovery Mode (docs/mezo-notes.md). */
export type Blocked = { withdraw: boolean; close: boolean; borrow: boolean; refinance: boolean };

export function blockedFor(r: RecoveryInfo | undefined): Blocked {
  const on = r?.active === true;
  return { withdraw: on, close: on && r!.closeBlocked, borrow: on, refinance: on };
}

export function RecoveryBanner({ recovery }: { recovery: RecoveryInfo | undefined }) {
  if (!recovery) return null;
  if (recovery.active === null) {
    return (
      <div className="notice">
        The Mezo oracle is not answering right now (its price is older than 60 seconds), so Recovery Mode cannot be checked.
        Actions that need a price are paused until it updates.
      </div>
    );
  }
  if (!recovery.active) return null;
  const b = blockedFor(recovery);
  return (
    <div className="recovery" role="status">
      <div className="recovery-head">
        <span className="pill bad">Recovery Mode</span>
        <b>Mezo is protecting itself, some actions are switched off</b>
      </div>
      <p>
        The whole system's collateral ratio is {fmtPct(recovery.tcr)}, under the 150% line. While that lasts Mezo refuses the
        actions below. This is a rule of the MUSD protocol, not of Deed, and it ends on its own once the ratio recovers.
      </p>
      <ul>
        <li>
          Withdrawing collateral: <b>blocked</b>
        </li>
        <li>
          Borrowing more and refinancing: <b>blocked</b>
        </li>
        <li>
          Closing a position: <b>{b.close ? "blocked" : "still allowed on this deployment"}</b>
        </li>
        <li>
          Adding collateral, repaying, listing, buying and rescue auctions: <b>still work</b>
        </li>
      </ul>
    </div>
  );
}

/** Small explanation shown under a button that Recovery Mode switched off. */
export function BlockedNote({ children }: { children?: React.ReactNode }) {
  return (
    <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
      {children ?? "Switched off while Mezo is in Recovery Mode."}
    </div>
  );
}
