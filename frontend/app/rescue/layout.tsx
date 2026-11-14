import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rescue",
  description: "Dutch auctions for positions near liquidation. Win one and the position leaves safely collateralised.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
