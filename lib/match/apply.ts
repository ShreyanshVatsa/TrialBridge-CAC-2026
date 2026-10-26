import type { AnalyzeResponse } from "@/lib/types/analysis";
import type { RankedTrial } from "@/lib/types/match";
import { fusedScore } from "./fusion";
import { finalScore } from "./score";

/**
 * Attach AI analysis to ranked results and re-rank with the AI fit level (lib/match/score.ts).
 * Results without an analysis (or a degraded response) keep their retrieval + rule-based score.
 * Returns a new array; inputs are not mutated.
 */
export function applyAnalysis(results: readonly RankedTrial[], response: AnalyzeResponse): RankedTrial[] {
  const byId = new Map(response.results.map((r) => [r.nctId, r]));
  return results
    .map((r) => {
      const analysis = byId.get(r.card.id) ?? null;
      const fit = analysis?.fitLevel ?? null;
      const final = r.scores.features
        ? fusedScore({ ...r.scores.features, phase: r.scores.phaseBonus ?? 0 }, fit)
        : finalScore({ retrieval: r.scores.retrieval, precheck: r.precheck, fit, phase: r.scores.phaseBonus ?? 0 });
      return { ...r, analysis, scores: { ...r.scores, fit, final } };
    })
    .sort((a, b) => b.scores.final - a.scores.final || a.card.id.localeCompare(b.card.id));
}

