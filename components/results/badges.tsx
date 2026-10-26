"use client";

import { AlertTriangle, ChevronDown, CircleHelp, CircleCheck, CircleMinus, Languages } from "lucide-react";
import type { ReactNode } from "react";
import { format, useMessages } from "@/components/i18n";
import { focusQuote } from "@/lib/match/quote-focus";
import type { Barrier, CriterionRef, FitLevel } from "@/lib/types";
import { cn } from "@/lib/utils";

const badgeBase = "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium leading-none shadow-[var(--rim)]";

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn(badgeBase, "border-border bg-muted text-foreground", className)}>{children}</span>;
}

const fitStyle: Record<FitLevel, string> = {
  strong: "border-success-foreground/30 bg-success text-success-foreground shadow-[var(--rim),0_4px_12px_-6px_var(--success-foreground)]",
  possible: "border-primary/30 bg-secondary text-secondary-foreground",
  unlikely: "border-border bg-muted text-muted-foreground",
  unclear: "border-border bg-muted text-foreground",
};

const fitIcon: Record<FitLevel, ReactNode> = {
  strong: <CircleCheck className="size-4" aria-hidden />,
  possible: <CircleCheck className="size-4" aria-hidden />,
  unlikely: <CircleMinus className="size-4" aria-hidden />,
  unclear: <CircleHelp className="size-4" aria-hidden />,
};

export function FitBadge({ level }: { level: FitLevel }) {
  const m = useMessages();
  return (
    <span className={cn(badgeBase, fitStyle[level])}>
      {fitIcon[level]}
      {m.card.fit[level]}
    </span>
  );
}

const warnBadge = "border-warn-border bg-warn text-warn-foreground";

/** Tier B chip in place of the fit chip: links to the card's note on the requirement that may not fit. */
export function TierBBadge({ href }: { href: string }) {
  const m = useMessages();
  return (
    <a href={href} className={cn(badgeBase, warnBadge, "underline-offset-4 hover:underline")}>
      <AlertTriangle className="size-4" aria-hidden />
      {m.match.tierBBadge}
    </a>
  );
}

/** Barrier badge with an expandable explanation quoting the exact triggering sentence. */
export function BarrierBadge({ barrier }: { barrier: Barrier }) {
  const m = useMessages();
  return (
    <details className="group">
      <summary className={cn(badgeBase, warnBadge, "min-h-8 cursor-pointer list-none transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[var(--rim),0_6px_14px_-8px_oklch(0.6_0.12_60)] [&::-webkit-details-marker]:hidden")}>
        <AlertTriangle className="size-4" aria-hidden />
        {m.card.barrier[barrier.type]}
        <span className="sr-only">: {m.card.barrierWhy}</span>
      </summary>
      <div className="tb-pop-in mt-2 max-w-prose origin-top rounded-2xl border border-warn-border bg-warn/60 p-4 text-sm shadow-[var(--shadow-1)]">
        <p className="font-medium">{m.card.barrierWhy}</p>
        <Quote text={barrier.quote} criterionRef={barrier.ref} />
      </div>
    </details>
  );
}

export function LanguageWarning() {
  const m = useMessages();
  return (
    <p className={cn("flex items-start gap-2 rounded-xl border px-3 py-2 text-sm", warnBadge)}>
      <Languages className="mt-0.5 size-4 shrink-0" aria-hidden />
      {m.card.languageWarning}
    </p>
  );
}

/**
 * Verbatim official criterion text, visually marked as a quote with its criterion number. With `focus` (a fact key, or
 * true for none) a long quote shows only the clause that carries it, with the whole text one click away.
 */
export function Quote({ text, criterionRef, className, focus }: { text: string; criterionRef?: CriterionRef; className?: string; focus?: string | true }) {
  const m = useMessages();
  const excerpt = focus === undefined ? { text, partial: false } : focusQuote(text, focus === true ? undefined : focus);
  return (
    <figure className={cn("mt-1.5", className)}>
      <blockquote lang="en" className="border-s-2 border-primary/50 ps-3 text-foreground/90 italic">
        “{excerpt.text}”
      </blockquote>
      {(criterionRef || excerpt.partial) && (
        <figcaption className="mt-1 flex flex-wrap items-baseline gap-x-3 ps-3 text-sm text-muted-foreground">
          {criterionRef && <span>{format(m.card.criterionRef[criterionRef.section], { n: criterionRef.n })}</span>}
          {excerpt.partial && (
            <details className="group/full w-full">
              <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1 font-medium text-primary underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
                {m.card.showFull}
                <ChevronDown className="size-3.5 transition-transform group-open/full:rotate-180" aria-hidden />
              </summary>
              <blockquote lang="en" className="mt-2 border-s-2 border-border ps-3 text-foreground/90 whitespace-pre-line">
                {text}
              </blockquote>
            </details>
          )}
        </figcaption>
      )}
    </figure>
  );
}
