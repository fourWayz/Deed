"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const links = [
  { href: "/", label: "My Positions" },
  { href: "/market", label: "Market" },
  { href: "/rescue", label: "Rescue" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      <Link href="/" className="brand">
        Deed<span>.</span>
      </Link>
      <div className="links">
        {links.map((l) => {
          const active = l.href === "/" ? path === "/" || path.startsWith("/position") : path.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} className={active ? "active" : ""}>
              {l.label}
            </Link>
          );
        })}
      </div>
      <ConnectButton chainStatus="icon" showBalance={false} accountStatus="address" />
    </nav>
  );
}
