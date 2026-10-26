"use client";

import "./globals.css";
import { en } from "@/components/i18n/en";

/** Last-resort boundary when the root layout itself fails. Plain markup, no stack traces. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center bg-background px-4 text-foreground">
        <main role="alert" className="tb-surface max-w-md rounded-3xl p-8 text-center sm:p-10">
          <h1 className="tb-display text-4xl">{en.errors.title}</h1>
          <p className="mt-2 text-muted-foreground">{en.errors.body}</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <button type="button" onClick={reset} className="tb-btn-primary min-h-12 rounded-full bg-primary px-6 font-medium text-primary-foreground">
              {en.common.retry}
            </button>
            {/* Full reload on purpose: the app shell is broken. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="tb-btn-glass inline-flex min-h-12 items-center rounded-full border border-border px-6 font-medium">
              {en.common.home}
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
