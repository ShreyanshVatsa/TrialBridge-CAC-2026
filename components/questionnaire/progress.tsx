"use client";

import { Check } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";
import type { LiveCount, Tier } from "./contract";
import { useKeyT } from "./t";

const TIERS: Tier[] = ["essential", "helpful", "deep"];

/** "N possible trials near you · M with no likely conflicts", debounced 500 ms, announced politely only on change. */
function LiveCounter({ count, className }: { count: LiveCount | null; className?: string }) {
  const t = useKeyT();
  const text = count
    ? `${t("questionnaire.ui.counter", { count: count.total })}${count.noConflict !== count.total ? ` · ${t("questionnaire.ui.counterNoConflict", { count: count.noConflict })}` : ""}`
    : t("questionnaire.ui.counterWaiting");
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (text === shown) return;
    const id = setTimeout(() => setShown(text), 500);
    return () => clearTimeout(id);
  }, [text, shown]);
  return (
    <p className={cn("text-base font-medium", !count && "font-normal text-muted-foreground", className)}>
      <span className="sr-only">{t("questionnaire.ui.counterLabel")}: </span>
      <span aria-live="polite" aria-atomic="true" data-testid="live-counter">
        {shown}
      </span>
    </p>
  );
}

/**
 * Three-segment step bar ("Essentials, Helpful, Extra detail") with an honest range instead of a percentage.
 * Each segment is a liquid meter: finished tiers are full, the current one fills as its questions are
 * answered (`fill`, 0-1, an estimate the engine can revise), with a lit leading edge. A hairline across the
 * top of the window mirrors the same progress while the bar itself is scrolled away. Both are decoration:
 * the step names, the "current step" marker and the remaining range carry the meaning.
 */
export function TierProgress({ tier, remaining, count, fill = 0 }: { tier: Tier | "summary"; remaining: number | null; count: LiveCount | null; fill?: number }) {
  const t = useKeyT();
  const currentIdx = tier === "summary" ? TIERS.length : TIERS.indexOf(tier);
  const level = (i: number) => (i < currentIdx ? 1 : i === currentIdx ? Math.min(0.94, Math.max(0.06, fill)) : 0);
  const overall = Math.min(1, (Math.min(currentIdx, TIERS.length) + (currentIdx < TIERS.length ? level(currentIdx) : 0)) / TIERS.length);
  // The engine decides when to stop, so show a range (never a fake exact number).
  const remainingText =
    remaining === null || tier === "summary"
      ? null
      : remaining <= 0
        ? t("questionnaire.ui.remainingNone")
        : remaining <= 2
          ? t("questionnaire.ui.remainingFew")
          : t("questionnaire.ui.remainingRange", { low: Math.max(2, remaining - 1), high: remaining + 2 });
  return (
    <div className="tb-surface rounded-3xl px-4 py-4 sm:px-5">
      <span aria-hidden className="no-print pointer-events-none fixed inset-x-0 top-0 z-40 h-[3px]">
        <span
          className="block h-full origin-left bg-[linear-gradient(90deg,var(--lavender),var(--primary))] shadow-[0_0_12px_var(--primary)] transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] rtl:origin-right"
          style={{ transform: `scaleX(${overall})` }}
        />
      </span>
      <nav aria-label={t("questionnaire.ui.progressLabel")}>
        <ol className="grid grid-cols-3 gap-2 sm:gap-3">
          {TIERS.map((x, i) => {
            const done = i < currentIdx;
            const current = i === currentIdx;
            const f = level(i);
            return (
              <li key={x} aria-current={current ? "step" : undefined} className="min-w-0 space-y-2">
                <span aria-hidden className="relative block h-2 overflow-hidden rounded-full bg-muted shadow-[inset_0_1px_2px_oklch(0.2_0.06_295/0.18)]">
                  <span
                    className="absolute inset-y-0 start-0 rounded-full bg-[linear-gradient(90deg,color-mix(in_oklch,var(--primary)_70%,var(--lavender)),var(--primary))] shadow-[inset_0_1px_0_oklch(1_0_0/0.35)] transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] rtl:bg-[linear-gradient(270deg,color-mix(in_oklch,var(--primary)_70%,var(--lavender)),var(--primary))]"
                    style={{ width: `${f * 100}%` }}
                  >
                    {current && f > 0 && <span className="absolute inset-y-0 end-0 w-2 rounded-full bg-lavender shadow-[0_0_10px_2px_var(--lavender)] motion-safe:animate-pulse" />}
                  </span>
                </span>
                <span className={cn("flex items-center gap-1 text-base leading-tight", current ? "font-semibold text-foreground" : "text-muted-foreground")}>
                  {done && <Check aria-hidden className="size-4 shrink-0 text-primary" />}
                  <span className="min-w-0 break-words">{t(`questionnaire.ui.tiers.${x}`)}</span>
                  {done && <span className="sr-only">{t("questionnaire.ui.stepDone")}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-border pt-3">
        <LiveCounter count={count} />
        {remainingText && <p className="text-base text-muted-foreground">{remainingText}</p>}
      </div>
    </div>
  );
}

/** Quick / Thorough segmented control (a radio group, changeable at any time). */
export function ModeToggle({ mode, onChange }: { mode: "quick" | "thorough"; onChange: (m: "quick" | "thorough") => void }) {
  const t = useKeyT();
  const name = useId();
  const labelId = useId();
  const opts = [
    { id: "quick" as const, label: t("questionnaire.ui.modeQuick"), help: t("questionnaire.ui.modeQuickHelp") },
    { id: "thorough" as const, label: t("questionnaire.ui.modeThorough"), help: t("questionnaire.ui.modeThoroughHelp") },
  ];
  return (
    <div className="space-y-2">
      <p id={labelId} className="font-medium">
        {t("questionnaire.ui.modeLabel")} <span className="font-normal text-muted-foreground">{t("questionnaire.ui.modeNote")}</span>
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className="inline-grid w-full grid-cols-2 gap-1 rounded-2xl border border-border bg-muted/70 p-1 shadow-[inset_0_1px_3px_oklch(0.2_0.06_295/0.12)] sm:w-auto">
        {opts.map((o) => {
          const on = mode === o.id;
          return (
            <label
              key={o.id}
              className={cn(
                "flex min-h-11 cursor-pointer flex-col justify-center rounded-xl px-4 py-2 text-start transition-[background-color,box-shadow,color] duration-300 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                on ? "tb-surface-flat font-semibold ring-1 ring-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <input type="radio" name={name} value={o.id} checked={on} onChange={() => onChange(o.id)} className="sr-only" />
              <span className={cn(on ? "text-foreground" : "")}>{o.label}</span>
              <span className="text-base font-normal text-muted-foreground">{o.help}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
