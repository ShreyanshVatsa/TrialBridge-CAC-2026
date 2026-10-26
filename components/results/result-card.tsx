"use client";

import Link from "next/link";
import { ExternalLink, Mail, MapPin, MessageCircleQuestion, Phone } from "lucide-react";
import type { ReactNode } from "react";
import { format, useMessages } from "@/components/i18n";
import { formatMiles, formatPhases, officialUrl, trialHref } from "@/components/format";
import { buttonVariants } from "@/components/ui/button";
import type { CriterionAssessment, RankedTrial } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BarrierBadge, Badge, FitBadge, LanguageWarning, Quote, TierBBadge } from "./badges";
import { CriteriaChecklist, FitSummary, HardFailureNote, screeningIds, type TrialMatchView } from "./match-checklist";

interface Point {
  key: string;
  quote: string;
  ref: { section: "inclusion" | "exclusion"; n: number };
  explanation?: string;
  /** Fact key the quote was matched on (rule pre-check), so a long criterion shows the clause that carries it. */
  focus?: string;
}

const MAX_POINTS = 2;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** True when a quoted point (12+ chars, so a stray word never matches) is the same requirement as a stored criterion text. */
function sameRequirement(quote: string, texts: readonly string[]): boolean {
  const q = norm(quote);
  return q.length >= 12 && texts.some((t) => t.length > 0 && (t.includes(q) || q.includes(t)));
}

function fromAnalysis(items: CriterionAssessment[]): Point[] {
  return items.map((c) => ({
    key: `${c.section}-${c.number}`,
    quote: c.quote,
    ref: { section: c.section, n: c.number },
    explanation: c.explanation,
  }));
}

function PointList({ title, points, tone }: { title: string; points: Point[]; tone: "fit" | "risk" | "ask" }) {
  if (points.length === 0) return null;
  return (
    <section>
      <h4
        className={cn(
          "font-sans text-base font-semibold",
          tone === "risk" ? "text-warn-foreground" : tone === "fit" ? "text-success-foreground" : "text-foreground",
        )}
      >
        {title}
      </h4>
      <ul className="mt-1 space-y-3">
        {points.slice(0, MAX_POINTS).map((p) => (
          <li key={p.key}>
            {p.explanation && <p>{p.explanation}</p>}
            <Quote text={p.quote} criterionRef={p.ref} focus={p.focus ?? true} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ContactLine({ trial }: { trial: RankedTrial }) {
  const m = useMessages();
  const c = trial.card.contacts.find((x) => x.phone || x.email) ?? trial.card.contacts[0];
  if (!c) return <p className="text-muted-foreground">{m.card.contactNone}</p>;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {c.name && <span className="font-medium">{c.name}</span>}
      {c.phone && (
        <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline">
          <Phone className="size-4" aria-hidden />
          {c.phone}
        </a>
      )}
      {c.email && (
        <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 break-all text-primary underline-offset-4 hover:underline">
          <Mail className="size-4" aria-hidden />
          {c.email}
        </a>
      )}
    </div>
  );
}

/** `match` (per-criterion score + labels) is optional: without it the card renders as before. */
function oncePerCriterion(points: Point[]): Point[] {
  const seen = new Set<string>();
  return points.filter((p) => {
    const id = `${p.ref.section}-${p.ref.n}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function ResultCard({ trial, index, match }: { trial: RankedTrial; index: number; match?: TrialMatchView }) {
  const m = useMessages();
  const { card, analysis, nearest, precheck } = trial;
  const phase = formatPhases(card.phases);
  const titleId = `trial-${card.id}-title`;

  // Two facts can point at one criterion (HER2 and HR in the same sentence); its quote is shown once.
  const why: Point[] = oncePerCriterion(
    analysis
      ? fromAnalysis(analysis.criteria.filter((c) => c.assessment === "likely_met"))
      : precheck.filter((p) => p.kind === "support").map((p) => ({ key: `${p.ref.section}-${p.ref.n}-${p.key}`, quote: p.quote, ref: p.ref, focus: p.key })),
  );
  const ruleOut: Point[] = oncePerCriterion(
    analysis
      ? fromAnalysis(analysis.criteria.filter((c) => c.assessment === "likely_not_met"))
      : precheck.filter((p) => p.kind === "conflict").map((p) => ({ key: `${p.ref.section}-${p.ref.n}-${p.key}`, quote: p.quote, ref: p.ref, focus: p.key })),
  );
  const needsDoctor: Point[] = analysis ? fromAnalysis(analysis.criteria.filter((c) => c.assessment === "needs_doctor")) : [];
  // Tier B: the requirement that may not fit is shown once, in its own note. The older wording (fit chip,
  // summary) and lists would contradict it or repeat it, so they give way.
  const tierB = match?.score.tier === "B";
  const failTexts = tierB
    ? match.score.hardFailures.map((f) => card.criteria?.find((c) => c.id === f.id)?.text).filter((t): t is string => Boolean(t)).map(norm)
    : [];
  const keep = (p: Point) => !sameRequirement(p.quote, failTexts);
  // Tier A: the checklist and the "nothing we found rules you out" line say no requirement clearly fails, so a
  // pre-check conflict (a rule the checklist could not settle) is shown as something to check, not as a rule-out.
  const lists = tierB
    ? { why: why.filter(keep), ruleOut: ruleOut.filter(keep), needsDoctor: needsDoctor.filter(keep) }
    : match
      ? { why, ruleOut: [], needsDoctor: [...needsDoctor, ...ruleOut.filter((p) => !needsDoctor.some((d) => d.key === p.key))] }
      : { why, ruleOut, needsDoctor };
  const hardId = `trial-${card.id}-hard`;
  const questions: readonly string[] = analysis && analysis.doctorQuestions.length > 0 ? analysis.doctorQuestions : m.card.defaultQuestions;

  let section: ReactNode = null;
  if (!tierB && why.length + lists.ruleOut.length + lists.needsDoctor.length === 0) {
    section = <p className="text-muted-foreground">{m.card.noAnalysis}</p>;
  }

  return (
    <article aria-labelledby={titleId} data-tier={tierB ? "B" : "A"} className={cn("tb-surface tb-spec tb-press rounded-3xl p-5 sm:p-7", tierB && "border-dashed opacity-95 saturate-[0.85]")}>
      {/* Rank numeral drawn from data-rank by CSS: decoration only (the list order and the sr-only number
          already say it), kept out of the text so it is never read twice. */}
      <span
        aria-hidden
        data-rank={String(index + 1).padStart(2, "0")}
        className="pointer-events-none absolute end-6 top-4 hidden font-heading text-[3.5rem] leading-none font-extrabold text-foreground/[0.08] [font-stretch:60%] before:content-[attr(data-rank)] sm:block"
      />
      <div className="mb-3 flex flex-wrap items-center gap-2 sm:pe-16">
        <Badge>{phase ? format(m.card.phase, { phase }) : m.card.phaseNone}</Badge>
        {card.sex !== "ALL" && <Badge>{m.trial.sex[card.sex]}</Badge>}
        <span className="text-sm text-muted-foreground tabular-nums">{card.id}</span>
      </div>
      <h3 id={titleId} className="text-[1.375rem] leading-[1.08] font-bold text-balance [font-stretch:74%] sm:pe-16 sm:text-[1.75rem]">
        <span className="sr-only">{index + 1}. </span>
        <Link href={trialHref(card.id)} className="decoration-primary/50 decoration-2 underline-offset-[5px] transition-colors hover:text-primary hover:underline">
          {card.title}
        </Link>
      </h3>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {tierB ? <TierBBadge href={`#${hardId}`} /> : trial.scores.fit && <FitBadge level={trial.scores.fit} />}
        {nearest && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-2.5 py-1 text-sm leading-tight">
            <MapPin className="size-3.5 shrink-0 text-primary" aria-hidden />
            <span>
              {format(m.card.nearest, { facility: nearest.site.facility, city: nearest.site.city, state: nearest.site.state })}
              {" · "}
              <strong className="font-semibold">
                {nearest.miles === null ? m.card.distanceUnknown : format(m.card.distance, { miles: formatMiles(nearest.miles) })}
              </strong>
            </span>
          </span>
        )}
        {!match && trial.scores.unknowns !== undefined && trial.scores.unknowns > 0 && <span className="text-sm text-muted-foreground">{format(m.card.unknowns, { n: String(trial.scores.unknowns) })}</span>}
      </div>

      {(card.barriers.length > 0 || trial.languageWarning) && (
        <div className="mt-3 space-y-2">
          {card.barriers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {card.barriers.map((b, i) => (
                <BarrierBadge key={`${b.type}-${i}`} barrier={b} />
              ))}
            </div>
          )}
          {trial.languageWarning && <LanguageWarning />}
        </div>
      )}

      {match && (
        <div id={hardId} className="scroll-mt-28">
          <FitSummary score={match.score} screening={screeningIds(match.labels, card.criteria).size} className="mt-4" />
          {tierB && <HardFailureNote failures={match.score.hardFailures} criteria={card.criteria} className="mt-4" />}
        </div>
      )}

      {tierB ? <p className="mt-4 leading-relaxed">{m.match.tierBSummary}</p> : analysis?.summary && <p className="mt-4 leading-relaxed">{analysis.summary}</p>}

      <div className="mt-4 space-y-5">
        <PointList title={m.card.whyFit} points={lists.why} tone="fit" />
        <PointList title={m.card.ruleOut} points={lists.ruleOut} tone="risk" />
        <PointList title={m.card.needsDoctor} points={lists.needsDoctor} tone="ask" />
        {section}
        {match && <CriteriaChecklist labels={match.labels} criteria={card.criteria} />}
        <div className="grid gap-5 sm:grid-cols-[1.4fr_1fr]">
          <section>
            <h4 className="font-sans text-base font-semibold">{m.card.askDoctor}</h4>
            <ul className="mt-1 list-disc space-y-1 ps-5">
              {questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </section>
          <section>
            <h4 className="font-sans text-base font-semibold">{m.card.contact}</h4>
            <ContactLine trial={trial} />
          </section>
        </div>
      </div>

      <div className="no-print mt-6 flex flex-wrap gap-3 border-t border-border pt-5">
        <Link href={`${trialHref(card.id)}#ask`} className={buttonVariants({ variant: "default" })}>
          <MessageCircleQuestion aria-hidden />
          {m.ask.button}
        </Link>
        <Link href={trialHref(card.id)} className={buttonVariants({ variant: "outline" })}>
          {m.card.details}
        </Link>
        <a href={officialUrl(card.id)} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline" })}>
          {m.card.official}
          <ExternalLink aria-hidden />
          <span className="sr-only">{m.common.opensNewTab}</span>
        </a>
      </div>
    </article>
  );
}
