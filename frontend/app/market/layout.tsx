import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Market",
  description: "Mezo borrowing positions for sale at a fixed MUSD price, each with a snapshot of what you get.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
