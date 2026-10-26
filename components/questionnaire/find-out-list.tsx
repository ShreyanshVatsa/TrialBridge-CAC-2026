"use client";

import { ClipboardList, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FindOutEntry } from "./contract";
import { useKeyT } from "./t";

/**
 * "Find out at your next appointment" (spec §5.3): one item per unknown, skipped or deferred question,
 * most useful first. Shown on the summary, the results page and the print view (as a checklist).
 * Never sent anywhere.
 */
export function FindOutList({
  entries,
  onFill,
  headingLevel = 2,
  className,
}: {
  entries: readonly FindOutEntry[];
  onFill?: () => void;
  headingLevel?: 2 | 3;
  className?: string;
}) {
  const t = useKeyT();
  if (entries.length === 0) return null;
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby="find-out-title" className={cn("find-out tb-surface rounded-3xl p-5 sm:p-7", className)}>
      <H id="find-out-title" className="flex items-center gap-2 text-[1.75rem] leading-[1.05] font-bold [font-stretch:72%]">
        <ClipboardList aria-hidden className="size-5 shrink-0 text-primary" />
        <span className="no-print">{t("results.findOutTitle")}</span>
        <span className="print-only">{t("results.findOutPrintTitle")}</span>
      </H>
      <p className="mt-1 text-muted-foreground">{t("results.findOutIntro")}</p>
      <ul className="mt-4 space-y-4">
        {entries.map((e) => (
          <li key={e.question} className="flex items-start gap-3 border-t border-border pt-4 first:border-0 first:pt-0">
            {/* Tick box for the printed checklist. */}
            <span aria-hidden className="print-only mt-1 size-5 shrink-0 rounded border-2 border-current" />
            <div className="min-w-0 space-y-1">
              {/* The text already starts with "Ask: ..." so no extra label (it used to read "Ask: Ask: ..."). */}
              <p className="font-medium">{t(e.whatKey)}</p>
              {e.whereKey && t.has(e.whereKey) && (
                <p>
                  <span className="text-muted-foreground">{t("results.findOutWhere")}: </span>
                  {t(e.whereKey)}
                </p>
              )}
              {e.whyKey && t.has(e.whyKey) && (
                <p>
                  <span className="text-muted-foreground">{t("results.findOutWhy")}: </span>
                  {t(e.whyKey)}
                </p>
              )}
              {e.deferred && (
                <p className="inline-flex rounded-full border border-border px-3 py-0.5 text-base text-muted-foreground">{t("results.findOutWaiting")}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-base text-muted-foreground">
          <Lock aria-hidden className="size-4 shrink-0" />
          {t("results.findOutPrivate")}
        </p>
        {onFill && (
          <Button variant="outline" onClick={onFill} className="no-print min-h-11">
            {t("results.findOutFill")}
          </Button>
        )}
      </div>
    </section>
  );
}
