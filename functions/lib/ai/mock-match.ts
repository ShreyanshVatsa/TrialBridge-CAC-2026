import type { MatchPromptTrial } from "@/prompts/analyze-v3";

/**
 * Deterministic mock for the criterion judge: it cannot read criteria, so every item it is sent comes back
 * "unknown" with no citations. Honest by construction: the mock never claims a criterion is met or not met.
 */
export function mockMatch(trials: readonly MatchPromptTrial[]): { trials: { trialId: string; items: { id: string; label: "unknown"; reason: string; answerIds: string[] }[] }[] } {
  return {
    trials: trials.map((t) => ({
      trialId: t.trialId,
      items: t.items.map((c) => ({ id: c.id, label: "unknown" as const, reason: "AI review is offline, so this was not checked.", answerIds: [] })),
    })),
  };
}
