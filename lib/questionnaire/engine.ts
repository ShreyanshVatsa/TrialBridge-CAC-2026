/**
 * Adaptive questionnaire engine (QUESTIONNAIRE_SPEC §2). Pure and deterministic: no I/O
 * except the three session helpers at the bottom (tab-scoped sessionStorage).
 *
 * Flow: the four essentials in fixed order (they are hard filters), then repeatedly the question with the
 * highest utility U(q) = (IG(q) + REGRET(q)) / cost(q) × tierFactor, until a stop rule fires. IG is the expected
 * information gain about which of the current top-K candidate trials fit; REGRET is the expected change of the top 10
 * the patient sees (see expectedRegret).
 *
 *   p(t)      ∝ exp(score_t / TAU) over the TOP_K best-scoring candidates
 *   L(t, a)   = e^-LAMBDA if answer a conflicts with trial t, e^+MU if it supports it, else 1
 *   p_a(t)    ∝ p(t) · L(t, a)
 *   IG(q)     = H(p) − Σ_a P(a) · H(p_a)        with P(a) from catalog priors; P(unknown) adds zero gain
 *
 * Unknown answers compile to nothing (rules.ts), so they never change scores, filters or counters.
 */
import type { CancerGroupId } from "@/config/cancer-groups";
import { precheckBonus, precheckPenalty } from "@/lib/match/score";
import { perfCounters } from "@/lib/perf/counters";
import {
  DEFER,
  PREFER_NOT,
  QuestionnaireStateSchema,
  UNKNOWN,
  type AnswerValue,
  type FactPolicyMap,
  type FindOutDef,
  type FindOutEntry,
  type QuestionDef,
  type QuestionnaireState,
} from "@/lib/types/questionnaire";
import {
  DEFAULT_BIOMARKER_PRIOR,
  DEFAULT_P_UNKNOWN,
  ESSENTIAL_ORDER,
  FALLBACK_PRIORS,
  FAMILY_DOWNWEIGHT,
  HARD_EXCLUDED_LIKELIHOOD,
  HIGH_UNKNOWN_PRIOR,
  INFO_GAIN_WEIGHT,
  LAMBDA,
  MU,
  Q_SEX,
  REGRET_TOP_N,
  REGRET_WEIGHT,
  SESSION_KEY,
  SESSION_MAX_AGE_MS,
  SEX_ASK_MIN_SHARE,
  STOP_RULES,
  TAU,
  TIER_FACTOR,
  TOP_K,
  UNKNOWN_STREAK,
} from "./constants";
import {
  activeQuestions,
  appliesToGroup,
  applyPolicy,
  compileAnswer,
  compileState,
  factRelation,
  fitAnswer,
  groupOf,
  hardFilters,
  isNonResponse,
  isNonResponseId,
  passesHardFilters,
  prerequisitesHold,
  type CompactFact,
  type CompiledAnswer,
} from "./rules";

export type { CompactFact } from "./rules";

/** One candidate trial after the essentials' hard filters (group, age, distance). Sex is applied live. */
export interface PoolTrial {
  id: string;
  /** Prior relevance 0..1 (BM25 over the current profile text, normalized by the best score). */
  prior: number;
  facts: readonly CompactFact[];
  sex: "ALL" | "FEMALE" | "MALE";
}
export interface CandidatePool {
  group: CancerGroupId;
  trials: ReadonlyArray<PoolTrial>;
}

export type DoneReason = "small_set" | "low_gain" | "max_questions" | "exhausted";
export type NextStep =
  /** impact.total = trials with no likely conflict now; narrowedTo = "could narrow N to about M" (null = no change). */
  | { kind: "ask"; question: QuestionDef; utility: number; impact: { total: number; narrowedTo: number | null } }
  | { kind: "done"; reason: DoneReason };

interface EngineOptions {
  /** FACT_POLICY (config/questionnaire/fact-policy.ts): penalize=false families never conflict. */
  policy?: FactPolicyMap;
}

type Mode = QuestionnaireState["mode"];

// ---------------------------------------------------------------------------------------------
// State

export function createState(mode: Mode = "quick", now: number = Date.now()): QuestionnaireState {
  return { v: 2, area: "cancer", mode, answers: {}, history: [], deferred: [], updatedAt: now };
}

/** Switch quick/thorough at any time ("Add more detail for better matches"). */
export function setMode(state: QuestionnaireState, mode: Mode, now: number = Date.now()): QuestionnaireState {
  return { ...state, mode, updatedAt: now };
}

const ESSENTIALS: readonly string[] = ESSENTIAL_ORDER;
function isEssential(q: QuestionDef | undefined, id: string): boolean {
  return ESSENTIALS.includes(id) || q?.tier === "essential";
}

function without<T>(rec: Readonly<Record<string, T>> | undefined, key: string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(rec ?? {})) if (k !== key) out[k] = v;
  return out;
}

function removeQuestion(state: QuestionnaireState, id: string): QuestionnaireState {
  const next: QuestionnaireState = {
    ...state,
    answers: without(state.answers, id),
    history: state.history.filter((x) => x !== id),
    deferred: state.deferred.filter((x) => x !== id),
  };
  if (state.gains) next.gains = without(state.gains, id);
  return next;
}

/**
 * Record an answer. `DEFER` ("My doctor can fill this in later") stores null and lists the question under
 * `deferred`; it counts as unknown for matching. Editing an earlier answer keeps its place in the history
 * and drops (or trims) other answers that no longer apply, returned in `dropped` so the UI can say so. When the
 * cancer type changes, pass the new group's catalog. `opts.gain` (the step's utility) orders the Find-out list.
 */
export function applyAnswer(
  state: QuestionnaireState,
  q: string,
  value: AnswerValue,
  catalog: readonly QuestionDef[],
  opts: { gain?: number; now?: number } = {},
): { state: QuestionnaireState; dropped: string[] } {
  const deferring = value === DEFER;
  let next: QuestionnaireState = {
    ...state,
    answers: { ...state.answers, [q]: deferring ? null : value },
    history: state.history.includes(q) ? [...state.history] : [...state.history, q],
    deferred: deferring ? [...state.deferred.filter((x) => x !== q), q] : state.deferred.filter((x) => x !== q),
    updatedAt: opts.now ?? Date.now(),
  };
  if (opts.gain !== undefined && Number.isFinite(opts.gain) && opts.gain >= 0) next.gains = { ...state.gains, [q]: opts.gain };

  // Re-check every other answer against this catalog (pass the catalog of the CURRENT cancer type): answers to
  // questions that no longer exist or apply, whose prerequisites fail, or whose options / biomarkers are not
  // offered for this group (e.g. a lung biomarker grid after switching to breast) are dropped or trimmed.
  const dropped: string[] = [];
  const byId = new Map(catalog.map((d) => [d.id as string, d]));
  for (const id of Object.keys(next.answers)) {
    if (id !== q && !byId.has(id) && !ESSENTIALS.includes(id)) {
      next = removeQuestion(next, id);
      dropped.push(id);
    }
  }
  for (let changed = true; changed; ) {
    changed = false;
    const group = groupOf(next);
    for (const d of catalog) {
      const v = next.answers[d.id];
      if (d.id === q || v === undefined || isEssential(d, d.id)) continue;
      const fitted = appliesToGroup(d, group) && prerequisitesHold(d, next) ? fitAnswer(d, v) : undefined;
      if (fitted === undefined) {
        next = removeQuestion(next, d.id);
        dropped.push(d.id);
        changed = true;
      } else if (fitted !== v) {
        next = { ...next, answers: { ...next.answers, [d.id]: fitted } };
        dropped.push(d.id);
      }
    }
  }
  return { state: next, dropped };
}

/**
 * Back: remove the most recent question from the history and its answer from the state, and return it with
 * the previous answer for pre-filling. Because the engine is deterministic, nextQuestion on the returned
 * state asks that same question again.
 */
export function goBack(state: QuestionnaireState, now: number = Date.now()): { state: QuestionnaireState; question: string | null; previous: AnswerValue | undefined } {
  const last = state.history[state.history.length - 1];
  if (last === undefined) return { state, question: null, previous: undefined };
  const prev = state.answers[last];
  const previous = prev === null && state.deferred.includes(last) ? DEFER : prev;
  return { state: { ...removeQuestion(state, last), updatedAt: now }, question: last, previous };
}

// ---------------------------------------------------------------------------------------------
// Scoring the pool

interface Scored {
  t: PoolTrial;
  /** Relation of each of the trial's facts to the current answers: 0 neutral, 1 support, 2 conflict (policy applied). */
  rels: Uint8Array;
  score: number;
  conflict: boolean;
  support: boolean;
}

/** Trial-level relation of compiled answers: any conflicting fact => conflict, else any support => support. */
function trialRelation(compiled: readonly CompiledAnswer[], facts: readonly CompactFact[], policy: FactPolicyMap | undefined) {
  let conflict = false;
  let support = false;
  const notes: Array<{ key: CompactFact["key"]; kind: "conflict" | "support"; value: CompactFact["value"]; source?: "rule" | "llm"; confidence?: number }> = [];
  const rels = new Uint8Array(facts.length);
  facts.forEach((f, j) => {
    const rel = applyPolicy(factRelation(compiled, f), f.key, policy);
    if (rel === "neutral") return;
    if (rel === "conflict") conflict = true;
    else support = true;
    rels[j] = rel === "conflict" ? 2 : 1;
    notes.push(noteOf(f, rel));
  });
  return { conflict, support, notes, rels };
}

function noteOf(f: CompactFact, kind: "conflict" | "support") {
  return { key: f.key, kind, value: f.value, ...(f.source ? { source: f.source } : {}), ...(f.confidence !== undefined ? { confidence: f.confidence } : {}) };
}

/** A trial's score if one more compiled answer `c` is added to its current per-fact relations (any conflict wins). */
function scoreWith(s: Scored, c: CompiledAnswer, policy: FactPolicyMap | undefined): number {
  perfCounters.rescore++;
  const notes: Array<ReturnType<typeof noteOf>> = [];
  s.t.facts.forEach((f, j) => {
    let rel = s.rels[j] as number;
    if (rel !== 2 && c.rules.has(f.key)) {
      const add = applyPolicy(factRelation([c], f), f.key, policy);
      if (add === "conflict") rel = 2;
      else if (add === "support") rel = 1;
    }
    if (rel !== 0) notes.push(noteOf(f, rel === 2 ? "conflict" : "support"));
  });
  return s.t.prior - precheckPenalty(notes) + precheckBonus(notes);
}

/** Score every pool trial that passes the live hard filters (definite sex) under the current answers. */
function scorePool(state: QuestionnaireState, pool: CandidatePool, catalog: readonly QuestionDef[], policy: FactPolicyMap | undefined): Scored[] {
  return analyze(state, pool, catalog, policy).scored;
}

/** Everything the engine derives from (state, pool, catalog, policy); computed once and shared by all the calls
 *  the UI makes for the same state (live counter, next question, "about N more"), which used to repeat it. */
interface Analysis {
  scored: Scored[];
  compiled: CompiledAnswer[];
  /** Scored trials best first (ties by id), and fact key -> indexes into that order. */
  order?: Scored[];
  byKey?: Map<string, number[]>;
  /** Scratch space for expectedRegret: which order indexes the current hypothesis re-scored, and their new scores. */
  stamp?: Int32Array;
  fresh?: Float64Array;
  round?: number;
  /** Questions ranked by utility; filled on first use. */
  ranked?: Array<{ question: QuestionDef; gain: number; utility: number }>;
}
const analyses = new WeakMap<QuestionnaireState, WeakMap<CandidatePool, Array<{ catalog: readonly QuestionDef[]; policy: FactPolicyMap | undefined; value: Analysis }>>>();

function analyze(state: QuestionnaireState, pool: CandidatePool, catalog: readonly QuestionDef[], policy: FactPolicyMap | undefined): Analysis {
  let byPool = analyses.get(state);
  if (!byPool) analyses.set(state, (byPool = new WeakMap()));
  let entries = byPool.get(pool);
  if (!entries) byPool.set(pool, (entries = []));
  const hit = entries.find((e) => e.catalog === catalog && e.policy === policy);
  if (hit) return hit.value;
  const compiled = compileState(state, catalog).filter((c) => c.rules.size > 0 || c.hardFilter);
  const filters = hardFilters(compiled);
  const scored: Scored[] = [];
  for (const t of pool.trials) {
    if (!passesHardFilters(t.sex, filters)) continue;
    perfCounters.trialScore++;
    const r = trialRelation(compiled, t.facts, policy);
    scored.push({ t, rels: r.rels, score: t.prior - precheckPenalty(r.notes) + precheckBonus(r.notes), conflict: r.conflict, support: r.support });
  }
  const value: Analysis = { scored, compiled };
  entries.push({ catalog, policy, value });
  return value;
}

/**
 * Pool trials passing the live hard filters, best first, with their current score (prior − penalties +
 * bonuses) and whether any answer conflicts. Ties break by id, so the order is deterministic.
 */
export function rankPool(state: QuestionnaireState, pool: CandidatePool, catalog: readonly QuestionDef[], opts: EngineOptions = {}): Array<{ id: string; score: number; conflict: boolean }> {
  return scorePool(state, pool, catalog, opts.policy)
    .map((s) => ({ id: s.t.id, score: s.score, conflict: s.conflict }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/**
 * Live counter: "N possible trials near you · M with no likely conflicts". Hard filters change `total`;
 * definite answers change `noConflict`. Unknown answers change neither.
 */
export function liveCount(state: QuestionnaireState, pool: CandidatePool, catalog: readonly QuestionDef[], opts: EngineOptions = {}): { total: number; noConflict: number; supported: number } {
  const scored = scorePool(state, pool, catalog, opts.policy);
  let noConflict = 0;
  let supported = 0;
  for (const s of scored) {
    if (s.conflict) continue;
    noConflict++;
    if (s.support) supported++;
  }
  return { total: scored.length, noConflict, supported };
}

// ---------------------------------------------------------------------------------------------
// Information gain

/** Shannon entropy in bits. */
export function entropy(p: readonly number[]): number {
  let h = 0;
  for (const x of p) if (x > 0) h -= x * Math.log2(x);
  return h;
}

/** Softmax of scores / TAU (max-shifted for numerical stability). */
export function softmax(scores: readonly number[], tau: number = TAU): number[] {
  if (scores.length === 0) return [];
  const m = Math.max(...scores);
  const e = scores.map((s) => Math.exp((s - m) / tau));
  const z = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / z);
}

interface Hypothesis {
  value: AnswerValue;
  p: number;
}

/** Definite answer hypotheses with P(a), grouped into independent sub-questions (one per biomarker). */
/** Answer priors for a question in a group: the catalog's, else the engine fallback (constants.ts), else none. */
export function optionPriors(q: QuestionDef, group: CancerGroupId): Record<string, number> | undefined {
  return q.priors?.[group] ?? FALLBACK_PRIORS[q.id]?.(group);
}

function hypotheses(q: QuestionDef, group: CancerGroupId): Hypothesis[][] {
  const priors = optionPriors(q, group);
  if (q.type === "biomarker_grid") {
    return (q.biomarkers ?? []).map((m) => {
      const pos = priors?.[`${m}:positive`] ?? DEFAULT_BIOMARKER_PRIOR.positive;
      const neg = priors?.[`${m}:negative`] ?? DEFAULT_BIOMARKER_PRIOR.negative;
      const unk = priors?.[`${m}:unknown`] ?? priors?.[UNKNOWN] ?? DEFAULT_BIOMARKER_PRIOR.unknown;
      const z = pos + neg + unk || 1;
      return [
        { value: { [m]: "positive" }, p: pos / z },
        { value: { [m]: "negative" }, p: neg / z },
      ];
    });
  }
  if (q.type !== "single" && q.type !== "multi") return [];
  const definite = (q.options ?? []).map((o) => o.id).filter((id) => !isNonResponseId(id));
  if (definite.length === 0) return [[]];
  const asValue = (id: string): AnswerValue => (q.type === "multi" ? [id] : id);
  if (!priors) {
    const each = (1 - DEFAULT_P_UNKNOWN) / definite.length;
    return [definite.map((id) => ({ value: asValue(id), p: each }))];
  }
  const nonResp = Object.entries(priors).filter(([k]) => isNonResponseId(k)).reduce((s, [, v]) => s + v, 0);
  const z = definite.reduce((s, id) => s + (priors[id] ?? 0), 0) + nonResp || 1;
  return [definite.map((id) => ({ value: asValue(id), p: (priors[id] ?? 0) / z }))];
}

/** P(the patient cannot answer): explicit prior, the biomarker default, or DEFAULT_P_UNKNOWN. */
export function unknownPrior(q: QuestionDef, group: CancerGroupId): number {
  const subs = hypotheses(q, group);
  if (subs.length === 0) return 0;
  const per = subs.map((h) => 1 - h.reduce((s, x) => s + x.p, 0));
  return per.reduce((a, b) => a + b, 0) / per.length;
}

const L_CONFLICT = Math.exp(-LAMBDA);
const L_SUPPORT = Math.exp(MU);

/** Relation of one compiled answer to a trial's facts: any conflicting fact wins, else any support (policy applied). */
function relationOf(c: CompiledAnswer, facts: readonly CompactFact[], policy: FactPolicyMap | undefined): "conflict" | "support" | "neutral" {
  let support = false;
  for (const f of facts) {
    const rel = applyPolicy(factRelation([c], f), f.key, policy);
    if (rel === "conflict") return "conflict";
    if (rel === "support") support = true;
  }
  return support ? "support" : "neutral";
}

/** Likelihood of a hypothetical answer for one trial: e^-LAMBDA on a conflict, e^MU on a support, else 1. */
function likelihood(c: CompiledAnswer, t: PoolTrial, policy: FactPolicyMap | undefined): number {
  if (c.hardFilter && !passesHardFilters(t.sex, c.hardFilter)) return HARD_EXCLUDED_LIKELIHOOD;
  const rel = relationOf(c, t.facts, policy);
  return rel === "conflict" ? L_CONFLICT : rel === "support" ? L_SUPPORT : 1;
}

/** Hypotheses with their compiled answers, cached per question definition and group (catalog objects are stable,
 *  and compiling an answer walks the question's option effects). */
interface CompiledHypothesis extends Hypothesis {
  compiled: CompiledAnswer;
}
const hypothesisCache = new WeakMap<QuestionDef, Map<string, CompiledHypothesis[][]>>();
function compiledHypotheses(q: QuestionDef, group: CancerGroupId): CompiledHypothesis[][] {
  let byGroup = hypothesisCache.get(q);
  if (!byGroup) hypothesisCache.set(q, (byGroup = new Map()));
  let subs = byGroup.get(group);
  if (!subs) {
    subs = hypotheses(q, group).map((sub) => sub.map((h) => ({ ...h, compiled: compileAnswer(q, h.value) })));
    byGroup.set(group, subs);
  }
  return subs;
}

/** Expected information gain (bits) of asking q, over the top-K candidate distribution p. Never negative. */
export function informationGain(q: QuestionDef, group: CancerGroupId, top: readonly PoolTrial[], p: readonly number[], policy?: FactPolicyMap): number {
  if (top.length === 0) return 0;
  const h0 = entropy(p);
  let gain = 0;
  for (const sub of compiledHypotheses(q, group)) {
    let g = 0;
    for (const h of sub) {
      if (h.p <= 0) continue;
      const post = top.map((t, i) => (p[i] ?? 0) * likelihood(h.compiled, t, policy));
      const z = post.reduce((a, b) => a + b, 0);
      const hp = z > 0 ? entropy(post.map((x) => x / z)) : 0;
      g += h.p * (h0 - hp);
    }
    // Floating-point noise below 1e-12 bits is not information (all likelihoods equal => exactly no gain).
    if (g > 1e-12) gain += g;
  }
  return gain;
}

/** "Answering this could narrow N trials to about M": M = min over definite answers of the no-conflict count. */
function impactOf(q: QuestionDef, group: CancerGroupId, scored: readonly Scored[], policy: FactPolicyMap | undefined) {
  const base = scored.filter((s) => !s.conflict);
  const total = base.length;
  let narrowed = total;
  for (const sub of compiledHypotheses(q, group)) {
    for (const h of sub) {
      const c = h.compiled;
      const m = base.filter((s) => (!c.hardFilter || passesHardFilters(s.t.sex, c.hardFilter)) && relationOf(c, s.t.facts, policy) !== "conflict").length;
      narrowed = Math.min(narrowed, m);
    }
  }
  return { total, narrowedTo: narrowed < total ? narrowed : null };
}

/**
 * Expected "regret" of not asking q: for each definite answer a (probability P(a)), re-score the pool as if the patient
 * had given it and measure how far the CURRENT top 10 is from the top 10 that answer would produce (1 - nDCG@10 of the
 * current order against the new top-10 set). Summed over answers by prior. Unlike entropy over the top-K, this values
 * exactly what the patient sees: moves among trials 20-60 count for nothing, a trial entering the top 10 counts a lot.
 */
function expectedRegret(q: QuestionDef, group: CancerGroupId, an: Analysis, policy: FactPolicyMap | undefined): number {
  if (!an.order) {
    const order = [...an.scored].sort((a, b) => b.score - a.score || a.t.id.localeCompare(b.t.id));
    const byKey = new Map<string, number[]>();
    order.forEach((s, i) => {
      for (const f of s.t.facts) {
        const list = byKey.get(f.key);
        if (!list) byKey.set(f.key, [i]);
        else if (list[list.length - 1] !== i) list.push(i);
      }
    });
    an.order = order;
    an.byKey = byKey;
    an.stamp = new Int32Array(order.length);
    an.fresh = new Float64Array(order.length);
    an.round = 0;
  }
  const order = an.order;
  const byKey = an.byKey as Map<string, number[]>;
  const stamp = an.stamp as Int32Array;
  const fresh = an.fresh as Float64Array;
  const n = Math.min(REGRET_TOP_N, order.length);
  if (n === 0) return 0;
  let total = 0;
  for (const sub of compiledHypotheses(q, group)) {
    let g = 0;
    for (const h of sub) {
      if (h.p <= 0) continue;
      const c = h.compiled;
      // Re-score only what the answer can change: trials that have one of its fact keys, or that a hard filter removes.
      const round = ++an.round!;
      const changed: number[] = [];
      const hf = c.hardFilter;
      if (hf) {
        for (let i = 0; i < order.length; i++) {
          if (!passesHardFilters((order[i] as Scored).t.sex, hf)) {
            stamp[i] = round;
            fresh[i] = Number.NaN; // removed
            changed.push(i);
          }
        }
      }
      for (const key of c.rules.keys()) {
        for (const i of byKey.get(key) ?? []) {
          if (stamp[i] === round) continue;
          const s = order[i] as Scored;
          stamp[i] = round;
          fresh[i] = scoreWith(s, c, policy);
          changed.push(i);
        }
      }
      if (changed.length === 0) continue;
      // The new top n is among the first n unchanged trials (already in order) and the changed trials that beat them.
      const pool: Array<{ id: string; score: number }> = [];
      for (let i = 0; i < order.length && pool.length < n; i++) if (stamp[i] !== round) pool.push({ id: (order[i] as Scored).t.id, score: (order[i] as Scored).score });
      const floor = pool.length === n ? (pool[n - 1] as { score: number }).score : Number.NEGATIVE_INFINITY;
      for (const i of changed) {
        const v = fresh[i] as number;
        if (!Number.isNaN(v) && v >= floor) pool.push({ id: (order[i] as Scored).t.id, score: v });
      }
      pool.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      const target = new Set(pool.slice(0, n).map((x) => x.id));
      let dcg = 0;
      for (let i = 0; i < n; i++) if (target.has((order[i] as Scored).t.id)) dcg += 1 / Math.log2(i + 2);
      let idealT = 0;
      for (let i = 0; i < Math.min(n, target.size); i++) idealT += 1 / Math.log2(i + 2);
      g += h.p * (idealT === 0 ? 0 : 1 - dcg / idealT);
    }
    total += g;
  }
  return total;
}

// ---------------------------------------------------------------------------------------------
// Eligibility and stop rules

function asksSex(q: QuestionDef): boolean {
  return q.id === Q_SEX || q.effects.some((e) => e.hardFilter?.sex !== undefined);
}

/** Questions that may be asked now (adaptive phase): enabled, applicable, prerequisites met, unanswered, not deferred. */
export function eligibleQuestions(state: QuestionnaireState, pool: CandidatePool | null, catalog: readonly QuestionDef[]): QuestionDef[] {
  const group = groupOf(state);
  const out: QuestionDef[] = [];
  let sexShare: number | null = null;
  for (const q of catalog) {
    if (!q.enabled || isEssential(q, q.id)) continue;
    if (state.answers[q.id] !== undefined || state.deferred.includes(q.id)) continue;
    if (!appliesToGroup(q, group) || !prerequisitesHold(q, state)) continue;
    if (asksSex(q)) {
      // Ask sex only when it can matter: >= 5% of current candidates are sex-restricted.
      if (sexShare === null) {
        const trials = pool?.trials ?? [];
        sexShare = trials.length === 0 ? 0 : trials.filter((t) => t.sex !== "ALL").length / trials.length;
      }
      if (sexShare < SEX_ASK_MIN_SHARE) continue;
    }
    out.push(q);
  }
  return out;
}

/** Number of "don't know"-type answers in a row at the end of the history, and their kind. */
function unknownStreak(state: QuestionnaireState, byId: ReadonlyMap<string, QuestionDef>): { family: string | null; count: number } {
  let family: string | null = null;
  let count = 0;
  for (let i = state.history.length - 1; i >= 0; i--) {
    const id = state.history[i] as string;
    const q = byId.get(id);
    if (!q || isEssential(q, id)) break;
    if (family !== null && q.type !== family) break;
    const v = state.answers[id];
    let n = 0;
    if (isNonResponse(v)) n = q.type === "biomarker_grid" && v && typeof v === "object" ? Math.max(1, Object.keys(v).length) : 1;
    if (n === 0) break;
    family = q.type;
    count += n;
  }
  return { family, count };
}

function adaptiveAsked(state: QuestionnaireState, byId: ReadonlyMap<string, QuestionDef>): number {
  return state.history.filter((id) => !isEssential(byId.get(id), id)).length;
}

/** The first unanswered essential (fixed order), if any. */
function nextEssential(state: QuestionnaireState, catalog: readonly QuestionDef[]): QuestionDef | null {
  const byId = new Map(catalog.map((q) => [q.id as string, q]));
  const ordered = [...ESSENTIALS.map((id) => byId.get(id)).filter((q): q is QuestionDef => q !== undefined), ...catalog.filter((q) => q.tier === "essential" && !ESSENTIALS.includes(q.id))];
  const group = groupOf(state);
  for (const q of ordered) {
    // Answered = present. null is a valid essential answer (travel "anywhere" may be stored as null).
    if (state.answers[q.id] !== undefined) continue;
    if (!ESSENTIALS.includes(q.id) && (!appliesToGroup(q, group) || !prerequisitesHold(q, state))) continue;
    return q;
  }
  return null;
}

/** Utility of each eligible question now (for tests, debugging and the "about N more" estimate). */
export function rankQuestions(state: QuestionnaireState, pool: CandidatePool, catalog: readonly QuestionDef[], opts: EngineOptions = {}): Array<{ question: QuestionDef; gain: number; utility: number }> {
  const an = analyze(state, pool, catalog, opts.policy);
  if (an.ranked) return an.ranked;
  const group = groupOf(state) ?? pool.group;
  const byId = new Map(catalog.map((q) => [q.id as string, q]));
  const top = [...an.scored].sort((a, b) => b.score - a.score || a.t.id.localeCompare(b.t.id)).slice(0, TOP_K);
  const p = softmax(top.map((s) => s.score));
  const trials = top.map((s) => s.t);
  const streak = unknownStreak(state, byId);
  const out: Array<{ question: QuestionDef; gain: number; utility: number }> = [];
  for (const q of eligibleQuestions(state, pool, catalog)) {
    const ig = informationGain(q, group, trials, p, opts.policy);
    const gain = INFO_GAIN_WEIGHT * ig + REGRET_WEIGHT * expectedRegret(q, group, an, opts.policy);
    let utility = (gain / q.cost) * TIER_FACTOR[state.mode][q.tier];
    if (streak.count >= UNKNOWN_STREAK && streak.family === q.type && unknownPrior(q, group) >= HIGH_UNKNOWN_PRIOR) utility *= FAMILY_DOWNWEIGHT;
    out.push({ question: q, gain, utility });
  }
  an.ranked = out;
  return out;
}

/**
 * The next step: an essential (fixed order), else the eligible question with the highest utility (ties broken
 * by catalog order), else "done" with the stop reason. Deterministic for a given state, pool and catalog.
 */
export function nextQuestion(state: QuestionnaireState, pool: CandidatePool, catalog: readonly QuestionDef[], opts: EngineOptions = {}): NextStep {
  const essential = nextEssential(state, catalog);
  if (essential) return { kind: "ask", question: essential, utility: Number.POSITIVE_INFINITY, impact: { total: pool.trials.length, narrowedTo: null } };

  const rule = STOP_RULES[state.mode];
  const byId = new Map(catalog.map((q) => [q.id as string, q]));
  const ranked = rankQuestions(state, pool, catalog, opts);
  if (ranked.length === 0) return { kind: "done", reason: "exhausted" };
  if (adaptiveAsked(state, byId) >= rule.maxQuestions) return { kind: "done", reason: "max_questions" };
  const scored = scorePool(state, pool, catalog, opts.policy);
  if (rule.smallSet !== null && scored.filter((s) => !s.conflict).length <= rule.smallSet) return { kind: "done", reason: "small_set" };

  let best = ranked[0] as (typeof ranked)[number];
  for (const r of ranked) if (r.utility > best.utility) best = r;
  if (!(best.utility >= rule.minUtility)) return { kind: "done", reason: "low_gain" };
  const group = groupOf(state) ?? pool.group;
  return { kind: "ask", question: best.question, utility: best.utility, impact: impactOf(best.question, group, scored, opts.policy) };
}

/** Rough "about N more questions" for the header (never a fake percentage). */
export function estimateRemaining(state: QuestionnaireState, pool: CandidatePool, catalog: readonly QuestionDef[], opts: EngineOptions = {}): number {
  if (nextEssential(state, catalog)) return ESSENTIALS.filter((id) => state.answers[id] === undefined).length;
  const byId = new Map(catalog.map((q) => [q.id as string, q]));
  const rule = STOP_RULES[state.mode];
  const worthAsking = rankQuestions(state, pool, catalog, opts).filter((r) => r.utility >= rule.minUtility).length;
  return Math.max(0, Math.min(worthAsking, rule.maxQuestions - adaptiveAsked(state, byId)));
}

/** "Answer N more optional questions": eligible Deep-dive questions left after stopping. */
export function remainingOptional(state: QuestionnaireState, pool: CandidatePool, catalog: readonly QuestionDef[]): number {
  return eligibleQuestions(state, pool, catalog).filter((q) => q.tier === "deep").length;
}

// ---------------------------------------------------------------------------------------------
// "Find out at your next appointment" (§5.3)

/**
 * One item per question answered "not sure", skipped or deferred ("prefer not to say" is a choice, not a
 * gap, so it is left out) that has a find-out definition. Most useful first (utility when asked), then
 * catalog order; items sharing the same "what to ask" text appear once. Never sent anywhere.
 */
export function findOutList(state: QuestionnaireState, catalog: readonly QuestionDef[], items?: Readonly<Record<string, FindOutDef>>): FindOutEntry[] {
  const order = new Map(catalog.map((q, i) => [q.id as string, i]));
  const entries: FindOutEntry[] = [];
  for (const q of activeQuestions(state, catalog)) {
    const v = state.answers[q.id];
    const deferred = state.deferred.includes(q.id);
    const gap =
      deferred ||
      (typeof v === "string" && isNonResponseId(v) && v !== PREFER_NOT) ||
      (Array.isArray(v) && v.length > 0 && v.every((x) => isNonResponseId(x) && x !== PREFER_NOT)) ||
      (v !== null && typeof v === "object" && !Array.isArray(v) && Object.values(v).some((x) => isNonResponseId(x)));
    if (!gap) continue;
    // Items are keyed by question id or by find-out id ("findOut.<id>.what" -> <id>, config/questionnaire/find-out.ts).
    const findOutId = q.findOutKey?.match(/^findOut\.(.+)\.what$/)?.[1];
    const def = items?.[q.id] ?? (findOutId ? items?.[findOutId] : undefined) ?? (q.findOutKey ? { whatKey: q.findOutKey, whereKey: q.findOutKey, whyKey: q.whyKey } : null);
    if (!def) continue;
    entries.push({ question: q.id, whatKey: def.whatKey, whereKey: def.whereKey, whyKey: def.whyKey, deferred });
  }
  const gain = (id: string) => state.gains?.[id] ?? -1;
  entries.sort((a, b) => gain(b.question) - gain(a.question) || (order.get(a.question) ?? 0) - (order.get(b.question) ?? 0));
  const seen = new Set<string>();
  return entries.filter((e) => (seen.has(e.whatKey) ? false : (seen.add(e.whatKey), true)));
}

/** Questions to reopen for "Fill in what you found out" (exactly the Find-out items). */
export function findOutQuestions(state: QuestionnaireState, catalog: readonly QuestionDef[], items?: Readonly<Record<string, FindOutDef>>): string[] {
  return findOutList(state, catalog, items).map((e) => e.question);
}

// ---------------------------------------------------------------------------------------------
// Session resume: sessionStorage only (tab-scoped, gone when the tab closes). Never localStorage/IndexedDB/server.

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function saveSession(state: QuestionnaireState): void {
  try {
    storage()?.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked: resume is a convenience only */
  }
}

/** The saved state, or null when absent, invalid (zod) or older than 12 hours (then it is also removed). */
export function loadSession(now: number = Date.now()): QuestionnaireState | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = QuestionnaireStateSchema.safeParse(JSON.parse(raw));
    if (parsed.success && now - parsed.data.updatedAt <= SESSION_MAX_AGE_MS && parsed.data.updatedAt <= now + 60_000) return parsed.data;
  } catch {
    /* fall through: discard */
  }
  clearSession();
  return null;
}

export function clearSession(): void {
  try {
    storage()?.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

// Pool builder and adapter live in their own modules.
export { buildCandidatePool, poolFromEntries } from "./pool";
export { toIntakeAnswers } from "./adapter";
