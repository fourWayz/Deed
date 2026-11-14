"use client";

import { usePathname } from "next/navigation";
import { Providers } from "./providers";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

export default function Inner({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <Providers>
      <Nav />
      <main className="wrap" id="main" tabIndex={-1}>
        {/* keyed on the route so each page eases in */}
        <div key={path} className="page">
          {children}
        </div>
      </main>
      <Footer />
    </Providers>
  );
}
