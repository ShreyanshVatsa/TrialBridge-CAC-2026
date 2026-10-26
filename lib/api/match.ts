import { ApiErrorSchema } from "@/lib/types/analysis";
import { MatchResponseSchema, type MatchRequest, type MatchResponse } from "@/lib/types/match-judge";
import type { IntakeAnswers } from "@/lib/types/intake";
import { minimizeProfile } from "@/lib/privacy/minimize";
import { MATCH_JUDGE } from "@/config/match-judge";
import { API_BASE } from "./analyze";

const TIMEOUT_MS = 60_000;

export interface UnknownCriteria {
  nctId: string;
  criteriaVersion: number;
  /** Criterion ids (I1.., E1..) the deterministic resolver left unknown. */
  unknownIds: string[];
}

function degraded(reason: NonNullable<MatchResponse["degradedReason"]>): MatchResponse {
  return { status: "degraded", provider: null, results: [], cachedIds: [], skippedIds: [], degradedReason: reason };
}

/**
 * Ask the criterion judge (POST /api/match) about the unknown criteria of the top N trials. Sends only the minimized
 * profile, NCT ids, criterion ids and the Turnstile token. Never throws for AI/network problems: returns a degraded
 * response so the UI keeps the resolver's labels.
 */
export async function requestCriteriaJudgement(answers: IntakeAnswers, trials: readonly UnknownCriteria[], turnstileToken: string, opts: { signal?: AbortSignal } = {}): Promise<MatchResponse> {
  const body: MatchRequest = {
    profile: minimizeProfile(answers),
    trials: trials.slice(0, MATCH_JUDGE.topN).map((t) => ({ nctId: t.nctId, criteriaVersion: t.criteriaVersion, unknownIds: t.unknownIds.slice(0, MATCH_JUDGE.maxItemsPerTrial) })),
    turnstileToken,
  };
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  try {
    const res = await fetch(`${API_BASE}/api/match`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal, credentials: "same-origin" });
    const json: unknown = await res.json().catch(() => null);
    if (res.ok) {
      const parsed = MatchResponseSchema.safeParse(json);
      return parsed.success ? parsed.data : degraded("invalid_output");
    }
    const err = ApiErrorSchema.safeParse(json);
    return degraded(err.success && err.data.error.code === "rate_limited" ? "rate_limited" : "ai_unavailable");
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    return degraded("ai_unavailable");
  }
}
