import type { Metadata } from "next";

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const id = /^\d+$/.test(params.id) ? params.id : "?";
  return { title: `Deed #${id}`, description: `Health, debt and actions for Deed #${id} on Mezo testnet.` };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
