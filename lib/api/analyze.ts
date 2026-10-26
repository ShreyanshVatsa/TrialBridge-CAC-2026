import { AnalyzeResponseSchema, ApiErrorSchema, type AnalyzeRequest, type AnalyzeResponse } from "@/lib/types/analysis";
import type { IntakeAnswers } from "@/lib/types/intake";
import { minimizeProfile } from "@/lib/privacy/minimize";

/** API base: same origin in production; overridable for local dev (Next dev + wrangler dev). */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
/** Above the Worker's ANALYZE.deadlineMs (85 s), which may wait out a free-tier per-minute limit. */
const TIMEOUT_MS = 95_000;

function degraded(reason: NonNullable<AnalyzeResponse["degradedReason"]>, language: IntakeAnswers["language"]): AnalyzeResponse {
  return { status: "degraded", provider: null, results: [], experimental: language === "ht", cached: false, degradedReason: reason };
}

/**
 * Request AI analysis for up to 15 trials. Only the minimized profile + NCT IDs + Turnstile token
 * are sent (never ZIP, exact age, or free text). Never throws for AI/network problems: returns a
 * degraded response so the UI can show retrieval + rule-based results instead.
 */
export async function requestAnalysis(answers: IntakeAnswers, nctIds: string[], turnstileToken: string, opts: { signal?: AbortSignal } = {}): Promise<AnalyzeResponse> {
  const body: AnalyzeRequest = { profile: minimizeProfile(answers), nctIds: nctIds.slice(0, 15), turnstileToken };
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  try {
    const res = await fetch(`${API_BASE}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
      credentials: "same-origin",
    });
    const json: unknown = await res.json().catch(() => null);
    if (res.ok) {
      const parsed = AnalyzeResponseSchema.safeParse(json);
      return parsed.success ? parsed.data : degraded("invalid_output", answers.language);
    }
    const err = ApiErrorSchema.safeParse(json);
    if (err.success && err.data.error.code === "rate_limited") return degraded("rate_limited", answers.language);
    return degraded("ai_unavailable", answers.language);
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    return degraded("ai_unavailable", answers.language);
  }
}
