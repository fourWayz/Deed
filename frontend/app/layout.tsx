import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";
import { Shell } from "./Shell";

// both faces are downloaded at build time and served from this site, nothing is requested from Google by the browser
const heading = Bricolage_Grotesque({ subsets: ["latin"], weight: ["600", "700", "800"], display: "swap", variable: "--font-heading-face" });
const text = Inter({ subsets: ["latin"], display: "swap", variable: "--font-text-face" });

// absolute urls for the share image: an explicit site url, else the Vercel host, else local
const site =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
  "http://localhost:3000";

const description = "Sell, buy and rescue Mezo borrowing positions. Each MUSD loan lives in a vault and the Deed NFT is the key to it.";

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: "Deed: sell your MUSD loan", template: "%s · Deed" },
  description,
  applicationName: "Deed",
  openGraph: {
    type: "website",
    siteName: "Deed",
    title: "Deed: sell your MUSD loan",
    description,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Deed, a marketplace for Mezo borrowing positions" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Deed: sell your MUSD loan",
    description,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = { themeColor: "#eef2fb", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${heading.variable} ${text.variable}`}>
      <body>
        <a href="#main" className="skip">
          Skip to content
        </a>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
