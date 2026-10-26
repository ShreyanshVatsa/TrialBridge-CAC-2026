import type { Metadata, Viewport } from "next";
import "./globals.css";
import { anybody, atkinson } from "./fonts";
import { en } from "@/components/i18n/en";
import { SessionProvider } from "@/components/session/session-provider";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { DocumentMeta } from "@/components/site/document-meta";
import { ServiceWorkerRegister } from "@/components/site/sw-register";
import { SkipLink } from "@/components/site/skip-link";
import { PointerFx } from "@/components/fx/pointer-fx";
import { LanguageReady } from "@/components/i18n";
import { LanguageSuggest, TranslationNote } from "@/components/i18n/translation-note";

export const metadata: Metadata = {
  title: { default: en.meta.title, template: "%s · TrialBridge" },
  description: en.meta.description,
  applicationName: "TrialBridge",
  appleWebApp: { capable: true, title: "TrialBridge", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4fb" },
    { media: "(prefers-color-scheme: dark)", color: "#150e26" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: /theme-init.js may add the "dark" class before React hydrates.
    <html lang="en" dir="ltr" suppressHydrationWarning className={`${atkinson.variable} ${anybody.variable}`}>
      <head>
        {/* Blocking on purpose: sets theme + language before first paint (tiny, same-origin, CSP-safe). */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-init.js" />
      </head>
      <body className="flex min-h-dvh flex-col">
        <LanguageReady />
        <DocumentMeta />
        <SkipLink />
        <SessionProvider>
          {/* The page is a sheet that lifts off the footer waiting underneath it (see .tb-sheet). */}
          <div className="tb-sheet relative z-10 flex flex-1 flex-col">
            <SiteHeader />
            <LanguageSuggest />
            <TranslationNote />
            {children}
          </div>
          <SiteFooter />
          <PointerFx />
          <ServiceWorkerRegister />
        </SessionProvider>
      </body>
    </html>
  );
}
