"use client";

import { fmtPct } from "@/lib/format";
import type { SystemInfo } from "@/lib/positions";

/**
 * Recovery Mode banner. `canClose` is the lens's answer for the position on screen (Mezo refuses closeTrove in Recovery
 * Mode only while BorrowerOperations can still mint MUSD). Left out on pages that are not about one position.
 */
export function RecoveryBanner({ system, canClose }: { system: SystemInfo | undefined; canClose?: boolean }) {
  if (!system) return null;
  if (system.stale) {
    return (
      <div className="notice">
        The Mezo oracle is not answering right now (its price is older than 60 seconds), so Recovery Mode cannot be checked.
        Actions that need a price are paused until it updates.
      </div>
    );
  }
  if (!system.recovery) return null;
  return (
    <div className="recovery" role="status">
      <div className="recovery-head">
        <span className="pill bad">Recovery Mode</span>
        <b>Mezo is protecting itself, some actions are switched off</b>
      </div>
      <p>
        The whole system's collateral ratio is {fmtPct(system.tcr)}, under the 150% line. While that lasts Mezo refuses the
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
          Closing a position: <b>{canClose === undefined ? "blocked unless Mezo can no longer mint MUSD" : canClose ? "still allowed right now" : "blocked"}</b>
        </li>
        <li>
          Adding collateral, repaying, listing, buying and rescue auctions: <b>still work</b>
        </li>
      </ul>
    </div>
  );
}

/** Small explanation shown under a button that Mezo's rules switched off. */
export function BlockedNote({ children }: { children?: React.ReactNode }) {
  return (
    <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
      {children ?? "Switched off while Mezo is in Recovery Mode."}
    </div>
  );
}
