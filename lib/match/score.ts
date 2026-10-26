import type { FitLevel } from "@/lib/types/analysis";
import type { PrecheckNote } from "@/lib/types/match";
import type { CriterionLabel, TrialMatchScore } from "@/lib/types/criteria";
import { maxRrfScore, RRF_K } from "./rrf";

/**
 * Final ranking score. Every weight is named and explained so the formula is auditable:
 *
 *   final = RETRIEVAL_WEIGHT * retrieval                         (0..1, how well the trial matches the profile text)
 *         - Σ over the MAX_COUNTED_CONFLICTS largest conflicts of
 *               CONFLICT_PENALTY * factWeight(conflict) * reliability(conflict)     (rule pre-check)
 *         + SUPPORT_BONUS * min(supports, MAX_COUNTED_SUPPORTS)
 *         + BIOMARKER_MATCH_BONUS  (once, when a biomarker the trial requires is one the patient has)
 *         + phase preference bonus (±PHASE_PREF_BONUS, a preference, never a filter)
 *         + FIT_ADJUSTMENT[fit]                                   (AI analysis, when available)
 *
 * "Not sure" / "don't know" / "skip" / "prefer not to say" answers never create notes (see precheck.ts),
 * so they never penalize. Facts never exclude a trial: only hard filters (group, age, distance, a definite
 * sex) do that, in filters.ts.
 */

/** Retrieval relevance (normalized RRF) is the backbone of the ranking. */
const RETRIEVAL_WEIGHT = 1.0;
/** Each likely conflict with a stated criterion pushes a trial down noticeably... */
export const CONFLICT_PENALTY = 0.15;
/** ...but only the first few count, so one strict trial isn't buried by repeated signals. Four, not three:
 *  the questionnaire's extra questions mean more legitimate signals, and it is still capped. */
export const MAX_COUNTED_CONFLICTS = 4;
/** Matching a stated requirement (e.g. HER2-positive required, user is HER2-positive) helps slightly. */
export const SUPPORT_BONUS = 0.03;
const MAX_COUNTED_SUPPORTS = 3;

/** How much one conflict on a fact key counts, relative to a typical rule (1.0). */
const DEFAULT_FACT_WEIGHT = 1.0;
/** Keys with a high carve-out rate ("unless treated more than 2 years ago", "unless controlled") or that patients
 *  describe only coarsely: half weight, because the criterion often has an exception we cannot see. */
export const LOW_CERTAINTY_FACT_WEIGHT = 0.5;
const LOW_CERTAINTY_KEYS: readonly string[] = ["other_malignancy", "kidney_disease", "liver_disease", "heart_disease", "measurable_disease"];
/** A trial that REQUIRES a specific subtype or biomarker is the most specific gate there is. */
export const SPECIFIC_REQUIREMENT_WEIGHT = 1.2;
/** Rule facts are trusted as extracted (families below the precision gate are already switched off by fact
 *  policy); LLM facts count in proportion to the model's stated confidence. */
const RULE_RELIABILITY = 1.0;

/** A required biomarker the patient has is strong positive evidence (counted once per trial). */
export const BIOMARKER_MATCH_BONUS = 0.08;
/** Phase preference nudges, never filters. */
export const PHASE_PREF_BONUS = 0.03;

/** AI fit level adjusts the score after analysis; "unclear" is neutral. */
export const FIT_ADJUSTMENT: Record<FitLevel, number> = {
  strong: 0.3,
  possible: 0.15,
  unclear: 0,
  unlikely: -0.3,
};

type NoteLike = Pick<PrecheckNote, "key" | "kind"> & Partial<Pick<PrecheckNote, "value" | "source" | "confidence">>;

/** FACT_WEIGHT[key]: 1.2 for required histology/biomarker gates, 0.5 for high carve-out keys, else 1.0. */
export function factWeight(n: NoteLike): number {
  if (LOW_CERTAINTY_KEYS.includes(n.key)) return LOW_CERTAINTY_FACT_WEIGHT;
  if (n.value === "required" && (n.key.startsWith("histology:") || n.key.startsWith("biomarker:"))) return SPECIFIC_REQUIREMENT_WEIGHT;
  return DEFAULT_FACT_WEIGHT;
}

/** RELIABILITY[source]: rule 1.0; llm = its confidence (1.0 when missing). */
export function reliability(n: NoteLike): number {
  return n.source === "llm" ? (n.confidence ?? 1) : RULE_RELIABILITY;
}

/** Normalize a raw RRF score to 0..1 given how many rankings were fused. */
export function normalizeRrf(rrf: number, rankingsUsed: number, k: number = RRF_K): number {
  if (rankingsUsed <= 0) return 0;
  return Math.min(1, rrf / maxRrfScore(rankingsUsed, k));
}

/** Penalty from pre-check conflicts (a positive number to subtract): the largest MAX_COUNTED_CONFLICTS weighted conflicts. */
export function precheckPenalty(notes: readonly NoteLike[]): number {
  const each = notes.filter((n) => n.kind === "conflict").map((n) => CONFLICT_PENALTY * factWeight(n) * reliability(n));
  each.sort((a, b) => b - a);
  return each.slice(0, MAX_COUNTED_CONFLICTS).reduce((s, x) => s + x, 0);
}

/** Bonus from pre-check supports, plus the one-off biomarker match bonus. */
export function precheckBonus(notes: readonly NoteLike[]): number {
  const supports = notes.filter((n) => n.kind === "support");
  const biomarkerMatch = supports.some((n) => n.value === "required" && n.key.startsWith("biomarker:"));
  return SUPPORT_BONUS * Math.min(supports.length, MAX_COUNTED_SUPPORTS) + (biomarkerMatch ? BIOMARKER_MATCH_BONUS : 0);
}

/**
 * Phase preference (questionnaire `phase_pref`): "open_phase1" favors first-in-human studies slightly;
 * "later_phase" favors phase 3 and disfavors phase 1-only studies. Anything else (no preference, unknown) is 0.
 */
export function phaseBonus(pref: string | null | undefined, phases: readonly string[]): number {
  const isEarly = phases.length > 0 && phases.every((p) => p === "PHASE1" || p === "EARLY_PHASE1");
  if (pref === "open_phase1") return isEarly ? PHASE_PREF_BONUS : 0;
  if (pref === "later_phase") {
    if (isEarly) return -PHASE_PREF_BONUS;
    return phases.includes("PHASE3") ? PHASE_PREF_BONUS : 0;
  }
  return 0;
}

/** Combine retrieval, rule pre-check, phase preference and (optional) AI fit into the final score. */
export function finalScore(input: { retrieval: number; precheck: readonly NoteLike[]; fit: FitLevel | null; phase?: number }): number {
  const fitAdj = input.fit ? FIT_ADJUSTMENT[input.fit] : 0;
  return RETRIEVAL_WEIGHT * input.retrieval - precheckPenalty(input.precheck) + precheckBonus(input.precheck) + (input.phase ?? 0) + fitAdj;
}

// ---------------------------------------------------------------------------------------------
// Per-criterion scoring (TrialGPT-style). Labels come from the deterministic resolver
// (criteria-resolve.ts) and, for the items it left unknown, the LLM judge (POST /api/match).
// ---------------------------------------------------------------------------------------------

/** Keeps incScore finite for a trial with no counted inclusion items. */
const INC_SCORE_EPSILON = 1e-9;

const INCLUSION_LABELS: ReadonlySet<string> = new Set(["met", "not_met", "unknown", "not_applicable"]);
const EXCLUSION_LABELS: ReadonlySet<string> = new Set(["excluded", "not_excluded", "unknown", "not_applicable"]);

/** True when `label` is a valid value for the criterion's section. */
function labelFitsSection(l: Pick<CriterionLabel, "section" | "label">): boolean {
  return (l.section === "inclusion" ? INCLUSION_LABELS : EXCLUSION_LABELS).has(l.label);
}

/** A hard failure: an inclusion not_met or an exclusion excluded. Unknown is never a failure. */
export function isHardFailure(l: Pick<CriterionLabel, "section" | "label">): boolean {
  return (l.section === "inclusion" && l.label === "not_met") || (l.section === "exclusion" && l.label === "excluded");
}

/**
 * Merge resolver labels with LLM labels. The resolver wins wherever it settled an item; an LLM label only fills an id
 * the resolver left "unknown", and only when the id exists, the section matches and the label is valid for it.
 * Order follows the resolver (the trial's criterion order). Pure.
 */
export function mergeLabels(resolver: readonly CriterionLabel[], llm: readonly CriterionLabel[] | null | undefined): CriterionLabel[] {
  if (!llm?.length) return resolver.map((l) => ({ ...l }));
  const byId = new Map(llm.map((l) => [l.id, l]));
  return resolver.map((r) => {
    if (r.label !== "unknown") return { ...r };
    const j = byId.get(r.id);
    if (!j || j.section !== r.section || !labelFitsSection(j)) return { ...r };
    const out: CriterionLabel = { id: r.id, section: r.section, label: j.label, source: "llm" };
    if (j.reason) out.reason = j.reason;
    if (j.answerIds?.length) out.answerIds = [...j.answerIds];
    return out;
  });
}

/**
 * Per-trial score from its labels:
 *   incScore = met / (met + not_met + unknown + 1e-9), over INCLUSION items (not_applicable is left out);
 *   tier "B" when any inclusion is not_met or any exclusion is excluded, else "A".
 * `counts` covers both sections (unknown = inclusion + exclusion unknowns). Unknowns never change the tier.
 */
export function trialMatchScore(trialId: string, labels: readonly CriterionLabel[], retrievalRank: number, degraded: boolean): TrialMatchScore {
  const counts = { met: 0, notMet: 0, excluded: 0, notExcluded: 0, unknown: 0, notApplicable: 0 };
  let incUnknown = 0;
  for (const l of labels) {
    if (l.label === "met") counts.met++;
    else if (l.label === "not_met") counts.notMet++;
    else if (l.label === "excluded") counts.excluded++;
    else if (l.label === "not_excluded") counts.notExcluded++;
    else if (l.label === "not_applicable") counts.notApplicable++;
    else if (l.label === "unknown") {
      counts.unknown++;
      if (l.section === "inclusion") incUnknown++;
    }
  }
  const hardFailures = labels.filter(isHardFailure).map((l) => ({ ...l }));
  return {
    trialId,
    incScore: counts.met / (counts.met + counts.notMet + incUnknown + INC_SCORE_EPSILON),
    tier: hardFailures.length > 0 ? "B" : "A",
    hardFailures,
    counts,
    retrievalRank,
    degraded,
  };
}

/** Tier A first (incScore high to low, then retrieval rank), then tier B (same order). Returns a new array. */
export function tierOrder<T extends Pick<TrialMatchScore, "tier" | "incScore" | "retrievalRank" | "trialId">>(scores: readonly T[]): T[] {
  return [...scores].sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "A" ? -1 : 1) || b.incScore - a.incScore || a.retrievalRank - b.retrievalRank || a.trialId.localeCompare(b.trialId));
}
