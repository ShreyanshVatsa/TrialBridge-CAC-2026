"use client";

import { AlertTriangle, ChevronDown, CircleCheck, CircleHelp, CircleX } from "lucide-react";
import type { ReactNode } from "react";
import { format, useMessages, useT } from "@/components/i18n";
import type { CriterionLabel, CriterionLabelValue, SplitCriterionRecord as SplitCriterion, TrialMatchScore } from "@/lib/types";
import { isScreeningItem } from "@/lib/match/screening";
import { cn } from "@/lib/utils";
import { Quote } from "./badges";

/** What the results UI needs per trial from the criteria ranking (score + per-criterion labels). */
export interface TrialMatchView {
  score: TrialMatchScore;
  labels: CriterionLabel[];
}

type Mark = "pass" | "fail" | "unknown" | "na";

export function markOf(label: CriterionLabelValue): Mark {
  switch (label) {
    case "met":
    case "not_excluded":
      return "pass";
    case "not_met":
    case "excluded":
      return "fail";
    case "unknown":
      return "unknown";
    default:
      return "na";
  }
}

/** Unknown items the study team checks at screening (labs, consent, contraception): shown apart, never "open questions". */
export function screeningIds(labels: readonly CriterionLabel[], criteria: readonly SplitCriterion[] | undefined): Set<string> {
  const lookup = byId(criteria);
  return new Set(labels.filter((l) => l.label === "unknown" && lookup.has(l.id) && isScreeningItem(lookup.get(l.id)!)).map((l) => l.id));
}

/** Our stored criterion text by id; the model's text is never shown. */
function byId(criteria: readonly SplitCriterion[] | undefined): Map<string, SplitCriterion> {
  return new Map((criteria ?? []).map((c) => [c.id, c]));
}

function criterionNumber(id: string): string {
  return id.replace(/^[IE]/, "");
}

const markIcon: Record<Exclude<Mark, "na">, ReactNode> = {
  pass: <CircleCheck className="size-5 text-success-foreground" aria-hidden />,
  fail: <CircleX className="size-5 text-warn-foreground" aria-hidden />,
  unknown: <CircleHelp className="size-5 text-muted-foreground" aria-hidden />,
};

function CriterionRow({ label, criterion, screening = false }: { label: CriterionLabel; criterion: SplitCriterion; screening?: boolean }) {
  const m = useMessages();
  const mark = markOf(label.label) as Exclude<Mark, "na">;
  return (
    <li data-mark={mark} data-id={label.id} className="grid grid-cols-[1.5rem_1fr] gap-3 py-3">
      <span className="pt-0.5">{markIcon[mark]}</span>
      <div className="min-w-0 space-y-1">
        <p className={cn("text-sm font-semibold", mark === "fail" ? "text-warn-foreground" : mark === "pass" ? "text-success-foreground" : "text-foreground")}>
          {screening ? m.match.screeningStatus : m.match.status[label.label]}
          <span className="font-normal text-muted-foreground">
            {" · "}
            {format(m.card.criterionRef[criterion.section], { n: criterionNumber(criterion.id) })}
            {label.source !== "default" && ` · ${m.match.source[label.source]}`}
          </span>
        </p>
        {criterion.scope && (
          <p lang="en" className="text-sm text-muted-foreground">
            {criterion.scope}
          </p>
        )}
        <blockquote lang="en" className="border-s-2 border-primary/40 ps-3 text-[0.9375rem] leading-relaxed whitespace-pre-line text-foreground/90">
          {criterion.text}
        </blockquote>
        {label.reason && !screening && <p className="text-sm text-muted-foreground">{label.reason}</p>}
      </div>
    </li>
  );
}

/**
 * Per-trial expandable checklist: ✓ looks met / ✗ may not fit / ? unknown, each with OUR stored criterion text
 * (looked up by id), the plain-English reason and who settled it. Not-applicable items are counted, not listed.
 */
export function CriteriaChecklist({
  labels,
  criteria,
  defaultOpen = false,
  className,
}: {
  labels: readonly CriterionLabel[];
  criteria: readonly SplitCriterion[] | undefined;
  defaultOpen?: boolean;
  className?: string;
}) {
  const m = useMessages();
  const { t } = useT();
  const lookup = byId(criteria);
  const screening = screeningIds(labels, criteria);
  const visible = labels.filter((l) => markOf(l.label) !== "na" && lookup.has(l.id));
  const shown = visible.filter((l) => !screening.has(l.id));
  const atScreening = visible.filter((l) => screening.has(l.id));
  const naCount = labels.filter((l) => markOf(l.label) === "na" && lookup.has(l.id)).length;
  if (visible.length === 0 && naCount === 0) return null;

  const tally = { pass: 0, fail: 0, unknown: 0 };
  for (const l of shown) tally[markOf(l.label) as keyof typeof tally]++;
  const sections = (["inclusion", "exclusion"] as const)
    .map((section) => ({ section, rows: shown.filter((l) => lookup.get(l.id)!.section === section) }))
    .filter((s) => s.rows.length > 0);

  return (
    <details open={defaultOpen} className={cn("group rounded-2xl border border-border bg-card/60", className)}>
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3.5 transition-colors hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
        <span className="font-sans text-base font-semibold">{m.match.checklistShow}</span>
        <span className="flex flex-wrap gap-1.5 text-sm text-muted-foreground [&>span]:rounded-full [&>span]:bg-muted [&>span]:px-2.5 [&>span]:py-0.5 [&>span]:tabular-nums">
          <span className="!bg-success !text-success-foreground">✓ {format(m.match.counts.met, { n: tally.pass })}</span>
          <span>✗ {format(m.match.counts.fail, { n: tally.fail })}</span>
          <span>? {format(m.match.counts.unknown, { n: tally.unknown })}</span>
          {atScreening.length > 0 && <span>{format(m.match.counts.screening, { n: atScreening.length })}</span>}
        </span>
        <ChevronDown className="ms-auto size-5 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-border px-4 pb-4">
        <p className="pt-3 text-sm text-muted-foreground">{m.match.checklistIntro}</p>
        {sections.map(({ section, rows }) => (
          <section key={section} className="mt-3">
            <h5 className="font-sans text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              {section === "inclusion" ? m.match.inclusionHeading : m.match.exclusionHeading}
            </h5>
            <ul className="divide-y divide-border/70">
              {rows.map((l) => (
                <CriterionRow key={l.id} label={l} criterion={lookup.get(l.id)!} />
              ))}
            </ul>
          </section>
        ))}
        {atScreening.length > 0 && (
          <details data-group="screening" className="mt-4 rounded-xl border border-border/70 px-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 font-sans text-sm font-semibold [&::-webkit-details-marker]:hidden">
              {m.match.screeningHeading} ({atScreening.length})
              <ChevronDown className="ms-auto size-4 shrink-0" aria-hidden />
            </summary>
            <p className="text-sm text-muted-foreground">{m.match.screeningIntro}</p>
            <ul className="divide-y divide-border/70">
              {atScreening.map((l) => (
                <CriterionRow key={l.id} label={l} criterion={lookup.get(l.id)!} screening />
              ))}
            </ul>
          </details>
        )}
        {naCount > 0 && <p className="mt-3 text-sm text-muted-foreground">{t("match.notApplicable", { count: naCount })}</p>}
      </div>
    </details>
  );
}

/**
 * The card's one-glance fit line: a plain headline and a segmented bar of the requirements we could check (looks met /
 * to confirm / may not fit). Lavender tints only; amber stays reserved for barrier flags. The bar is decoration: the
 * legend under it carries the same numbers as text. `screening` = unknown items the study team checks at screening;
 * they are neither "checkable" nor "to confirm".
 */
export function FitSummary({ score, screening = 0, className }: { score: TrialMatchScore; screening?: number; className?: string }) {
  const m = useMessages();
  const { t } = useT();
  // Cleared exclusions count as "looks met", the same as the checklist under it.
  const met = score.counts.met + score.counts.notExcluded;
  const fail = score.tier === "B" ? Math.max(1, score.hardFailures.length, score.counts.notMet) : score.counts.notMet;
  const unknown = Math.max(0, score.counts.unknown - screening);
  const total = Math.max(1, met + fail + unknown);
  const headline =
    score.tier === "B"
      ? t("match.fit.headlineTierB", { count: Math.max(1, score.hardFailures.length) })
      : met > 0
        ? format(m.match.fit.headline, { met, checked: met + fail + unknown })
        : m.match.fit.headlineNone;
  const seg = (n: number, cls: string) => (n > 0 ? <span className={cn("h-full first:rounded-s-full last:rounded-e-full", cls)} style={{ width: `${(100 * n) / total}%` }} /> : null);
  return (
    <div className={cn("space-y-2", className)}>
      <p className="font-semibold text-foreground">{headline}</p>
      <div aria-hidden className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted shadow-[inset_0_1px_2px_oklch(0.2_0.06_295/0.18)]">
        {seg(met, "bg-primary")}
        {seg(unknown, "bg-[repeating-linear-gradient(135deg,var(--lavender)_0_6px,color-mix(in_oklch,var(--lavender)_50%,transparent)_6px_10px)]")}
        {seg(fail, "bg-foreground/55")}
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-primary" />
          {format(m.match.counts.met, { n: met })}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-lavender" />
          {format(m.match.fit.toConfirm, { n: unknown })}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-foreground/55" />
          {format(m.match.counts.fail, { n: fail })}
        </span>
      </p>
    </div>
  );
}

/** Tier B card note: the failing requirement(s) as our stored text plus the reason. */
export function HardFailureNote({ failures, criteria, className }: { failures: readonly CriterionLabel[]; criteria: readonly SplitCriterion[] | undefined; className?: string }) {
  const m = useMessages();
  const lookup = byId(criteria);
  const rows = failures.filter((f) => lookup.has(f.id));
  if (rows.length === 0) return null;
  return (
    <div className={cn("rounded-2xl border border-warn-border bg-warn/60 p-4 text-warn-foreground", className)}>
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {m.match.hardFailureTitle}
      </p>
      <ul className="mt-2 space-y-3">
        {rows.map((f) => {
          const c = lookup.get(f.id)!;
          return (
            <li key={f.id} className="text-foreground">
              {f.reason && <p className="font-medium">{f.reason}</p>}
              <Quote text={c.text} focus className="[&_blockquote]:border-warn-border" />
              <p className="mt-1 ps-3 text-sm text-muted-foreground">{format(m.card.criterionRef[c.section], { n: criterionNumber(c.id) })}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Heading above the tier B list. */
export function TierBHeader({ id = "tier-b", className }: { id?: string; className?: string }) {
  const m = useMessages();
  return (
    <div className={cn("border-t border-foreground/12 pt-6", className)}>
      <h2 id={id} className="text-[clamp(1.5rem,3vw,2rem)] leading-[1.05] font-bold [font-stretch:70%]">
        {m.match.tierBTitle}
      </h2>
      <p className="mt-2 max-w-prose text-muted-foreground">{m.match.tierBIntro}</p>
    </div>
  );
}

