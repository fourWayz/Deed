import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Get started",
  description: "Three steps from an empty wallet to a position for sale on Mezo testnet.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
