"use client";

import { useEffect, useRef, useState } from "react";
import { loadErrorCode } from "@/components/format";
import { useMessages } from "@/components/i18n";
import { emptyState, type QuestionnaireState } from "@/components/questionnaire/contract";
import { clearSession } from "@/components/questionnaire/engine";
import { QuestionnaireFlow } from "@/components/questionnaire/questionnaire-flow";
import { ResultsView, SearchProgressView } from "@/components/results/results-view";
import { useSession } from "@/components/session/session-provider";
import { Disclaimer } from "@/components/site/disclaimer";
import { ErrorView } from "@/components/site/error-view";
import { PageHead } from "@/components/site/page-head";
import { useDemoMode } from "@/lib/api/demo-mode";
import { lookupZip } from "@/lib/data/loader";
import type { IntakeAnswers, Language, RankedTrial, SearchProgress } from "@/lib/types";

type Status =
  | { kind: "idle" }
  | { kind: "searching"; progress: SearchProgress }
  | { kind: "error"; code: ReturnType<typeof loadErrorCode>; answers: IntakeAnswers };

const TURNSTILE_TIMEOUT_MS = 30_000;
/** Trials that get an AI explanation: the first ones in the final order (functions/lib/analyze.ts ANALYZE.maxTrials). */
const ANALYZE_TOP_N = 3;
/**
 * Longest wait, once results are in, for the criterion judge and explanations before the list is shown, so it appears
 * once in its final order instead of re-ordering on screen. Cached answers arrive in well under a second; a live
 * free-tier provider can take a minute, so the list then shows after this wait and re-orders when the judge answers.
 * The demo replays recorded answers, so it can wait longer.
 */
const REVEAL_WAIT_MS = 2500;
const DEMO_REVEAL_WAIT_MS = 12_000;
const warmedUp = new Set<string>();

/** User Timing marks for profiling ("tb:results", "tb:judge", "tb:analysis"). */
function mark(name: string): void {
  if (typeof performance !== "undefined" && typeof performance.mark === "function") performance.mark(`tb:${name}`);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error("failed"));
      },
    );
  });
}

/**
 * Orchestrates intake -> on-device search -> AI explanations.
 * Questionnaire answers stay in the browser (memory + this tab's sessionStorage). Only `requestAnalysis` talks to
 * the backend, and it sends the minimized profile (no ZIP, no exact age, no free text) plus trial IDs.
 */
export function FindFlow() {
  const m = useMessages();
  const { questionnaire, setQuestionnaire, session, setSession } = useSession();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // "Fill in what you found out" from the results page reopens exactly those questions.
  const [fillRequest, setFillRequest] = useState<string[] | null>(null);
  // Results came from the fictional sample patient: say so above them.
  const [sample, setSample] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const demo = useDemoMode();
  // false from a search's results until the AI answers settle or the reveal wait passes (see REVEAL_WAIT_MS).
  const [revealed, setRevealed] = useState(true);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The demo server was recognized after the page started: open on the demo start screen, not a resumed session.
  useEffect(() => {
    if (!demo || session || status.kind !== "idle") return;
    clearSession();
    void Promise.resolve().then(() => setQuestionnaire(emptyState()));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when demo mode is first recognized
  }, [demo]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (revealTimer.current) clearTimeout(revealTimer.current);
    },
    [],
  );

  // Warm-up: as soon as a cancer type is picked, download that type's shard(s) and the on-device model in
  // the background (static files only), so the search itself is fast. Skipped when the browser asks to save data.
  const cancerType = questionnaire.answers.cancer_type as IntakeAnswers["cancerType"] | undefined;
  useEffect(() => {
    if (!cancerType || warmedUp.has(cancerType)) return;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (saveData) return;
    warmedUp.add(cancerType);
    void import("@/lib/match/search").then(({ prefetchSearch }) => prefetchSearch(cancerType));
  }, [cancerType]);

  async function runAnalysis(answers: IntakeAnswers, results: RankedTrial[], searchedAt: number) {
    const isCurrent = (prev: typeof session) => prev !== null && prev.searchedAt === searchedAt;
    let judgeStarted = false;
    try {
      const container = turnstileRef.current;
      if (!container) throw new Error("no turnstile container");
      // Code-split: the AI client and Turnstile loader download only after a search.
      const [{ getTurnstileToken }, { requestAnalysis }, { applyAnalysis }, { orderResults }] = await Promise.all([
        import("@/lib/api/turnstile"),
        import("@/lib/api/analyze"),
        import("@/lib/match/search"),
        import("@/lib/match/rank"),
      ]);
      const token = await withTimeout(getTurnstileToken(container), TURNSTILE_TIMEOUT_MS);
      // The criterion judge runs first (with its own single-use token) and settles the order; the explanations then
      // cover the trials the patient sees first. Run one after the other, the two never compete for a free-tier
      // provider's per-minute token limit.
      judgeStarted = true;
      const order = await runCriteriaJudge(answers, results, searchedAt, getTurnstileToken, container);
      const response = await requestAnalysis(
        answers,
        (order ?? results.map((r) => r.card.id)).slice(0, ANALYZE_TOP_N),
        token,
      );
      mark("analysis");
      setSession((prev) => {
        if (!prev || !isCurrent(prev)) return prev;
        if (response.status === "ok") {
          const applied = applyAnalysis(prev.results, response);
          // The per-criterion tiers decide the order; the AI fit level only explains.
          return { ...prev, results: prev.criteria ? orderResults(applied, prev.criteria.order) : applied, analysis: { status: "ok", experimental: response.experimental } };
        }
        return { ...prev, analysis: { status: "degraded" } };
      });
    } catch {
      setSession((prev) => (prev && isCurrent(prev) ? { ...prev, analysis: { status: "degraded" } } : prev));
      if (!judgeStarted) void runCriteriaJudge(answers, results, searchedAt, null, null);
    }
  }

  /**
   * LLM judge for the criteria the resolver left unknown (top N), then tier A / tier B order. Without a
   * Turnstile token (or on any failure) the resolver-only ranking stays and is marked degraded.
   */
  async function runCriteriaJudge(
    answers: IntakeAnswers,
    retrievalOrder: RankedTrial[],
    searchedAt: number,
    getToken: ((el: HTMLElement) => Promise<string>) | null,
    container: HTMLElement | null,
  ): Promise<string[] | null> {
    const isCurrent = (prev: typeof session) => prev !== null && prev.searchedAt === searchedAt;
    const signal = abortRef.current?.signal;
    try {
      const [{ rankWithCriteria }, { requestCriteriaJudgement }, { matchOptions }] = await Promise.all([
        import("@/lib/match/criteria-rank"),
        import("@/lib/api/match"),
        import("@/components/questionnaire/engine"),
      ]);
      const { ranking, results } = await rankWithCriteria(retrievalOrder, answers, {
        ...(answers.questionnaire ? { catalog: matchOptions(answers.cancerType).catalog } : {}),
        ...(signal ? { signal } : {}),
        judge: async (a, trials) => {
          if (!getToken || !container) throw new Error("no turnstile");
          const token = await withTimeout(getToken(container), TURNSTILE_TIMEOUT_MS);
          return requestCriteriaJudgement(a, trials, token, signal ? { signal } : {});
        },
      });
      mark("judge");
      setSession((prev) => {
        if (!prev || !isCurrent(prev)) return prev;
        // Keep any AI analysis already attached to the results; only the order and criteria change.
        const byId = new Map(prev.results.map((r) => [r.card.id, r]));
        return { ...prev, criteria: ranking, results: results.map((r) => byId.get(r.card.id) ?? r) };
      });
      return ranking.order.slice();
    } catch {
      // Aborted by a newer search (isCurrent then fails), or the engine failed to load: keep the resolver-only
      // ranking, marked degraded.
      setSession((prev) => (prev && isCurrent(prev) && prev.criteria?.status === "pending" ? { ...prev, criteria: { ...prev.criteria, status: "degraded", degraded: true } } : prev));
      return null;
    }
  }

  async function searchFromQuestionnaire(state: QuestionnaireState, language: Language) {
    const { toIntakeAnswers } = await import("@/components/questionnaire/engine");
    await runSearch(toIntakeAnswers(state, language));
  }

  async function runSearch(answers: IntakeAnswers) {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSession(null);
    setStatus({ kind: "searching", progress: { stage: "loading_shards" } });
    window.scrollTo({ top: 0 });
    try {
      // Code-split: the matching engine (search index, embeddings worker) loads only when searching.
      const [{ searchTrials }, { matchOptions }, { resolveRanking }, { orderResults }] = await Promise.all([
        import("@/lib/match/search"),
        import("@/components/questionnaire/engine"),
        import("@/lib/match/criteria-rank"),
        import("@/lib/match/rank"),
      ]);
      const [outcome, origin] = await Promise.all([
        searchTrials(answers, {
          ...(answers.questionnaire ? matchOptions(answers.cancerType) : {}),
          signal: ac.signal,
          onProgress: (progress) => setStatus({ kind: "searching", progress }),
        }),
        lookupZip(answers.zip).catch(() => null),
      ]);
      if (ac.signal.aborted) return;
      const searchedAt = Date.now();
      const hasResults = outcome.results.length > 0;
      // Resolver-only criteria ranking at once (no I/O); the LLM judge refines it in runAnalysis.
      const criteria = resolveRanking(outcome.results, answers, answers.questionnaire ? matchOptions(answers.cancerType).catalog : undefined);
      mark("results");
      if (revealTimer.current) clearTimeout(revealTimer.current);
      setRevealed(false);
      revealTimer.current = setTimeout(() => setRevealed(true), demo ? DEMO_REVEAL_WAIT_MS : REVEAL_WAIT_MS);
      setSession({
        answers,
        outcome,
        results: orderResults(outcome.results, criteria.order),
        criteria,
        analysis: hasResults ? { status: "pending" } : { status: "idle" },
        origin,
        searchedAt,
      });
      setStatus({ kind: "idle" });
      if (hasResults) void runAnalysis(answers, outcome.results, searchedAt);
    } catch (err) {
      if (ac.signal.aborted) return;
      setStatus({ kind: "error", code: loadErrorCode(err), answers });
    }
  }

  const settled = session !== null && session.criteria?.status !== "pending" && session.analysis.status !== "pending";
  let body;
  if (status.kind === "searching") {
    body = <SearchProgressView progress={status.progress} />;
  } else if (session && !revealed && !settled) {
    body = <SearchProgressView progress={{ stage: "checking" }} />;
  } else if (status.kind === "error") {
    const offline = typeof navigator !== "undefined" && !navigator.onLine;
    const msg = offline
      ? m.common.offline
      : status.code === "timeout"
        ? m.search.errorTimeout
        : status.code === "invalid"
          ? m.search.errorInvalid
          : m.search.error;
    body = <ErrorView body={msg} onRetry={() => void runSearch(status.answers)} />;
  } else if (session) {
    body = (
      <>
        {sample && (
          <p role="status" className="animate-enter mb-4 rounded-2xl border border-dashed border-border bg-secondary/60 px-4 py-2 text-sm">
            {m.results.sampleNote}
          </p>
        )}
        <ResultsView
          session={session}
          {...(session.criteria ? { matches: session.criteria.byTrial, matchDegraded: session.criteria.degraded } : {})}
          onEdit={() => {
            if (session.answers.questionnaire) setQuestionnaire(session.answers.questionnaire);
            setSample(false);
            setSession(null);
          }}
          onFill={(ids) => {
            if (session.answers.questionnaire) setQuestionnaire(session.answers.questionnaire);
            setFillRequest(ids);
            setSession(null);
          }}
          onNewSearch={() => {
            clearSession();
            setQuestionnaire(emptyState());
            setSample(false);
            setSession(null);
          }}
          onWiden={() => {
            const q = session.answers.questionnaire;
            const widenedQ = q ? { ...q, answers: { ...q.answers, travel: "anywhere" }, updatedAt: Date.now() } : undefined;
            if (widenedQ) setQuestionnaire(widenedQ);
            const widened = { ...session.answers, travelMiles: null, ...(widenedQ ? { questionnaire: widenedQ } : {}) };
            void runSearch(widened);
          }}
        />
      </>
    );
  } else {
    body = (
      <>
        <PageHead title={m.chat.title} size="md" className="mb-6 sm:mb-10" />
        {/* Remounts when the demo server is recognized (its start screen differs). */}
        <QuestionnaireFlow
          key={demo ? "demo" : "app"}
          state={questionnaire}
          setState={setQuestionnaire}
          fillRequest={fillRequest}
          onFillHandled={() => setFillRequest(null)}
          onSample={() => setSample(true)}
          onSearch={(s, lang) => void searchFromQuestionnaire(s, lang)}
          demo={demo}
          onDemoReset={() => setSample(false)}
        />
        <Disclaimer className="mt-8" />
      </>
    );
  }

  return (
    <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-20 sm:px-6 sm:pt-14 sm:pb-28">
      {body}
      {/* Turnstile renders an interaction-only widget here when a check is needed. */}
      <div className="no-print mt-6 flex justify-center" aria-label={m.results.verification} role="region" ref={turnstileRef} />
    </main>
  );
}
