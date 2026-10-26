/**
 * Answer semantics shared by the adaptive engine (engine.ts) and the matching pre-check
 * (lib/match/precheck.ts `evaluateAnswers`). Pure functions, no I/O.
 *
 * The one rule that matters most: a non-response (unknown, skip, prefer not to say, deferred, "not tested")
 * compiles to NOTHING: no fact rules, no query terms, no hard filter. So it can never lower a score,
 * exclude a trial, or shrink the live counter.
 */
import { BIOMARKERS } from "@/config/biomarkers";
import { perfCounters } from "@/lib/perf/counters";
import { CANCER_GROUP_IDS, type CancerGroupId } from "@/config/cancer-groups";
import { isScopedParam, type FactKey, type FactValue } from "@/lib/types/trial";
import {
  NON_RESPONSE_IDS,
  UNKNOWN,
  type AnswerValue,
  type FactPolicyMap,
  type FactRelation,
  type FactRule,
  type HardFilterPatch,
  type QuestionDef,
  type QuestionnaireState,
} from "@/lib/types/questionnaire";
import { Q_AGE, Q_CANCER_TYPE } from "./constants";

/** A trial fact without its quote (enough for matching; lite cards and the candidate pool carry only this). */
export interface CompactFact {
  key: FactKey;
  value: FactValue;
  param?: string | number;
  source?: "rule" | "llm";
  confidence?: number;
  needsReview?: boolean;
}

/** A fact rule plus whether it comes from an option the patient did NOT pick (multi-select inference). */
interface CompiledRule {
  rule: FactRule;
  inverted: boolean;
}

/** What one answered question contributes to matching. Empty for every non-response. */
export interface CompiledAnswer {
  question: string;
  rules: Map<string, CompiledRule[]>;
  hardFilter: HardFilterPatch | null;
  queryTerms: string[];
}

export function isNonResponseId(id: string): boolean {
  return NON_RESPONSE_IDS.includes(id);
}

/** True when an answer carries no information (unanswered, deferred, unknown, skip, prefer not, all-unknown grid). */
export function isNonResponse(v: AnswerValue | undefined): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "number") return false;
  if (typeof v === "string") return isNonResponseId(v);
  if (Array.isArray(v)) return v.length === 0 || v.every(isNonResponseId);
  return Object.values(v).every(isNonResponseId);
}

/** The selected cancer group, or null before the essentials are answered. */
export function groupOf(state: QuestionnaireState): CancerGroupId | null {
  const g = state.answers[Q_CANCER_TYPE];
  return typeof g === "string" && (CANCER_GROUP_IDS as readonly string[]).includes(g) ? (g as CancerGroupId) : null;
}

/** Does the question apply to this group? Before a group is known only "all" questions apply. */
export function appliesToGroup(q: QuestionDef, group: CancerGroupId | null): boolean {
  if (group && q.excludeGroups?.includes(group)) return false;
  if (q.appliesTo === "all") return true;
  return group !== null && q.appliesTo.includes(group);
}

/** Ids an answer offers to prerequisite matching. Non-responses all read as "unknown". */
function answerIds(v: AnswerValue): string[] {
  if (v === null) return [UNKNOWN];
  if (typeof v === "number") return [String(v)];
  if (typeof v === "string") return [isNonResponseId(v) ? UNKNOWN : v];
  if (Array.isArray(v)) return v.length === 0 ? [UNKNOWN] : v.map((x) => (isNonResponseId(x) ? UNKNOWN : x));
  return isNonResponse(v) ? [UNKNOWN] : ["*"];
}

/** All prerequisites hold (and the patient is not older than the question's `maxAge`, e.g. pregnancy 59).
 *  Unanswered prerequisite questions fail `anyOf` and pass `negate` rules; an unanswered age passes maxAge. */
export function prerequisitesHold(q: QuestionDef, state: QuestionnaireState): boolean {
  const age = state.answers[Q_AGE];
  if (q.maxAge !== undefined && typeof age === "number" && age > q.maxAge) return false;
  for (const p of q.prerequisites ?? []) {
    const v = state.answers[p.question];
    if (v === undefined) {
      if (p.negate) continue;
      return false;
    }
    const ids = answerIds(v);
    const hit = p.anyOf.includes("*") || ids.some((id) => p.anyOf.includes(id));
    if (p.negate ? hit : !hit) return false;
  }
  return true;
}

/** Relation of one rule to one trial fact (fact.key === rule.fact). "mentioned" is always neutral. */
export function ruleRelation(rule: FactRule, fact: CompactFact): FactRelation {
  if (fact.value === "mentioned") return "neutral";
  if (rule.paramIn) {
    const applies = fact.param === undefined ? rule.paramIn.includes("*") : rule.paramIn.includes(String(fact.param));
    if (!applies) return "neutral";
  }
  const base = (fact.value === "required" ? rule.whenRequired : rule.whenExcluded) ?? "neutral";
  if (rule.paramCompare && typeof fact.param === "number") {
    const { op, value } = rule.paramCompare;
    const holds = op === "lte" ? value <= fact.param : value >= fact.param;
    return holds ? base : rule.paramCompare.else;
  }
  return base;
}

/**
 * A multi-select option the patient did NOT pick, on a definite answer (and a fact no picked option covers): what would have been support
 * (the trial requires it) becomes a conflict; anything else is neutral. E.g. "chemotherapy" not picked +
 * trial requires prior chemotherapy => conflict; trial excludes prior chemotherapy => nothing.
 */
function invert(r: FactRelation): FactRelation {
  return r === "support" ? "conflict" : "neutral";
}

const BIOMARKER_LABEL = new Map(BIOMARKERS.map((b) => [b.id as string, b.label]));
/** Biomarker grid semantics (same as the legacy pre-check): positive => required supports, excluded conflicts;
 *  negative => required conflicts. "not_tested" / "unknown" => nothing. */
const BIOMARKER_RULES: Record<"positive" | "negative", Omit<FactRule, "fact">> = {
  positive: { whenRequired: "support", whenExcluded: "conflict" },
  negative: { whenRequired: "conflict" },
};

function push(rules: Map<string, CompiledRule[]>, rule: FactRule, inverted: boolean): void {
  const list = rules.get(rule.fact) ?? [];
  list.push({ rule, inverted });
  rules.set(rule.fact, list);
}

/** Compile one question's answer into fact rules, a hard-filter patch and query terms. */
export function compileAnswer(q: QuestionDef, v: AnswerValue | undefined): CompiledAnswer {
  const out: CompiledAnswer = { question: q.id, rules: new Map(), hardFilter: null, queryTerms: [] };
  if (v === undefined || isNonResponse(v)) return out;
  const effectFor = (opt: string) => q.effects.find((e) => e.option === opt);

  if (q.type === "biomarker_grid") {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return out;
    const grid: Record<string, string> = v;
    for (const id of q.biomarkers ?? Object.keys(grid)) {
      const status = grid[id];
      if (status !== "positive" && status !== "negative") continue;
      push(out.rules, { fact: `biomarker:${id}` as FactKey, ...BIOMARKER_RULES[status] }, false);
      // Query terms name positive markers only: "EGFR negative" in a keyword or embedding query pulls in the trials
      // that require EGFR (TREC 2021 dev nDCG@10 0.491 -> 0.521, vignette dev excluded share -0.018).
      if (status === "positive") out.queryTerms.push(`${BIOMARKER_LABEL.get(id) ?? id} positive.`);
    }
    return out;
  }
  if (q.type === "multi") {
    if (!Array.isArray(v)) return out;
    const picked = new Set(v);
    for (const e of q.effects) {
      if (!picked.has(e.option)) continue;
      for (const r of e.facts) push(out.rules, r, false);
      out.queryTerms.push(...(e.queryTerms ?? []));
    }
    // Inference from options NOT picked, only on a definite answer and only for facts no picked option speaks
    // to (e.g. picked chemotherapy already says "previously treated"; unpicked surgery must not contradict it).
    if (v.some(isNonResponseId)) return out;
    const pickedKeys = new Set(out.rules.keys());
    for (const e of q.effects) {
      if (picked.has(e.option) || isNonResponseId(e.option)) continue;
      for (const r of e.facts) if (!pickedKeys.has(r.fact)) push(out.rules, r, true);
    }
    return out;
  }
  if (q.type === "single" && typeof v === "string") {
    const e = effectFor(v);
    if (!e) return out;
    for (const r of e.facts) push(out.rules, r, false);
    out.queryTerms.push(...(e.queryTerms ?? []));
    if (e.hardFilter && Object.keys(e.hardFilter).length > 0) out.hardFilter = { ...e.hardFilter };
  }
  // Essentials (group, age, ZIP, travel) are hard filters applied when the pool is built, not fact rules.
  return out;
}

/** Combined relation of compiled answers to one fact: any conflict wins, then any support. */
export function factRelation(compiled: readonly CompiledAnswer[], fact: CompactFact): FactRelation {
  perfCounters.factRelation++;
  // Uncertain facts and time-window exclusions (answers cannot say when a treatment was) never penalize.
  if (fact.value === "mentioned" || fact.needsReview || isScopedParam(fact.param)) return "neutral";
  let support = false;
  for (const c of compiled) {
    for (const { rule, inverted } of c.rules.get(fact.key) ?? []) {
      const r0 = ruleRelation(rule, fact);
      const r = inverted ? invert(r0) : r0;
      if (r === "conflict") return "conflict";
      if (r === "support") support = true;
    }
  }
  return support ? "support" : "neutral";
}

/** Policy for a fact key: exact key, then "<family>:*", then "<family>". */
export function policyFor(policy: FactPolicyMap | undefined, key: string) {
  if (!policy) return undefined;
  // Looked up for every fact of every trial on every engine step, so remember the answer per policy object and key.
  let byKey = policyCache.get(policy);
  if (!byKey) policyCache.set(policy, (byKey = new Map()));
  if (byKey.has(key)) return byKey.get(key);
  const family = key.includes(":") ? key.slice(0, key.indexOf(":")) : key;
  const found = policy[key] ?? policy[`${family}:*`] ?? policy[family];
  byKey.set(key, found);
  return found;
}
const policyCache = new WeakMap<FactPolicyMap, Map<string, FactPolicyMap[string] | undefined>>();

/** Apply fact policy: penalize=false drops conflicts, and drops supports too unless supportOnly. */
export function applyPolicy(rel: FactRelation, key: string, policy: FactPolicyMap | undefined): FactRelation {
  const p = policyFor(policy, key);
  if (!p || p.penalize) return rel;
  if (rel === "support" && p.supportOnly) return "support";
  return "neutral";
}

/** Questions whose answers currently count: applicable to the group and prerequisites still holding. */
export function activeQuestions(state: QuestionnaireState, catalog: readonly QuestionDef[]): QuestionDef[] {
  const group = groupOf(state);
  return catalog.filter((q) => state.answers[q.id] !== undefined && appliesToGroup(q, group) && prerequisitesHold(q, state));
}

/** Compile every counted answer (catalog order). */
export function compileState(state: QuestionnaireState, catalog: readonly QuestionDef[]): CompiledAnswer[] {
  return activeQuestions(state, catalog).map((q) => compileAnswer(q, state.answers[q.id]));
}

/** Merge hard-filter patches from definite answers (only sex today). */
export function hardFilters(compiled: readonly CompiledAnswer[]): HardFilterPatch {
  const out: HardFilterPatch = {};
  for (const c of compiled) if (c.hardFilter?.sex) out.sex = c.hardFilter.sex;
  return out;
}

/** Does a trial with this structured sex pass the hard filters? ALL always passes. */
export function passesHardFilters(trialSex: "ALL" | "FEMALE" | "MALE", f: HardFilterPatch): boolean {
  return !f.sex || trialSex === "ALL" || trialSex === f.sex;
}

/** English profile phrases from the chosen options, in catalog order. Non-responses add nothing. */
export function queryTermsOf(compiled: readonly CompiledAnswer[]): string[] {
  return compiled.flatMap((c) => c.queryTerms);
}

/**
 * An answer re-checked against a (possibly different group's) question definition: single answers must be one
 * of its options, multi answers keep only its options, grid answers keep only its biomarkers. Returns the
 * cleaned answer, or undefined when nothing valid is left (the answer is then dropped).
 */
export function fitAnswer(q: QuestionDef, v: AnswerValue): AnswerValue | undefined {
  if (v === null || q.tier === "essential" || (typeof v === "string" && isNonResponseId(v))) return v;
  const ids = new Set((q.options ?? []).map((o) => o.id));
  const ok = (id: string) => ids.has(id) || isNonResponseId(id);
  if (q.type === "single") return typeof v === "string" && ok(v) ? v : undefined;
  if (q.type === "multi") {
    if (!Array.isArray(v)) return undefined;
    const kept = v.filter(ok);
    return kept.length === v.length ? v : kept.length > 0 ? kept : undefined;
  }
  if (q.type === "biomarker_grid") {
    if (typeof v !== "object" || Array.isArray(v)) return undefined;
    if (!q.biomarkers) return v;
    const allowed: readonly string[] = q.biomarkers;
    const kept = Object.entries(v).filter(([m]) => allowed.includes(m));
    if (kept.length === Object.keys(v).length) return v;
    return kept.length > 0 ? Object.fromEntries(kept) : undefined;
  }
  return v;
}
