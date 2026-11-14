"use client";

import dynamic from "next/dynamic";
import { NavChrome } from "@/components/Nav";
import { Footer } from "@/components/Footer";

// What shows while the wallet stack loads: the same bar and footer, with a placeholder where the wallet button goes,
// so the page does not jump when the real one arrives.
function Loading() {
  return (
    <>
      <NavChrome
        end={
          <span className="wallet-slot" aria-hidden="true">
            <span className="skeleton-line" />
          </span>
        }
      />
      <main className="wrap" id="main" />
      <Footer />
    </>
  );
}

// the wallet stack touches `document` while loading, so it only runs in the browser
const Inner = dynamic(() => import("./Inner"), { ssr: false, loading: () => <Loading /> });

export function Shell({ children }: { children: React.ReactNode }) {
  return <Inner>{children}</Inner>;
}
