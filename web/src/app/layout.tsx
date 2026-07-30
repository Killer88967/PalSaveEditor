import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "PalSaveEditor — Palworld save decompiler, recompiler and editor",
    template: "%s · PalSaveEditor",
  },
  description:
    "Decompile, inspect, edit and recompile Palworld .sav files. Reads both zlib (PlZ) and Oodle Kraken (PlM) containers, with a Rust parser and a validated export.",
  applicationName: "PalSaveEditor",
  keywords: [
    "Palworld",
    "save editor",
    "sav decompiler",
    "GVAS",
    "Level.sav",
    "Oodle Kraken",
    "uesave",
  ],
  openGraph: {
    title: "PalSaveEditor",
    description:
      "Decompile, inspect, edit and recompile Palworld save files with a Rust-powered parser.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1220" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="btn btn-primary sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
