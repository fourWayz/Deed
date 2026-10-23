"use client";

import { Providers } from "./providers";
import { Nav } from "@/components/Nav";

export default function Inner({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <Nav />
      <main className="wrap">{children}</main>
    </Providers>
  );
}
