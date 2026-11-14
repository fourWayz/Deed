import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My positions",
  description: "Open a Mezo borrowing position in its own vault and manage the Deed that controls it.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
