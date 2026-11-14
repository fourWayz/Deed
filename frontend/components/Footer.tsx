import { ADDR, EXPLORER, deployed } from "@/lib/config";

const REPO = "https://github.com/fourWayz/Deed";

const rows: [string, string][] = [
  ["Deed NFT", ADDR.deed],
  ["Factory", ADDR.factory],
  ["Market", ADDR.market],
  ["Rescue auction", ADDR.auction],
  ["Lens", ADDR.lens],
];

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-card">
        <div>
          <b style={{ color: "var(--ink)", fontFamily: "var(--font-heading)", fontSize: "1.1rem" }}>Deed</b>
          <p style={{ margin: "6px 0 0", lineHeight: 1.55 }}>
            Testnet only (Mezo, chain 31611). The contracts are not audited. Nothing here is financial advice.
          </p>
          <p style={{ margin: "10px 0 0" }}>
            <a className="foot-link" style={{ display: "inline-flex", borderBottom: 0 }} href={REPO} target="_blank" rel="noreferrer">
              <b>Source on GitHub</b>
            </a>
          </p>
        </div>
        <div className="foot-links">
          {deployed ? (
            rows.map(([name, addr]) => (
              <a key={name} className="foot-link" href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer">
                <b>{name}</b>
                <span>
                  {addr.slice(0, 6)}…{addr.slice(-4)}
                </span>
              </a>
            ))
          ) : (
            <span>Contract addresses are not configured.</span>
          )}
        </div>
      </div>
    </footer>
  );
}
