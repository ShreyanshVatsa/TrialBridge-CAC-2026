"use client";

import { ChevronDown, ShieldCheck, SlidersHorizontal, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { format, useMessages } from "@/components/i18n";
import { TypingDots } from "@/components/site/spinner";
import { cn } from "@/lib/utils";

/** Why requirements were checked with rules only: the free AI capacity ran out, or the AI step failed. */
export type RulesReason = "budget" | "unavailable";

/** The criteria step's degraded reason as a RulesReason: a used-up daily budget or rate limit says so. */
export function rulesReasonOf(reason?: string): RulesReason {
  return reason === "budget_exhausted" || reason === "rate_limited" ? "budget" : "unavailable";
}

/** What the AI step is doing, as one calm state for the results header. */
export type AiState =
  | { kind: "working" }
  | { kind: "done"; trials: number; experimental: boolean; rulesOnly?: RulesReason }
  | { kind: "rules"; reason?: RulesReason }
  | { kind: "off" };

const chip = "inline-flex min-h-9 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm leading-tight shadow-[var(--rim)]";

/**
 * One status row above the results instead of a stack of banners: the AI step (working, done, or rules-only, never
 * amber: amber is reserved for barrier flags) and a "filters applied" disclosure. The results are complete without AI;
 * the rules-only state says so plainly. Details live in disclosures so the first result card stays near the top.
 */
export function StatusRow({ ai, filters, className }: { ai: AiState; filters: ReactNode[]; className?: string }) {
  const m = useMessages();
  const s = m.results.status;
  let aiChip: ReactNode = null;
  let aiDetail: ReactNode = null;
  if (ai.kind === "working") {
    aiChip = (
      <span className={cn(chip, "border-primary/25 bg-secondary/70")}>
        <TypingDots label="" className="text-primary" />
        {s.working}
      </span>
    );
  } else if (ai.kind === "done") {
    aiChip = (
      <span className={cn(chip, "border-primary/25 bg-secondary/70")}>
        <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
        {ai.trials > 0 ? format(s.doneTrials, { n: ai.trials }) : s.done}
      </span>
    );
    aiDetail = (
      <>
        {m.results.aiNote}
        {ai.experimental && <span className="mt-1 block font-medium">{m.results.experimental}</span>}
        {ai.rulesOnly && <span className="mt-1 block">{ai.rulesOnly === "budget" ? m.match.degradedBudget : m.match.degraded}</span>}
      </>
    );
  } else if (ai.kind === "rules") {
    aiChip = (
      <span className={cn(chip, "border-primary/25 bg-secondary/70")}>
        <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden />
        {s.rules}
      </span>
    );
    aiDetail = (
      <>
        {s.rulesDetail}
        <span className="mt-1 block">{ai.reason === "budget" ? m.match.degradedBudget : m.match.degraded}</span>
      </>
    );
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="contents" aria-live="polite">
        {aiChip}
        {filters.length > 0 && (
          <span className={cn(chip, "border-border bg-background/60")}>
            <SlidersHorizontal className="size-4 shrink-0 text-primary" aria-hidden />
            {format(s.filters, { n: filters.length })}
          </span>
        )}
      </div>
      {/* Closed: one link at the end of the chip row. Open: takes the full width under it. */}
      {(aiDetail || filters.length > 0) && (
        <details className="group text-sm open:basis-full">
          <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 px-1 font-medium text-primary underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
            {s.details}
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="tb-pop-in mt-2 space-y-2 rounded-2xl border border-border bg-secondary/40 p-4">
            {aiDetail && <li>{aiDetail}</li>}
            {filters.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
