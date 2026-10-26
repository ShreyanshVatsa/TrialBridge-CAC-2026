"use client";

import { WifiOff } from "lucide-react";
import { useMessages } from "@/components/i18n";
import { Button } from "@/components/ui/button";

export function OfflinePage() {
  const m = useMessages();
  return (
    <main id="main" className="relative flex flex-1 items-center px-4 py-20">
      <div aria-hidden className="tb-ambient pointer-events-none absolute inset-x-0 -top-40 -z-10 h-[34rem] [mask-image:linear-gradient(to_bottom,black_40%,transparent)]" />
      <div className="tb-surface animate-enter mx-auto max-w-md rounded-3xl p-8 text-center sm:p-10">
        {/* A lens over the signal glyph, the same motif as the home page. */}
        <span aria-hidden className="tb-glass relative mx-auto flex size-24 items-center justify-center rounded-full bg-secondary text-primary">
          <WifiOff className="size-10" />
        </span>
        <h1 className="tb-display mt-7 text-[clamp(2.25rem,6vw,3rem)]">{m.pwa.offlineTitle}</h1>
        <p className="mt-4 text-muted-foreground">{m.pwa.offlineBody}</p>
        <Button size="lg" className="mt-7 min-h-12 px-7" onClick={() => window.location.reload()}>
          {m.common.retry}
        </Button>
      </div>
    </main>
  );
}
