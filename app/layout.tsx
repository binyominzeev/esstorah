import type { Metadata } from "next";
import Script from "next/script";
import localFont from "next/font/local";
import "./globals.css";
import { getNavStructure } from "@/lib/content";
import Sidebar from "@/components/Sidebar";
import TopControls from "@/components/TopControls";
import { AuthProvider } from "@/components/AuthProvider";

const fontHebrew = localFont({
  src: "./fonts/frank-ruhl-libre/FrankRuhlLibre.ttf",
  weight: "300 900",
  variable: "--font-hebrew",
  display: "swap",
});

// Self-hosted so the biblical Hebrew text renders correctly even for readers
// who don't have Taamey Frank installed locally. Files are GPLv2-licensed
// (Culmus project), fetched from Sefaria's public static assets.
const fontHebrewText = localFont({
  src: [
    { path: "../public/fonts/taamey-frank/TaameyFrankCLM-Medium.woff2", weight: "400", style: "normal" },
    { path: "../public/fonts/taamey-frank/TaameyFrankCLM-Bold.woff2", weight: "700", style: "normal" },
    { path: "../public/fonts/taamey-frank/TaameyFrankCLM-MediumOblique.woff2", weight: "400", style: "italic" },
    { path: "../public/fonts/taamey-frank/TaameyFrankCLM-BoldOblique.woff2", weight: "700", style: "italic" },
  ],
  variable: "--font-hebrew-text",
  display: "swap",
});

const fontBody = localFont({
  src: [
    { path: "./fonts/lora/Lora.ttf", weight: "400 700", style: "normal" },
    { path: "./fonts/lora/Lora-Italic.ttf", weight: "400 700", style: "italic" },
  ],
  variable: "--font-body",
  display: "swap",
});

const fontUi = localFont({
  src: "./fonts/inter/Inter.ttf",
  weight: "100 900",
  variable: "--font-ui",
  display: "swap",
});

export const metadata: Metadata = {
  title: "The Essentialist Torah",
  appleWebApp: {
    capable: true,
    title: "The Essentialist Torah",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const nav = getNavStructure();

  return (
    <html
      lang="hu"
      className={`${fontHebrew.variable} ${fontHebrewText.variable} ${fontBody.variable} ${fontUi.variable}`}
    >
      <body>
        <Script
          async
          src="https://www.googletagmanager.com/gtag/js?id=G-H8D9YRFC61"
          strategy="afterInteractive"
        />
        <AuthProvider>
          <TopControls />
          <Sidebar nav={nav} />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
