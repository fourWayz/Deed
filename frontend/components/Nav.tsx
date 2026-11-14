"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const CHAIN_ID = 31611;

const links = [
  { href: "/", label: "Home", icon: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { href: "/positions", label: "Positions", icon: "M4 7h16M4 12h16M4 17h10" },
  { href: "/market", label: "Market", icon: "M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9a3 3 0 0 0 5.3 1.9A3 3 0 0 0 12 12a3 3 0 0 0 2.7-1.1A3 3 0 0 0 20 9" },
  { href: "/rescue", label: "Rescue", icon: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" },
  { href: "/activity", label: "Activity", icon: "M3 12h4l3-8 4 16 3-8h4" },
];

function isActive(href: string, path: string) {
  return href === "/" ? path === "/" : href === "/positions" ? path.startsWith("/position") : path.startsWith(href);
}

export function Logo() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#3a58d6" />
      <path d="M9 8h7.5a8 8 0 0 1 0 16H9z" fill="none" stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="22.5" cy="9.5" r="2.4" fill="#fff" />
    </svg>
  );
}

/**
 * The nav bar itself. It renders the same on the server-side loading shell and in the live app, only the wallet slot
 * differs, so nothing moves when the wallet stack arrives.
 */
export function NavChrome({ end }: { end: React.ReactNode }) {
  const path = usePathname();
  return (
    <>
      <nav className="nav" aria-label="Main">
        <Link href="/" className="brand" aria-label="Deed, home">
          <Logo />
          Deed<span>.</span>
        </Link>
        <div className="links">
          {links.map((l) => {
            const active = isActive(l.href, path);
            return (
              <Link key={l.href} href={l.href} className={`nav-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
                {l.label}
              </Link>
            );
          })}
        </div>
        <div className="nav-end">{end}</div>
      </nav>
      <nav className="bottom-nav" aria-label="Sections">
        {links.map((l) => {
          const active = isActive(l.href, path);
          return (
            <Link key={l.href} href={l.href} className={`bn-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={l.icon} />
              </svg>
              {l.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export function NetworkPill() {
  const { isConnected, chainId } = useAccount();
  const wrong = isConnected && chainId !== CHAIN_ID;
  return (
    <span className={`net-pill${wrong ? " wrong" : ""}`} title={wrong ? "Switch your wallet to Mezo testnet" : "Mezo testnet, chain id 31611"}>
      <i aria-hidden="true" />
      <span>{wrong ? "Wrong network" : "Mezo testnet · 31611"}</span>
      {wrong && <span className="sr-only">Switch your wallet to Mezo testnet</span>}
    </span>
  );
}

export function Nav() {
  return (
    <NavChrome
      end={
        <>
          <NetworkPill />
          <ConnectButton chainStatus="none" showBalance={false} accountStatus="address" />
        </>
      }
    />
  );
}
