"use client";

import { Info } from "lucide-react";
import { useMessages } from "@/components/i18n";
import { cn } from "@/lib/utils";

/** Persistent "not medical advice" notice shown on matching and trial pages; `compact` is one quiet line, no box. */
export function Disclaimer({ className, compact }: { className?: string; compact?: boolean }) {
  const m = useMessages();
  if (compact) {
    return (
      <aside aria-label={m.disclaimer.label} className={cn("flex items-start gap-2 text-sm leading-snug text-muted-foreground", className)}>
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p>{m.disclaimer.text}</p>
      </aside>
    );
  }
  return (
    <aside
      aria-label={m.disclaimer.label}
      className={cn("flex items-start gap-3 rounded-2xl border border-border bg-muted/60 px-4 py-3 text-sm leading-relaxed text-foreground", className)}
    >
      <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <p>{m.disclaimer.text}</p>
    </aside>
  );
}
