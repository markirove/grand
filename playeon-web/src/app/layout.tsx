import type { Metadata, Viewport } from "next";
import { Onest, Geist_Mono, Rubik } from "next/font/google";
import Script from "next/script";

import { TelegramInit } from "./telegram-init";
import "./globals.css";

const onest = Onest({
  variable: "--font-onest",
  subsets: ["latin"],
  display: "swap",
});

const rubik = Rubik({
  variable: "--font-rubik",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Playeon",
    template: "%s · Playeon",
  },
  description: "Playeon",
  applicationName: "Playeon",
  appleWebApp: {
    capable: true,
    title: "Playeon",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // required for env(safe-area-inset-*) to resolve in the mini app
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f4" },
    { media: "(prefers-color-scheme: dark)", color: "#08080a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${onest.variable} ${rubik.variable} ${geistMono.variable} h-full antialiased`}
      // telegram-web-app.js sets --tg-viewport-* inline on <html> before
      // hydration, and TelegramInit adds data-theme; neither exists on the server
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/*
          Safari pinned tabs need a monochrome SVG mask. Declared here rather
          than in `metadata.icons`, because setting that key drops the app-dir
          icon.png / apple-icon.png tags. React hoists this into <head>.
        */}
        <link rel="mask-icon" href="/safari-pinned-tab.svg" color="#3a48a0" />
        {/* must run before hydration so WebApp exists when TelegramInit mounts */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js?59"
          strategy="beforeInteractive"
        />
        <TelegramInit />
        {children}
      </body>
    </html>
  );
}
