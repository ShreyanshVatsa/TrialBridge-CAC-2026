"use client";

import { useMessages } from "@/components/i18n";

export function SkipLink() {
  const m = useMessages();
  return (
    <a
      href="#main"
      className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:start-3"
    >
      {m.common.skipToContent}
    </a>
  );
}
