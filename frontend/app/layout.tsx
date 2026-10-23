import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "./Shell";

export const metadata: Metadata = {
  title: "Deed",
  description: "A marketplace for Mezo borrowing positions",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
