import type { Site, TrialCard, FactKey, FactValue, CriterionRef } from "./trial";
import type { FitLevel, TrialAnalysis } from "./analysis";
import type { Features } from "@/lib/match/fusion";

/** A note from the rule-based eligibility pre-check (lib/match/precheck.ts). */
export interface PrecheckNote {
  key: FactKey;
  /** conflict = the answer likely conflicts with this criterion; support = the answer likely matches it. */
  kind: "conflict" | "support";
  quote: string;
  ref: CriterionRef;
  /** The trial fact's direction (required/excluded); used for FACT_WEIGHT and the biomarker match bonus. */
  value?: FactValue;
  /** Where the fact came from; LLM facts count in proportion to `confidence` (RELIABILITY). */
  source?: "rule" | "llm";
  confidence?: number;
}

export interface NearestSite {
  site: Site;
  /** Great-circle miles from the user's ZIP centroid; null when coordinates are unavailable. */
  miles: number | null;
}

/** One ranked result produced by `searchTrials` and refined by `applyAnalysis`. */
export interface RankedTrial {
  card: TrialCard;
  sites: Site[];
  nearest: NearestSite | null;
  /** True when the user prefers a non-English language and the trial requires English. */
  languageWarning: boolean;
  precheck: PrecheckNote[];
  scores: {
    /** 1-based ranks; null = not retrieved by that method. */
    keywordRank: number | null;
    vectorRank: number | null;
    rrf: number;
    /** Normalized retrieval relevance 0..1 (RRF / max possible). */
    retrieval: number;
    precheckPenalty: number;
    /** Phase-preference nudge (questionnaire only), ±PHASE_PREF_BONUS or 0. */
    phaseBonus?: number;
    fit: FitLevel | null;
    /** The fusion features the final score is computed from (lib/match/fusion.ts); re-fused when the AI fit arrives. */
    features?: Features;
    /** Directional criteria the patient's answers say nothing about (questionnaire intake only). */
    unknowns?: number;
    final: number;
  };
  analysis: TrialAnalysis | null;
}

/** `checking`: results are in, waiting briefly for the criterion judge and explanations so the list appears once, in its final order. */
export type SearchStage = "loading_shards" | "loading_model" | "filtering" | "ranking" | "checking" | "done";

export interface SearchProgress {
  stage: SearchStage;
  /** 0..1 for downloads, when known. */
  fraction?: number;
}

export interface SearchOutcome {
  results: RankedTrial[];
  /** How many trials passed hard filters. */
  candidateCount: number;
  /** Total trials searched in the loaded shard(s). */
  searchedCount: number;
  /** True if embeddings failed or timed out and ranking fell back to keyword-only. */
  keywordOnly: boolean;
  /** True when a travel limit was set but the ZIP location couldn't be found, so distance was NOT applied. */
  distanceUnavailable?: boolean;
  /** True when the ZIP isn't a known ZIP area, so distances use an approximate centre. */
  zipApproximate?: boolean;
}
