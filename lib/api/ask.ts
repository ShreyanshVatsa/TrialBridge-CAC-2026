import { ApiErrorSchema } from "@/lib/types/analysis";
import { AskResponseSchema, MAX_QUESTION_CHARS, MAX_QUESTIONS_PER_TRIAL, type AskResponse } from "@/lib/types/ask";
import type { Language } from "@/lib/types/intake";
import { scrubPersonalInfo } from "@/lib/privacy/scrub";
import { API_BASE } from "./analyze";
import { detectCrisisLocal, localCrisisResponse } from "./crisis";

export { MAX_QUESTION_CHARS, MAX_QUESTIONS_PER_TRIAL, scrubPersonalInfo };

const TIMEOUT_MS = 30_000;
/** Per-session (in-memory) question counts per trial; reset on page reload. */
const asked = new Map<string, number>();

export function questionsRemaining(nctId: string): number {
  return Math.max(0, MAX_QUESTIONS_PER_TRIAL - (asked.get(nctId) ?? 0));
}
export function resetQuestionCountsForTests(): void {
  asked.clear();
}

function degraded(reason: NonNullable<AskResponse["degradedReason"]>, language: Language, piiRemoved = false): AskResponse {
  return { status: "degraded", kind: null, answer: "", citations: [], crisis: false, piiRemoved, experimental: language === "ht", cached: false, provider: null, degradedReason: reason };
}

/**
 * Ask a question about one trial. Personal info is scrubbed in the browser before sending (and
 * again on the server). Enforces 10 answered questions per trial per session (failed/degraded requests don't count). Never throws for network/AI
 * failures: returns `status: "degraded"` with a reason ("question_limit" when the session limit
 * is reached). Show crisis resources when `crisis` is true.
 */
export async function askQuestion(nctId: string, question: string, language: Language, turnstileToken: string, opts: { signal?: AbortSignal } = {}): Promise<AskResponse> {
  // Crisis resources never depend on the network or the question limit.
  if (detectCrisisLocal(question)) return localCrisisResponse();
  if (questionsRemaining(nctId) <= 0) return degraded("question_limit", language);
  const scrub = scrubPersonalInfo(question.slice(0, MAX_QUESTION_CHARS));
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  try {
    const res = await fetch(`${API_BASE}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nctId, question: scrub.text, language, turnstileToken }),
      signal,
      credentials: "same-origin",
    });
    const json: unknown = await res.json().catch(() => null);
    if (res.ok) {
      const parsed = AskResponseSchema.safeParse(json);
      if (!parsed.success) return degraded("invalid_output", language, scrub.removed > 0);
      // Only an answered question uses one of the 10 (failed or degraded requests are free).
      if (parsed.data.status === "ok") asked.set(nctId, (asked.get(nctId) ?? 0) + 1);
      return scrub.removed > 0 ? { ...parsed.data, piiRemoved: true } : parsed.data;
    }
    const err = ApiErrorSchema.safeParse(json);
    return degraded(err.success && err.data.error.code === "rate_limited" ? "rate_limited" : "ai_unavailable", language, scrub.removed > 0);
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    return degraded("ai_unavailable", language, scrub.removed > 0);
  }
}
