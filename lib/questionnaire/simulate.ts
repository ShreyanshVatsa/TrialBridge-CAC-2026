/**
 * Simulated patients (QUESTIONNAIRE_SPEC §7.2): adaptive vs fixed question order. Pure and seeded, so unit
 * tests and the eval script (scripts/eval/simulate.ts) can share it.
 *
 * A patient has hidden "true" answers sampled from the catalog priors and answers "don't know" with a
 * per-question probability. The oracle ranking uses every true answer. A flow is scored by nDCG@10 of its
 * ranking against the oracle top 10, and by the share of its top 10 that conflicts with the true answers.
 */
import type { CancerGroupId } from "@/config/cancer-groups";
import type { AnswerValue, FactPolicyMap, QuestionDef, QuestionnaireState } from "@/lib/types/questionnaire";
import { UNKNOWN } from "@/lib/types/questionnaire";
import { DEFAULT_BIOMARKER_PRIOR, DEFAULT_P_UNKNOWN } from "./constants";
import { applyAnswer, nextQuestion, optionPriors, rankPool, setMode, type CandidatePool } from "./engine";
import { appliesToGroup, isNonResponseId, prerequisitesHold } from "./rules";

/** Probability a patient says "don't know" (spec §7.2). Keyed by question id, then by answer type. */
const DONT_KNOW_RATE: Readonly<Record<string, number>> = { biomarkers: 0.4, deep_biomarkers: 0.4, daily_activity: 0.2, lines: 0.25, subtype: 0.3 };
const DEFAULT_DONT_KNOW_RATE = 0.1;

interface SimPatient {
  /** True answer for every question that applies (given the other true answers). */
  truth: Record<string, AnswerValue>;
  /** Questions this patient would answer "don't know". */
  dontKnow: Set<string>;
}

function sampleOption(r: () => number, q: QuestionDef, group: CancerGroupId): string | null {
  const ids = (q.options ?? []).map((o) => o.id).filter((id) => !isNonResponseId(id));
  if (ids.length === 0) return null;
  const pri = optionPriors(q, group);
  const w = ids.map((id) => (pri ? (pri[id] ?? 0) : (1 - DEFAULT_P_UNKNOWN) / ids.length));
  const z = w.reduce((a, b) => a + b, 0);
  if (z <= 0) return ids[Math.floor(r() * ids.length)] as string;
  let x = r() * z;
  for (let i = 0; i < ids.length; i++) if ((x -= w[i] as number) <= 0) return ids[i] as string;
  return ids[ids.length - 1] as string;
}

/** Sample a patient: true answers in catalog order (respecting prerequisites) and their "don't know" set. */
export function samplePatient(r: () => number, base: QuestionnaireState, catalog: readonly QuestionDef[], group: CancerGroupId): SimPatient {
  const truth: Record<string, AnswerValue> = {};
  const dontKnow = new Set<string>();
  const state: QuestionnaireState = { ...base, answers: { ...base.answers } };
  for (const q of catalog) {
    if (q.tier === "essential" || !q.enabled || !appliesToGroup(q, group) || !prerequisitesHold(q, state)) continue;
    let v: AnswerValue | null = null;
    if (q.type === "biomarker_grid") {
      const pri = q.priors?.[group];
      const grid: Record<string, string> = {};
      for (const m of q.biomarkers ?? []) {
        const pos = pri?.[`${m}:positive`] ?? DEFAULT_BIOMARKER_PRIOR.positive;
        const neg = pri?.[`${m}:negative`] ?? DEFAULT_BIOMARKER_PRIOR.negative;
        grid[m] = r() * (pos + neg) < pos ? "positive" : "negative";
      }
      v = grid;
    } else {
      const o = sampleOption(r, q, group);
      if (o !== null) v = q.type === "multi" ? [o] : o;
    }
    if (v === null) continue;
    truth[q.id] = v;
    state.answers[q.id] = v;
    if (r() < (DONT_KNOW_RATE[q.id] ?? DEFAULT_DONT_KNOW_RATE)) dontKnow.add(q.id);
  }
  return { truth, dontKnow };
}

/** What the patient says when asked q. */
export function patientAnswer(p: SimPatient, q: QuestionDef): AnswerValue {
  const t = p.truth[q.id];
  if (t === undefined || p.dontKnow.has(q.id)) return q.type === "multi" ? [UNKNOWN] : q.type === "biomarker_grid" ? {} : UNKNOWN;
  return t;
}

/** nDCG@10 of `ranked` ids against the binary relevant set (the oracle's top 10). */
export function ndcgAt10(ranked: readonly string[], relevant: ReadonlySet<string>): number {
  const dcg = ranked.slice(0, 10).reduce((s, id, i) => s + (relevant.has(id) ? 1 / Math.log2(i + 2) : 0), 0);
  let ideal = 0;
  for (let i = 0; i < Math.min(10, relevant.size); i++) ideal += 1 / Math.log2(i + 2);
  return ideal === 0 ? 1 : dcg / ideal;
}

export interface FlowResult {
  asked: string[];
  ndcg: number;
  /** Share of the flow's top 10 that conflicts with the patient's true answers. */
  conflictShare: number;
}

interface SimContext {
  pool: CandidatePool;
  catalog: readonly QuestionDef[];
  base: QuestionnaireState;
  patient: SimPatient;
  oracle: ReadonlySet<string>;
  oracleState: QuestionnaireState;
  policy?: FactPolicyMap;
}

function evaluate(ctx: SimContext, state: QuestionnaireState, asked: string[]): FlowResult {
  const opts = ctx.policy ? { policy: ctx.policy } : {};
  const top = rankPool(state, ctx.pool, ctx.catalog, opts).slice(0, 10).map((x) => x.id);
  const truthConflict = new Set(rankPool(ctx.oracleState, ctx.pool, ctx.catalog, opts).filter((x) => x.conflict).map((x) => x.id));
  return { asked, ndcg: ndcgAt10(top, ctx.oracle), conflictShare: top.length ? top.filter((id) => truthConflict.has(id)).length / top.length : 0 };
}

/** Oracle context for one patient. */
export function simContext(pool: CandidatePool, catalog: readonly QuestionDef[], base: QuestionnaireState, patient: SimPatient, policy?: FactPolicyMap): SimContext {
  const oracleState: QuestionnaireState = { ...base, answers: { ...base.answers, ...patient.truth } };
  const opts = policy ? { policy } : {};
  const oracle = new Set(rankPool(oracleState, pool, catalog, opts).slice(0, 10).map((x) => x.id));
  return { pool, catalog, base, patient, oracle, oracleState, ...(policy ? { policy } : {}) };
}

/**
 * Adaptive flow: up to k questions chosen by the engine (thorough mode, so only k or exhaustion stops it).
 * The engine is deterministic, so the flow for k questions is a prefix of the flow for k + 1: `runAdaptiveCurve`
 * walks it once and scores every prefix, which is how the eval gets k = 1..K without K separate runs.
 */
export function runAdaptive(ctx: SimContext, k: number, mode: "quick" | "thorough" = "thorough"): FlowResult {
  const curve = runAdaptiveCurve(ctx, k, mode);
  return curve[curve.length - 1] as FlowResult;
}

/** Results after 0, 1, ..., (up to) kMax adaptive questions: index j = after j questions (stops early when the engine is done). */
export function runAdaptiveCurve(ctx: SimContext, kMax: number, mode: "quick" | "thorough" = "thorough"): FlowResult[] {
  let state = setMode(ctx.base, mode, ctx.base.updatedAt);
  const asked: string[] = [];
  const opts = ctx.policy ? { policy: ctx.policy } : {};
  const curve: FlowResult[] = [];
  for (;;) {
    curve.push(evaluate(ctx, state, [...asked]));
    if (asked.length >= kMax) break;
    const step = nextQuestion(state, ctx.pool, ctx.catalog, opts);
    if (step.kind === "done") break;
    asked.push(step.question.id);
    state = applyAnswer(state, step.question.id, patientAnswer(ctx.patient, step.question), ctx.catalog, { now: state.updatedAt }).state;
  }
  return curve;
}

/** Fixed flow: eligible questions in catalog order (the original fixed intake), truncated at k. */
export function runFixed(ctx: SimContext, k: number): FlowResult {
  const curve = runFixedCurve(ctx, k);
  return curve[curve.length - 1] as FlowResult;
}

/** Fixed-order results after 0, 1, ..., (up to) kMax questions. */
export function runFixedCurve(ctx: SimContext, kMax: number): FlowResult[] {
  let state = ctx.base;
  const asked: string[] = [];
  const group = ctx.pool.group;
  const curve: FlowResult[] = [evaluate(ctx, state, [])];
  for (const q of ctx.catalog) {
    if (asked.length >= kMax) break;
    if (q.tier === "essential" || !q.enabled || !appliesToGroup(q, group) || !prerequisitesHold(q, state) || state.answers[q.id] !== undefined) continue;
    asked.push(q.id);
    state = applyAnswer(state, q.id, patientAnswer(ctx.patient, q), ctx.catalog, { now: state.updatedAt }).state;
    curve.push(evaluate(ctx, state, [...asked]));
  }
  return curve;
}
