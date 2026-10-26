"use client";

import { ArrowLeft, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AssistantBubble, UserBubble } from "@/components/chat/primitives";
import { useLanguage, useMessages } from "@/components/i18n";
import { Button } from "@/components/ui/button";
import type { CancerGroupId } from "@/config/cancer-groups";
import { LANGUAGES, type Language } from "@/lib/types/intake";
import { answerText } from "./answer-text";
import {
  ESSENTIAL_IDS,
  emptyState,
  isEssential,
  isNonResponse,
  type AnswerValue,
  type LiveCount,
  type NextStep,
  type QuestionDef,
  type QuestionId,
  type QuestionnaireState,
  type Tier,
} from "./contract";
import {
  applyAnswer,
  buildCandidatePool,
  clearSession,
  estimateRemaining,
  findOutList,
  getCatalog,
  liveCount,
  loadSession,
  nextQuestion,
  remainingOptional,
  saveSession,
  type CandidatePool,
} from "./engine";
import { ModeToggle, TierProgress } from "./progress";
import { QuestionCard } from "./question-card";
import { SummaryCard } from "./summary-card";
import { DemoStart } from "./demo-start";
import { IntroPanel } from "./intro-panel";
import { applySampleAnswer, demoRequested, samplePatientState, SAMPLE_STEPS, walkRequested } from "./sample-patient";
import { useKeyT, variantKey } from "./t";

type Notice = { kind: "resumed" | "cleared" | "sample" } | { kind: "dropped"; ids: QuestionId[] } | null;

function poolKey(s: QuestionnaireState): string | null {
  const a = s.answers;
  if (ESSENTIAL_IDS.some((id) => a[id] === undefined)) return null;
  return JSON.stringify([a.cancer_type, a.age, a.zip, a.travel, a.sex ?? null]);
}


/**
 * Adaptive conversational questionnaire (QUESTIONNAIRE_SPEC §2, §5): essentials in fixed order, then
 * engine-chosen questions with a live counter, back/edit, non-response chips, resume within the tab,
 * and a summary card before the search. No AI and no network calls with answers.
 */
export function QuestionnaireFlow({
  state,
  setState,
  onSearch,
  fillRequest,
  onFillHandled,
  onSample,
  demo = false,
  onDemoReset,
}: {
  state: QuestionnaireState;
  setState: (s: QuestionnaireState) => void;
  onSearch: (state: QuestionnaireState, language: Language) => void;
  /** Question ids to reopen ("Fill in what you found out" on the results page). */
  fillRequest?: QuestionId[] | null;
  onFillHandled?: () => void;
  /** The sample patient was loaded (so the results page can say so). */
  onSample?: () => void;
  /** Local demo server: start on the two-choice screen (questionnaire or sample patient), never resume a session. */
  demo?: boolean;
  /** Demo: "Back to the two choices" cleared everything (so the results page stops saying "sample patient"). */
  onDemoReset?: () => void;
}) {
  const m = useMessages();
  const t = useKeyT();
  const uiTag: string = useLanguage();
  const uiLang: Language = (LANGUAGES as readonly string[]).includes(uiTag) ? (uiTag as Language) : "en";
  const [editing, setEditing] = useState<QuestionId | null>(null);
  const [fillQueue, setFillQueue] = useState<QuestionId[]>(() => fillRequest ?? []);
  const [stopped, setStopped] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [interacted, setInteracted] = useState(() => (fillRequest?.length ?? 0) > 0);
  const [showEarlier, setShowEarlier] = useState(false);
  const [studyLanguage, setStudyLanguage] = useState<Language | null>(null);
  const [pool, setPool] = useState<{ key: string; pool: CandidatePool | null } | null>(null);
  const resumeChecked = useRef(false);
  // Sample walkthrough: the number of sample answers applied so far (null = not walking).
  const [walk, setWalk] = useState<number | null>(null);
  // Demo start screen: "choose" until one of its two choices is picked.
  const [demoPick, setDemoPick] = useState<"choose" | "picked">("choose");
  // "I'm answering for someone else": wording only. A yes/no flag, never a name or relationship, kept in this tab.
  const [caregiver, setCaregiverState] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem("tb-caregiver") === "1") void Promise.resolve().then(() => setCaregiverState(true));
    } catch {
      /* storage unavailable: default wording */
    }
  }, []);
  function setCaregiver(v: boolean) {
    setCaregiverState(v);
    try {
      if (v) sessionStorage.setItem("tb-caregiver", "1");
      else sessionStorage.removeItem("tb-caregiver");
    } catch {
      /* ignore */
    }
  }

  // The flow remounts after results, so a fill request seeds the queue once.
  useEffect(() => {
    if (fillRequest && fillRequest.length > 0) onFillHandled?.();
  }, [fillRequest, onFillHandled]);

  function loadSample() {
    setState(samplePatientState());
    setEditing(null);
    setFillQueue([]);
    setStopped(true);
    setInteracted(true);
    setNotice({ kind: "sample" });
    onSample?.();
  }

  // The sample button plays the sample answers one at a time (about 1.2 s each); reduced motion skips straight to the end.
  function startWalk() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      loadSample();
      return;
    }
    clearSession();
    setState(emptyState());
    setEditing(null);
    setFillQueue([]);
    setStopped(true);
    setInteracted(true);
    setNotice(null);
    setWalk(0);
  }

  // Demo: back to the two-choice screen with nothing answered.
  function demoBack() {
    clearSession();
    setState(emptyState());
    setWalk(null);
    setEditing(null);
    setFillQueue([]);
    setStopped(false);
    setInteracted(false);
    setNotice(null);
    setDemoPick("choose");
    onDemoReset?.();
  }

  function finishWalk(full: boolean) {
    setWalk(null);
    if (full) setState(samplePatientState());
    setNotice({ kind: "sample" });
    onSample?.();
  }

  // Resume within this tab (sessionStorage, validated and expired by the engine's loadSession). `?demo=1` skips
  // straight to the sample patient's results instead.
  useEffect(() => {
    if (resumeChecked.current) return;
    resumeChecked.current = true;
    if (walkRequested()) {
      window.history.replaceState(window.history.state, "", window.location.pathname);
      void Promise.resolve().then(startWalk);
      return;
    }
    if (demoRequested()) {
      window.history.replaceState(window.history.state, "", window.location.pathname);
      const sample = samplePatientState();
      setState(sample);
      onSample?.();
      onSearch(sample, uiLang);
      return;
    }
    if (state.history.length > 0) return;
    // The demo always starts fresh on its start screen.
    if (demo) {
      clearSession();
      return;
    }
    const saved = loadSession();
    if (saved && saved.history.length > 0) {
      setState(saved);
      void Promise.resolve().then(() => setNotice({ kind: "resumed" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount
  }, []);

  // Mirror answers to sessionStorage (tab-scoped). Nothing is saved before the first answer.
  useEffect(() => {
    if (state.history.length > 0) saveSession(state);
  }, [state]);

  const group = (state.answers.cancer_type as CancerGroupId | undefined) ?? "other";
  const catalog = useMemo(() => getCatalog("cancer", group), [group]);
  const byId = useMemo(() => new Map<string, QuestionDef>(catalog.map((q) => [q.id, q])), [catalog]);

  // Candidate pool: hard filters + keyword prior, rebuilt only when a hard-filter answer changes.
  const key = poolKey(state);
  useEffect(() => {
    if (!key) return;
    const ac = new AbortController();
    let live = true;
    buildCandidatePool(state, { signal: ac.signal })
      .then((p) => live && setPool({ key, pool: p }))
      .catch(() => live && !ac.signal.aborted && setPool({ key, pool: null }));
    return () => {
      live = false;
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild only when hard-filter answers change
  }, [key]);
  const poolReady = pool !== null && pool.key === key;
  const activePool = poolReady ? pool.pool : null;

  const count: LiveCount | null = useMemo(() => (activePool ? liveCount(state, activePool, catalog) : null), [state, activePool, catalog]);
  const next: NextStep | null = useMemo(() => {
    if (!key || !poolReady) return null;
    if (!activePool) return { kind: "done", reason: "exhausted" };
    return nextQuestion(state, activePool, catalog);
  }, [key, poolReady, activePool, state, catalog]);

  // Which question is on screen (null = summary, "loading" = counting the pool).
  let current: QuestionDef | "loading" | null = null;
  let impact: { total: number; narrowedTo: number | null } | null = null;
  const queued = fillQueue.find((id) => byId.has(id));
  const firstEssential = ESSENTIAL_IDS.find((id) => state.answers[id] === undefined);
  if (queued) current = byId.get(queued) ?? null;
  else if (editing && byId.has(editing)) current = byId.get(editing) ?? null;
  else if (firstEssential) current = byId.get(firstEssential) ?? null;
  else if (!stopped) {
    if (!next) current = "loading";
    else if (next.kind === "ask") {
      current = next.question;
      impact = next.impact;
    }
  }
  const currentQ = current && current !== "loading" ? current : null;
  const engineDone = next?.kind === "done";
  const adaptiveStarted = state.history.some((id) => !isEssential(id));

  const tier: Tier | "summary" = current === null ? "summary" : current === "loading" ? "helpful" : current.tier;
  const essentialsLeft = ESSENTIAL_IDS.filter((id) => state.answers[id] === undefined).length;
  // How far through the current tier: essentials are counted exactly; later tiers are an estimate from the
  // engine's remaining range, so the meter can slow down but never claims a finish it can't promise.
  const remaining = essentialsLeft > 0 ? essentialsLeft : stopped || engineDone ? 0 : activePool ? Math.max(1, estimateRemaining(state, activePool, catalog)) : null;

  const tierAnswered = tier === "summary" ? 0 : state.history.filter((id) => !isEssential(id) && byId.get(id)?.tier === tier).length;
  const tierFill =
    tier === "essential" || essentialsLeft > 0
      ? (ESSENTIAL_IDS.length - essentialsLeft) / ESSENTIAL_IDS.length
      : tierAnswered / (tierAnswered + Math.max(1, remaining ?? 1));

  function answer(q: QuestionDef, value: AnswerValue, gain?: number) {
    const res = applyAnswer(state, q.id, value, catalog, gain !== undefined && Number.isFinite(gain) ? { gain } : {});
    setState(res.state);
    setNotice(res.dropped.length > 0 ? { kind: "dropped", ids: res.dropped } : null);
    setEditing(null);
    setFillQueue((fq) => fq.filter((id) => id !== q.id));
    setInteracted(true);
  }

  function edit(id: QuestionId) {
    setEditing(id);
    setFillQueue([]);
    setInteracted(true);
    setNotice(null);
  }

  // Back walks the asking order (history); the earlier question re-renders with its answer.
  const order = state.history;
  const currentIdx = currentQ ? (order.includes(currentQ.id) ? order.indexOf(currentQ.id) : order.length) : order.length;
  const backTarget = currentIdx > 0 ? order[currentIdx - 1] : undefined;

  useEffect(() => {
    if (walk === null) return;
    if (walk >= SAMPLE_STEPS) {
      const done = setTimeout(() => finishWalk(false), 1200);
      return () => clearTimeout(done);
    }
    const step = setTimeout(() => {
      setState(applySampleAnswer(state, walk));
      setWalk(walk + 1);
    }, walk === 0 ? 700 : 1200);
    return () => clearTimeout(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one timer per step; state/setters are read at fire time
  }, [walk, state]);

  function clearAll() {
    clearSession();
    setCaregiver(false);
    setState(emptyState());
    setEditing(null);
    setFillQueue([]);
    setStopped(false);
    setPool(null);
    setNotice({ kind: "cleared" });
  }

  const findOut = useMemo(() => findOutList(state, catalog), [state, catalog]);
  const deepLeft = current === null && state.mode === "quick" && activePool ? remainingOptional(state, activePool, catalog) : 0;

  // Transcript: answered questions in asking order (the one being edited is shown as the active card).
  const transcriptIds = order.filter((id) => byId.has(id) && state.answers[id] !== undefined && id !== currentQ?.id);
  const lastAnswered = transcriptIds[transcriptIds.length - 1];
  const travelDone = state.answers.travel !== undefined;
  const transcript: ReactNode[] = transcriptIds.map((id, i) => {
    const q = byId.get(id)!;
    const label = t(variantKey(t, q.labelKey, caregiver));
    const older = i < transcriptIds.length - 1 && !showEarlier;
    const isLast = id === lastAnswered && interacted && !editing;
    const nonResp = !isEssential(id) && isNonResponse(state.answers[id]);
    return (
      <div key={id} className={older ? "hidden" : "space-y-3"}>
        <AssistantBubble label={m.chat.assistant}>{label}</AssistantBubble>
        <UserBubble label={m.chat.you} onEdit={() => edit(id)} editLabel={t("questionnaire.ui.editAnswer", { question: label })}>
          {answerText(q, state, t, m)}
        </UserBubble>
        {isLast && nonResp && (
          <AssistantBubble label={m.chat.assistant}>
            {state.deferred.includes(id)
              ? t("questionnaire.ui.reassureDeferred")
              : count
                ? t("questionnaire.ui.reassure", { count: count.total.toLocaleString(t.locale) })
                : t("questionnaire.ui.reassureNoCount")}
          </AssistantBubble>
        )}
      </div>
    );
  });
  const earlierCount = Math.max(0, transcriptIds.length - 1);

  const showAfterEssentials = travelDone && currentQ && !isEssential(currentQ.id) && !adaptiveStarted && !editing && !queued;

  if (demo && demoPick === "choose" && walk === null && state.history.length === 0) {
    return (
      <DemoStart
        onQuestions={() => setDemoPick("picked")}
        onSample={() => {
          setDemoPick("picked");
          startWalk();
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      {demo && (
        <Button variant="ghost" onClick={demoBack} className="min-h-11 -ms-3">
          <ArrowLeft aria-hidden className="rtl:rotate-180" />
          {t("questionnaire.ui.demoBack")}
        </Button>
      )}
      <TierProgress tier={tier} remaining={remaining} count={count} fill={tierFill} />

      {notice && (
        <p role="status" className="animate-enter rounded-2xl border border-border bg-secondary/60 px-4 py-3">
          {notice.kind === "resumed" && t("questionnaire.ui.resumed")}
          {notice.kind === "cleared" && t("questionnaire.ui.cleared")}
          {notice.kind === "sample" && t("questionnaire.ui.sampleLoaded")}
          {notice.kind === "dropped" &&
            t("questionnaire.ui.dropped", { count: notice.ids.length, list: notice.ids.map((id) => (byId.has(id) ? t(byId.get(id)!.labelKey) : id)).join("; ") })}
        </p>
      )}

      <div role="log" aria-label={m.chat.logLabel} aria-live="polite" aria-relevant="additions" className="space-y-5">
        {state.history.length === 0 && !interacted && <IntroPanel caregiver={caregiver} onCaregiver={setCaregiver} {...(demo ? {} : { onSample: startWalk })} />}
        {earlierCount > 0 && (
          <div>
            <Button variant="ghost" onClick={() => setShowEarlier((v) => !v)} aria-expanded={showEarlier} className="min-h-11">
              {showEarlier ? t("questionnaire.ui.hideEarlier") : t("questionnaire.ui.earlier", { count: earlierCount })}
            </Button>
          </div>
        )}
        {transcript}
        {showAfterEssentials && <AssistantBubble label={m.chat.assistant}>{t("questionnaire.ui.afterEssentials")}</AssistantBubble>}
      </div>

      {walk !== null && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-secondary/60 px-4 py-3">
          <p>{t("questionnaire.ui.walkStatus", { n: Math.min(walk + 1, SAMPLE_STEPS), total: SAMPLE_STEPS })}</p>
          <Button variant="outline" onClick={() => finishWalk(true)} className="min-h-11">
            {t("questionnaire.ui.walkSkip")}
          </Button>
        </div>
      )}

      {walk === null && current === "loading" && (
        <p role="status" className="text-muted-foreground">
          {t("questionnaire.ui.counterLoading")}
        </p>
      )}

      {walk === null && currentQ && (
        <QuestionCard
          key={`${currentQ.id}:${group}`}
          caregiver={caregiver}
          q={currentQ}
          initial={state.answers[currentQ.id]}
          impact={impact}
          autoFocus={interacted}
          onAnswer={(v) => answer(currentQ, v, next?.kind === "ask" && next.question.id === currentQ.id ? next.utility : undefined)}
          onBack={backTarget ? () => edit(backTarget) : undefined}
          extra={
            !isEssential(currentQ.id) ? (
              <div className="space-y-3 border-t border-border pt-4">
                {showAfterEssentials && <ModeToggle mode={state.mode} onChange={(mode) => setState({ ...state, mode, updatedAt: Date.now() })} />}
                {!editing && !queued && (
                  <Button variant="outline" onClick={() => setStopped(true)} className="min-h-11">
                    {t("questionnaire.ui.showNow")}
                  </Button>
                )}
              </div>
            ) : undefined
          }
        />
      )}

      {walk === null && current === null && (
        <SummaryCard
          state={state}
          catalog={catalog}
          findOut={findOut}
          deepLeft={deepLeft}
          caregiver={caregiver}
          language={studyLanguage ?? uiLang}
          onLanguage={setStudyLanguage}
          onEdit={edit}
          onFill={(ids) => {
            setFillQueue(ids);
            setInteracted(true);
          }}
          onMore={() => {
            setState({ ...state, mode: "thorough", updatedAt: Date.now() });
            setStopped(false);
            setInteracted(true);
          }}
          onSearch={() => onSearch(state, studyLanguage ?? uiLang)}
        />
      )}

      {state.history.length > 0 && (
        <div className="flex justify-end">
          <Button variant="ghost" onClick={clearAll} className="min-h-11">
            <RotateCcw aria-hidden />
            {t("questionnaire.ui.clear")}
          </Button>
        </div>
      )}
    </div>
  );
}
