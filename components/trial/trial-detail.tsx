"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink, Mail, MapPin, MessageCircleQuestion, Phone } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { format, localeFor, useLanguage, useMessages } from "@/components/i18n";
import { formatDate, formatMiles, formatPhases, loadErrorCode, officialUrl } from "@/components/format";
import { BarrierBadge, Badge } from "@/components/results/badges";
import { useSession } from "@/components/session/session-provider";
import { Disclaimer } from "@/components/site/disclaimer";
import { ErrorView } from "@/components/site/error-view";
import { Skeleton } from "@/components/site/skeleton";
import { SectionRail } from "@/components/site/section-rail";
import { AskPanel } from "./ask-panel";
import { CriteriaChecklist, HardFailureNote, type TrialMatchView } from "@/components/results/match-checklist";
import { buttonVariants } from "@/components/ui/button";
import { loadTrial } from "@/lib/data/loader";
import { sortSitesByDistance } from "@/lib/match/filters";
import type { Criterion, Site, TrialCard } from "@/lib/types";

const NCT_ID = /^NCT\d{8}$/;

type State =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "not_found" }
  | { kind: "error"; code: ReturnType<typeof loadErrorCode> }
  | { kind: "ok"; card: TrialCard; sites: Site[] };

const INITIAL_SITES = 10;

/** Titles that differ only in case, spacing or punctuation are the same title (the registry often repeats it). */
function sameTitle(a: string, b: string): boolean {
  const k = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return k(a) === k(b);
}

function Section({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className="tb-reveal scroll-mt-28 border-t border-foreground/12 pt-8">
      <h2 id={`${id}-t`} className="text-[clamp(1.75rem,3vw,2.35rem)] leading-[1.02] font-bold [font-stretch:70%]">
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/**
 * Eligibility criteria typeset as the official document they are: a sheet of paper with a running head,
 * criterion numbers hanging in the margin and a hairline between rules. The text is the registry's, verbatim.
 */
function CriteriaDocument({ title, items, empty, tone }: { title: string; items: Criterion[]; empty: string; tone: "in" | "out" }) {
  return (
    <figure className="tb-surface relative overflow-hidden rounded-2xl">
      <span aria-hidden className={`absolute inset-y-0 start-0 w-1 ${tone === "in" ? "bg-primary" : "bg-muted-foreground/50"}`} />
      <figcaption className="flex items-baseline justify-between gap-4 border-b border-border px-5 py-4 ps-7 sm:px-8 sm:ps-10">
        <h3 className="font-sans text-lg font-semibold [font-stretch:100%]">{title}</h3>
        {items.length > 0 && (
          <span aria-hidden className="font-heading text-2xl leading-none font-extrabold text-primary tabular-nums [font-stretch:64%]">
            {items.length}
          </span>
        )}
      </figcaption>
      {items.length === 0 ? (
        <p className="px-5 py-5 ps-7 text-muted-foreground sm:px-8 sm:ps-10">{empty}</p>
      ) : (
        <ol lang="en" className="divide-y divide-border/70 px-5 ps-7 sm:px-8 sm:ps-10">
          {items.map((c) => (
            <li key={c.n} className="grid grid-cols-[2rem_1fr] gap-3 py-3.5 leading-relaxed sm:grid-cols-[2.75rem_1fr]">
              <span className="pt-0.5 font-heading text-lg leading-snug font-bold text-muted-foreground tabular-nums [font-stretch:70%]">{c.n}.</span>
              <span className="whitespace-pre-line">{c.text}</span>
            </li>
          ))}
        </ol>
      )}
    </figure>
  );
}

function ageText(card: TrialCard, m: ReturnType<typeof useMessages>): string {
  if (card.minAge !== null && card.maxAge !== null) return format(m.trial.ageRange, { range: `${card.minAge}–${card.maxAge}` });
  if (card.minAge !== null) return format(m.trial.ageMin, { min: card.minAge });
  if (card.maxAge !== null) return format(m.trial.ageMax, { max: card.maxAge });
  return m.trial.ageAny;
}

function TrialBody({ card, sites, match }: { card: TrialCard; sites: Site[]; match?: TrialMatchView }) {
  const m = useMessages();
  const locale = localeFor(useLanguage());
  const { session } = useSession();
  const origin = session?.origin ?? null;
  const [showAll, setShowAll] = useState(false);
  const sorted = useMemo(() => sortSitesByDistance(sites, origin), [sites, origin]);
  const visibleSites = showAll ? sorted : sorted.slice(0, INITIAL_SITES);
  const phase = formatPhases(card.phases);

  useEffect(() => {
    document.title = `${card.title} · TrialBridge`;
  }, [card.title]);

  const rail = [
    { id: "tested", label: m.trial.tested },
    { id: "who", label: m.trial.whoMight },
    { id: "barriers", label: m.trial.barriers },
    { id: "sites", label: m.trial.sites },
    { id: "contact", label: m.trial.contact },
    { id: "ask", label: m.ask.title },
  ];

  return (
    <article className="space-y-10">
      <header className="relative max-w-5xl space-y-5">
        <div aria-hidden className="tb-head-bloom" />
        {session && (
          <Link href="/find/" className="group/back no-print inline-flex min-h-11 items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline">
            <ArrowLeft className="size-4 transition-transform duration-300 group-hover/back:-translate-x-1 rtl:-scale-x-100 rtl:group-hover/back:translate-x-1" aria-hidden />
            {m.trial.backToResults}
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{phase ? format(m.card.phase, { phase }) : m.card.phaseNone}</Badge>
          <span className="text-sm text-muted-foreground">{card.id}</span>
        </div>
        <h1 className="tb-display animate-enter text-[clamp(1.9rem,3.6vw,3rem)]">{card.title}</h1>
        {card.officialTitle && sameTitle(card.officialTitle, card.title) === false && <p className="max-w-[75ch] text-lg text-muted-foreground">{card.officialTitle}</p>}
        {/* Spec sheet: three facts on hairlines, like the masthead of a printed protocol. */}
        <dl className="grid border-y border-foreground/12 text-sm sm:grid-cols-3 sm:divide-x sm:divide-foreground/12">
          <div className="py-3 sm:pe-5">
            <dt className="text-muted-foreground">{m.trial.sponsor}</dt>
            <dd className="mt-0.5 text-base font-medium">{card.sponsor}</dd>
          </div>
          <div className="border-t border-foreground/12 py-3 sm:border-t-0 sm:px-5">
            <dt className="text-muted-foreground">{m.trial.conditions}</dt>
            <dd className="mt-0.5 text-base font-medium">{card.conditions.join(", ")}</dd>
          </div>
          <div className="border-t border-foreground/12 py-3 sm:border-t-0 sm:ps-5">
            <dt className="sr-only">{m.trial.lastUpdated}</dt>
            <dd className="text-muted-foreground sm:pt-[1.3rem]">{format(m.trial.lastUpdated, { date: formatDate(card.lastUpdated, locale) })}</dd>
          </div>
        </dl>
        <div className="no-print flex flex-wrap gap-3">
          <a href="#ask" className={buttonVariants({ variant: "default" })}>
            <MessageCircleQuestion aria-hidden />
            {m.ask.button}
          </a>
          <a href={officialUrl(card.id)} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline" })}>
            {m.trial.official}
            <ExternalLink aria-hidden />
            <span className="sr-only">{m.common.opensNewTab}</span>
          </a>
        </div>
      </header>

      <div className="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16">
      <SectionRail items={rail} label={card.id} />
      <div className="min-w-0 max-w-3xl space-y-12">
      <div className="space-y-3">
        <Disclaimer />
        <p className="text-sm text-muted-foreground">{m.trial.officialOnly}</p>
      </div>

      <Section title={m.trial.tested} id="tested">
        <p className="max-w-prose text-[1.0625rem] leading-relaxed whitespace-pre-line" lang="en">
          {card.summary}
        </p>
      </Section>

      <Section title={m.trial.whoMight} id="who">
        <ul className="mb-6 flex flex-wrap gap-2">
          <li>
            <Badge>{ageText(card, m)}</Badge>
          </li>
          <li>
            <Badge>{m.trial.sex[card.sex]}</Badge>
          </li>
        </ul>
        <div className="space-y-6">
          {match && match.score.tier === "B" && <HardFailureNote failures={match.score.hardFailures} criteria={card.criteria} />}
          {match && <CriteriaChecklist labels={match.labels} criteria={card.criteria} defaultOpen />}
          <CriteriaDocument title={m.trial.inclusion} items={card.inclusion} empty={m.trial.inclusionNone} tone="in" />
          <CriteriaDocument title={m.trial.exclusion} items={card.exclusion} empty={m.trial.exclusionNone} tone="out" />
        </div>
      </Section>

      <Section title={m.trial.barriers} id="barriers">
        {card.barriers.length === 0 ? (
          <p className="text-muted-foreground">{m.trial.barriersNone}</p>
        ) : (
          <ul className="space-y-3">
            {card.barriers.map((b, i) => (
              <li key={`${b.type}-${i}`}>
                <BarrierBadge barrier={b} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={m.trial.sites} id="sites">
        {origin && <p className="mb-3 text-sm text-muted-foreground">{m.trial.sitesNearest}</p>}
        <ul className="tb-surface divide-y divide-border overflow-hidden rounded-2xl">
          {visibleSites.map(({ site, miles }, i) => (
            <li key={`${site.facility}-${site.zip}-${i}`} className="flex items-start justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50 sm:px-5">
              <div className="flex items-start gap-3">
                <span aria-hidden className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                  <MapPin className="size-3.5" />
                </span>
                <div>
                  <p className="font-medium">{site.facility}</p>
                  <p className="text-sm text-muted-foreground">
                    {site.city}, {site.state} {site.zip}
                  </p>
                </div>
              </div>
              {miles !== null && (
                <span className="shrink-0 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-sm font-medium tabular-nums">{format(m.card.distance, { miles: formatMiles(miles) })}</span>
              )}
            </li>
          ))}
        </ul>
        {!showAll && sorted.length > INITIAL_SITES && (
          <button type="button" onClick={() => setShowAll(true)} className="mt-3 min-h-11 font-medium text-primary underline-offset-4 hover:underline">
            {format(m.trial.sitesAll, { count: sorted.length })}
          </button>
        )}
      </Section>

      <Section title={m.trial.contact} id="contact">
        {card.contacts.length === 0 ? (
          <p className="text-muted-foreground">{m.card.contactNone}</p>
        ) : (
          <ul className="space-y-3">
            {card.contacts.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-4 gap-y-1">
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
              </li>
            ))}
          </ul>
        )}
      </Section>

      <AskPanel nctId={card.id} />
      </div>
      </div>
    </article>
  );
}

/** Single dynamic trial page: reads ?id=NCT… and loads the trial from the static shards on the client. */
/** `getMatch` looks up the score + labels for this trial from the current search; optional. */
export function TrialDetail({ getMatch }: { getMatch?: (nctId: string) => TrialMatchView | undefined } = {}) {
  const m = useMessages();
  const params = useSearchParams();
  const rawId = (params.get("id") ?? "").trim().toUpperCase();
  const validId = NCT_ID.test(rawId);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((a) => a + 1);
  }, []);

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    loadTrial(rawId)
      .then((res) => {
        if (cancelled) return;
        setState(res ? { kind: "ok", card: res.card, sites: res.sites } : { kind: "not_found" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const code = loadErrorCode(err);
        setState(code === "not_found" ? { kind: "not_found" } : { kind: "error", code });
      });
    return () => {
      cancelled = true;
    };
  }, [rawId, validId, attempt]);

  const current: State = validId ? state : { kind: "invalid" };

  return (
    // min-h keeps the footer below the fold while loading, so content arriving doesn't shift it.
    <main id="main" className="mx-auto min-h-dvh w-full max-w-7xl flex-1 px-4 pt-8 pb-24 sm:px-6 sm:pt-14 sm:pb-32">
      {current.kind === "loading" && <TrialSkeleton label={m.trial.loading} />}
      {current.kind === "invalid" && <ErrorView title={m.trial.notFoundTitle} body={m.trial.invalidId} />}
      {current.kind === "not_found" && <ErrorView title={m.trial.notFoundTitle} body={m.trial.notFoundBody} />}
      {current.kind === "error" && (
        <ErrorView body={typeof navigator !== "undefined" && !navigator.onLine ? m.common.offline : m.trial.errorBody} onRetry={retry} />
      )}
      {current.kind === "ok" && <TrialBody card={current.card} sites={current.sites} match={getMatch?.(current.card.id)} />}
    </main>
  );
}

/** Same shapes as the loaded page (title, spec sheet, buttons, rail, first sections), so nothing jumps. */
function TrialSkeleton({ label }: { label: string }) {
  return (
    <div role="status" className="space-y-10">
      <span className="sr-only">{label}</span>
      <div className="max-w-5xl space-y-5">
        <Skeleton className="h-7 w-44 rounded-full" />
        <Skeleton className="h-12 w-full rounded-xl sm:h-14" />
        <Skeleton className="h-12 w-3/4 rounded-xl sm:h-14" />
        <Skeleton className="h-6 w-2/3" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-11 w-48 rounded-full" />
          <Skeleton className="h-11 w-72 rounded-full" />
        </div>
      </div>
      <div className="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16">
        <div className="hidden space-y-3 lg:block">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-5 w-40" />
          ))}
        </div>
        <div className="max-w-3xl space-y-6">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

export function TrialLoading() {
  const m = useMessages();
  return (
    <main id="main" className="mx-auto min-h-dvh w-full max-w-7xl flex-1 px-4 pt-8 pb-24 sm:px-6 sm:pt-14 sm:pb-32">
      <TrialSkeleton label={m.trial.loading} />
    </main>
  );
}
