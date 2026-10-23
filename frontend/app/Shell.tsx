"use client";

import dynamic from "next/dynamic";

// the wallet stack touches `document` while loading, so it only runs in the browser
const Inner = dynamic(() => import("./Inner"), {
  ssr: false,
  loading: () => <div className="wrap" style={{ paddingTop: 80 }} />,
});

export function Shell({ children }: { children: React.ReactNode }) {
  return <Inner>{children}</Inner>;
}
