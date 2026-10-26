/**
 * Score fusion: the final ranking score is a weighted sum of named features. The default weights reproduce the
 * original hand-set formula in score.ts exactly for the original features (retrieval, penalty, bonus, phase, fit), and
 * add weights for the structured features (subtype, markers, lines) added later. `FUSION_WEIGHTS` is the shipped set (fusion-weights.json);
 * it can be refit offline with scripts/eval/fit-fusion.ts, which only ever reads the dev split of the vignette benchmark.
 *
 * Every feature is non-negative and computed from the patient's definite answers only: a non-response contributes 0 to
 * every feature, so "unknown never lowers rank" holds by construction.
 */
import type { FitLevel } from "@/lib/types/analysis";
import { FIT_ADJUSTMENT } from "./score";
import SHIPPED from "./fusion-weights.json";

export interface Features {
  /** Normalized RRF of BM25 and cosine, 0..1. */
  retrieval: number;
  /** The two retrieval signals on their own, each 0..1: keyword RRF term and vector RRF term (1 at rank 1). */
  kw: number;
  vec: number;
  /** Raw cosine of the profile and trial embeddings (clamped at 0), and BM25 relative to the best candidate. */
  cosine: number;
  bm25: number;
  /** precheckPenalty(notes), >= 0 (already per-family weighted in score.ts). */
  penalty: number;
  /** precheckBonus(notes), >= 0. */
  bonus: number;
  /** Phase preference nudge (signed). */
  phase: number;
  /** 1 when the patient's subtype matches a histology the trial registers, else 0. */
  subtypeMatch: number;
  /** 1 when the trial registers only histologies the patient does not have, else 0. */
  subtypeConflict: number;
  /** 1 when the trial is a solid-tumor basket trial that applies to the patient's group only through the basket. */
  basket: number;
  /** 1 when the group was assigned to the trial from MeSH/keywords only: no condition or title names it (see groupNamed). */
  weakGroup: number;
  /** 1 when the trial's own title/conditions name only an extent the patient's definite `spread` answer contradicts (extent.ts). */
  extentConflict: number;
}

export type FusionWeights = Readonly<Record<keyof Features, number>>;


export const FUSION_WEIGHTS: FusionWeights = SHIPPED.weights as FusionWeights;

/** Weighted sum of features plus the AI fit adjustment (unchanged from score.ts). */
export function fusedScore(f: Features, fit: FitLevel | null = null, w: FusionWeights = FUSION_WEIGHTS): number {
  let s = 0;
  for (const k of Object.keys(w) as (keyof Features)[]) s += w[k] * (f[k] ?? 0);
  return s + (fit ? FIT_ADJUSTMENT[fit] : 0);
}
