import type { SplitCriterion } from "@/lib/ingest/criteria-split";

export type InclusionLabel = "met" | "not_met" | "unknown" | "not_applicable";
export type ExclusionLabel = "excluded" | "not_excluded" | "unknown" | "not_applicable";
export type CriterionLabelValue = InclusionLabel | ExclusionLabel;

/** One criterion item's verdict. `source` says who settled it. */
export interface CriterionLabel {
  id: string;
  section: SplitCriterion["section"];
  label: CriterionLabelValue;
  source: "rule" | "llm" | "default";
  /** <=25 words, plain English. Never a quote of the criterion. */
  reason?: string;
  /** Numbered patient answers (A1..An) the verdict rests on. */
  answerIds?: string[];
}

export interface TrialCriteriaLabels {
  trialId: string;
  criteriaVersion: number;
  labels: CriterionLabel[];
  /** Provider that answered the LLM part, or null when resolver-only. */
  provider: string | null;
  /** LLM judge only: share of the criteria sent to the model that came back with a valid label (judged / sent). */
  coverage?: number;
  /** LLM judge only: prompt version that produced the labels. */
  promptVersion?: string;
}

/** Per-trial score from per-criterion labels. */
export interface TrialMatchScore {
  trialId: string;
  /** met / (met + not_met + unknown). */
  incScore: number;
  /** "A": no hard failure. "B": an inclusion not_met or an exclusion excluded. */
  tier: "A" | "B";
  /** The failing criteria that put the trial in tier B. */
  hardFailures: CriterionLabel[];
  /** `notExcluded` = exclusions the answers clear (shown as "looks met" next to `met`). */
  counts: { met: number; notMet: number; excluded: number; notExcluded: number; unknown: number; notApplicable: number };
  /** Position from retrieval before re-ranking, 1-based. */
  retrievalRank: number;
  /** True when no real LLM answered and labels are resolver-only. */
  degraded: boolean;
}

/** One trial's criterion verdicts and score, as the results UI reads them. */
export interface TrialCriteriaResult {
  score: TrialMatchScore;
  /** Merged labels in the trial's criterion order (resolver first, LLM fills its unknowns). */
  labels: CriterionLabel[];
}

/** Criteria-based ranking of a search's results. */
export interface CriteriaRanking {
  /** "pending": resolver-only labels while the LLM judge runs; "ok": judge answered (or nothing needed judging). */
  status: "pending" | "ok" | "degraded";
  /** True when no real LLM answered: labels are resolver-only (show the degraded-mode banner). */
  degraded: boolean;
  /** Provider that actually answered the judge, or null. */
  provider: string | null;
  degradedReason?: "ai_unavailable" | "rate_limited" | "budget_exhausted" | "invalid_output";
  /** Trial ids in final order: tier A (incScore, then retrieval rank), then tier B. */
  order: string[];
  byTrial: Record<string, TrialCriteriaResult>;
  /**
   * Question id -> number of unknown criterion items (across these trials) a definite answer to it could settle.
   * Only questions the patient answered "not sure", skipped or deferred: use it to sort the Find-out list.
   */
  findOutPriority: Record<string, number>;
}
