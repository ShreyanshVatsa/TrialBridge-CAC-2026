"use client";

import { Info, Pencil, Printer, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { format, localeFor, useLanguage, useMessages } from "@/components/i18n";
import { formatDate, formatNumber } from "@/components/format";
import type { SearchSession } from "@/components/session/session-provider";
import { Disclaimer } from "@/components/site/disclaimer";
import { TypingDots } from "@/components/site/spinner";
import { Button } from "@/components/ui/button";
import type { SearchProgress } from "@/lib/types";
import { cn } from "@/lib/utils";
import { findOutList, getCatalog } from "@/components/questionnaire/engine";
import { FindOutList } from "@/components/questionnaire/find-out-list";
import { isEssential, isNonResponse } from "@/components/questionnaire/contract";
import { useKeyT } from "@/components/questionnaire/t";
import { prioritizeFindOut } from "@/lib/match/criteria-rank";
import { ResultCard } from "./result-card";
import { TierBHeader, type TrialMatchView } from "./match-checklist";
import { StatusRow, rulesReasonOf, type AiState } from "./status-row";

const INITIAL_VISIBLE = 10;

/** A notice that changes how to read the list (distance or meaning search unavailable). Lavender, never amber. */
function Notice({ children }: { children: ReactNode }) {
  return (
    <div role="note" className="animate-enter flex items-start gap-3 rounded-2xl border border-border bg-secondary/60 px-4 py-3 text-foreground">
      <Info className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/**
 * Search in progress: a glass lens with a slow arc of light turning around it (the landing's lens, now
 * looking through the national dataset), the stage in words, and a liquid progress bar.
 */
export function SearchProgressView({ progress }: { progress: SearchProgress }) {
  const m = useMessages();
  const pct = progress.fraction === undefined ? null : Math.round(Math.min(1, Math.max(0, progress.fraction)) * 100);
  return (
    <div role="status" className="tb-surface animate-enter mx-auto max-w-lg rounded-3xl p-7 text-center sm:p-9">
      <div aria-hidden className="relative mx-auto size-28">
        <span className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,var(--lavender)_70deg,var(--primary)_110deg,transparent_160deg)] motion-safe:animate-[tb-spin_1.6s_linear_infinite]" />
        <span className="absolute inset-[5px] rounded-full bg-card shadow-[inset_0_1.5px_0_oklch(1_0_0/0.6),inset_0_-1px_0_oklch(0.2_0.06_295/0.15),0_10px_24px_-10px_var(--iris)]" />
        <span className="absolute inset-0 flex items-center justify-center font-heading text-3xl font-extrabold text-primary tabular-nums [font-stretch:66%]">
          {pct === null ? <TypingDots label="" className="text-primary" /> : `${pct}%`}
        </span>
      </div>
      <p className="mt-6 text-lg font-medium">{m.search.stage[progress.stage]}</p>
      <div
        className="mt-5 h-2.5 overflow-hidden rounded-full bg-muted shadow-[inset_0_1px_2px_oklch(0.2_0.06_295/0.18)]"
        role="progressbar"
        aria-label={m.search.progressLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
      >
        <div
          className={cn(
            "h-full rounded-full bg-[linear-gradient(90deg,var(--lavender),var(--primary))] transition-[width] duration-500 ease-out rtl:bg-[linear-gradient(270deg,var(--lavender),var(--primary))]",
            pct === null && "tb-shimmer w-1/3",
          )}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      {pct !== null && <p className="mt-2 text-sm text-muted-foreground">{format(m.search.percent, { pct })}</p>}
    </div>
  );
}

export function ResultsView({
  session,
  onEdit,
  onFill,
  onNewSearch,
  onWiden,
  matches,
  matchDegraded = false,
}: {
  session: SearchSession;
  /** Per-trial criteria score + labels keyed by NCT id. Optional; without it the list renders as before. */
  matches?: Readonly<Record<string, TrialMatchView>>;
  /** True when no real LLM answered (resolver-only labels): the status row says rules were used. */
  matchDegraded?: boolean;
  onEdit: () => void;
  /** Reopen the questions on the Find-out list ("Fill in what you found out"). */
  onFill?: (questionIds: string[]) => void;
  onNewSearch: () => void;
  onWiden: () => void;
}) {
  const m = useMessages();
  const t = useKeyT();
  const [visible, setVisible] = useState(INITIAL_VISIBLE);
  const locale = localeFor(useLanguage());
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), [session.searchedAt]);

  const { results, outcome, analysis } = session;
  const shown = results.slice(0, visible);
  // Tier B (a requirement may rule the person out) goes below the rest under its own heading; order within each tier is the ranker's.
  const tierA = matches ? shown.filter((r) => matches[r.card.id]?.score.tier !== "B") : shown;
  const tierB = matches ? shown.filter((r) => matches[r.card.id]?.score.tier === "B") : [];
  const today = formatDate(new Date(session.searchedAt).toISOString(), locale);
  // Find-out list and unknown-answer note (browser-only; built from the questionnaire state).
  const qState = session.answers.questionnaire;
  // Questions whose answer would settle the most unknown criteria in these trials come first.
  const priority = session.criteria?.findOutPriority;
  const findOut = useMemo(() => {
    const list = qState ? findOutList(qState, getCatalog("cancer", session.answers.cancerType)) : [];
    return prioritizeFindOut(list, priority ?? {});
  }, [qState, session.answers.cancerType, priority]);
  const sexAnswer = qState?.answers.sex;
  const unknownCount = qState ? Object.entries(qState.answers).filter(([id, v]) => !isEssential(id) && (isNonResponse(v) || qState.deferred.includes(id))).length : 0;
  const rulesOnly = matchDegraded ? rulesReasonOf(session.criteria?.degradedReason) : undefined;
  const aiState: AiState =
    analysis.status === "pending"
      ? { kind: "working" }
      : analysis.status === "ok"
        ? { kind: "done", trials: results.filter((r) => r.analysis).length, experimental: analysis.experimental, ...(rulesOnly ? { rulesOnly } : {}) }
        : analysis.status === "degraded" || rulesOnly
          ? { kind: "rules", ...(rulesOnly ? { reason: rulesOnly } : {}) }
          : { kind: "off" };
  // Notices that narrow or explain the list, collapsed behind one "Filters applied" chip.
  const filters: ReactNode[] = [];
  if (sexAnswer === "female" || sexAnswer === "male") {
    filters.push(
      <>
        {t(`questionnaire.ui.sexHidden.${sexAnswer}`)}{" "}
        {onFill && (
          <Button variant="link" className="no-print h-auto min-h-0 p-0 align-baseline" onClick={() => onFill(["sex"])}>
            {t("questionnaire.ui.sexHiddenChange")}
          </Button>
        )}
      </>,
    );
  }
  if (outcome.zipApproximate) filters.push(m.results.zipApproximate);
  if (unknownCount > 0) filters.push(t("results.findOutUnknownNote", { count: unknownCount }));

  return (
    <div className="space-y-6">
      <div className="print-only">
        <h1 className="text-3xl font-semibold">{m.results.printTitle}</h1>
        <p className="mt-1">{format(m.results.printIntro, { date: today })}</p>
      </div>

      <div className="relative flex flex-col gap-4">
        <div aria-hidden className="tb-head-bloom" />
        <div>
          <h1 ref={headingRef} tabIndex={-1} className="tb-display text-[clamp(2.25rem,5vw,3.75rem)] outline-none">
            {m.results.title}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {format(m.results.count, { shown: shown.length, total: formatNumber(outcome.candidateCount, locale) })}{" "}
            {format(m.results.searched, { count: formatNumber(outcome.searchedCount, locale) })}
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil aria-hidden />
            {m.results.editAnswers}
          </Button>
          <Button variant="outline" size="sm" onClick={onNewSearch}>
            <RotateCcw aria-hidden />
            {m.results.newSearch}
          </Button>
          {results.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer aria-hidden />
              {m.results.print}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <StatusRow ai={aiState} filters={filters} />
        <Disclaimer compact />
      </div>
      {outcome.distanceUnavailable && <Notice>{m.results.distanceUnavailable}</Notice>}
      {outcome.keywordOnly && <Notice>{m.results.keywordOnly}</Notice>}

      {results.length === 0 ? (
        <div className="tb-surface rounded-3xl p-8 text-center sm:p-10">
          <h2 className="text-[2rem] leading-[1.02] font-bold [font-stretch:70%]">{m.results.emptyTitle}</h2>
          <p className="mx-auto mt-2 max-w-prose text-muted-foreground">{m.results.emptyBody}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            {session.answers.travelMiles !== null && <Button onClick={onWiden}>{m.results.emptyWiden}</Button>}
            <Button variant="outline" onClick={onEdit}>
              {m.results.editAnswers}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ol className="space-y-6">
            {tierA.map((t, i) => (
              <li key={t.card.id} className="animate-enter" style={{ animationDelay: `${Math.min(i, 6) * 70}ms` }}>
                <ResultCard trial={t} index={i} match={matches?.[t.card.id]} />
              </li>
            ))}
          </ol>
          {tierB.length > 0 && (
            <section aria-labelledby="tier-b" className="space-y-6">
              <TierBHeader id="tier-b" />
              <ol start={tierA.length + 1} className="space-y-6">
                {tierB.map((t, i) => (
                  <li key={t.card.id}>
                    <ResultCard trial={t} index={tierA.length + i} match={matches?.[t.card.id]} />
                  </li>
                ))}
              </ol>
            </section>
          )}
          {results.length > visible && (
            <div className="no-print flex justify-center">
              <Button variant="outline" onClick={() => setVisible(results.length)}>
                {m.common.showMore}
              </Button>
            </div>
          )}
        </>
      )}

      <FindOutList entries={findOut} onFill={onFill && findOut.length > 0 ? () => onFill(findOut.map((e) => e.question)) : undefined} className="find-out-print" />
    </div>
  );
}
