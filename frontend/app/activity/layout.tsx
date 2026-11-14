import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Activity",
  description: "What the Deed contracts have done on Mezo testnet, counted from the indexer and the chain.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
