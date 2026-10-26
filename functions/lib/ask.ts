import { AskRequestSchema, type AskResponse } from "@/lib/types/ask";
import { scrubPersonalInfo } from "@/lib/privacy/scrub";
import { isAiExperimental } from "@/lib/i18n/ai-language";
import { ASK_PROMPT_VERSION, ASK_SYSTEM_PROMPT, buildAskUserPrompt } from "@/prompts/ask-v1";
import { apiError, devCorsHeaders, isSameOrigin, json, readJsonBody } from "./http";
import { checkRateLimit, hashIp } from "./ratelimit";
import { sha256Hex, stableStringify, utcDay } from "./crypto";
import { estimateTokens, tryConsumeBudget, tryConsumeTokens } from "./budget";
import { detectCrisis, detectRefusal, SAFE_REPLIES, violatesWording } from "./safety";
import { runWithFailover } from "./ai/failover";
import { dailyBudget, dailyTokenBudget } from "./ai/providers";
import { parseAskOutput, verifyCitations } from "./ai/ask-output";
import type { ChatMessage } from "./ai/types";
import type { AnalyzeDeps } from "./analyze";

/** Q&A answers are cached for 30 days (hash keys only; questions are never stored in plain text). */
const ASK_TTL_SECONDS = 30 * 86_400;
/**
 * Server-side backstop per (IP hash, trial, day). The UI enforces 10 questions per trial per
 * session; this catches clients that bypass it.
 */
const ASK_DAILY_PER_TRIAL = 20;

/** Completion-token cap of one answer (the client's default), also what the daily token budget reserves for it. */
const ASK_MAX_TOKENS = 6000;

type AskDeps = AnalyzeDeps;

/** Lowercase, collapse whitespace, strip trailing punctuation: "Who can JOIN?? " -> "who can join". */
export function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").replace(/[\s?!.¿¡]+$/g, "").replace(/^[\s¿¡]+/, "").trim();
}

/** POST /api/ask */
export async function handleAsk(request: Request, deps: AskDeps): Promise<Response> {
  const { env, requestId } = deps;
  const cors = devCorsHeaders(request, env);
  if (request.method !== "POST") return apiError("method_not_allowed", requestId, cors);
  if (!isSameOrigin(request, env)) return apiError("forbidden_origin", requestId);

  const body = await readJsonBody(request);
  if (body === null) return apiError("payload_too_large", requestId, cors);
  const parsed = AskRequestSchema.safeParse(body);
  if (!parsed.success) return apiError("bad_request", requestId, cors);
  const { nctId, language, turnstileToken } = parsed.data;

  const ip = request.headers.get("CF-Connecting-IP");
  if (!(await deps.verifyTurnstile(turnstileToken, ip))) return apiError("turnstile_failed", requestId, cors);
  const ipHash = await hashIp(ip ?? "unknown", deps.salt);
  const rl = await checkRateLimit(deps.store, "ask", ipHash);
  if (!rl.allowed) return apiError("rate_limited", requestId, { ...cors, "Retry-After": String(rl.retryAfter) });

  const scrub = scrubPersonalInfo(parsed.data.question);
  const question = scrub.text;
  const base: Pick<AskResponse, "piiRemoved" | "experimental" | "cached"> = { piiRemoved: scrub.removed > 0, experimental: isAiExperimental(language), cached: false };
  const reply = (r: Omit<AskResponse, keyof typeof base> & Partial<typeof base>) => json({ ...base, ...r } satisfies AskResponse, 200, requestId, cors);

  // Safety first, deterministically, before any AI call or data lookup.
  if (detectCrisis(question)) {
    deps.log({ requestId, route: "ask", status: "crisis" });
    return reply({ status: "ok", kind: "crisis", answer: SAFE_REPLIES[language].crisis, citations: [], crisis: true, provider: null });
  }
  const refusal = detectRefusal(question);
  if (refusal) return reply({ status: "ok", kind: "refusal", refusalReason: refusal, answer: SAFE_REPLIES[language][refusal], citations: [], crisis: false, provider: null });

  const [trial] = await deps.trials.getTrials([nctId]);
  if (!trial) return apiError("not_found", requestId, cors);

  const perTrial = await deps.store.incr(`askq:${ipHash}:${nctId}:${utcDay()}`, 86_400);
  if (perTrial > ASK_DAILY_PER_TRIAL) return reply({ status: "degraded", kind: null, answer: "", citations: [], crisis: false, provider: null, degradedReason: "question_limit" });

  const contentHash = (await sha256Hex(stableStringify(trial))).slice(0, 16);
  const cacheKey = `ask:${await sha256Hex(stableStringify({ nctId, q: normalizeQuestion(question), language, v: `${env.DATA_VERSION ?? "unknown"}:${contentHash}`, p: ASK_PROMPT_VERSION }))}`;
  const hit = await deps.store.get(cacheKey);
  if (hit) {
    const cached = JSON.parse(hit) as Pick<AskResponse, "kind" | "refusalReason" | "answer" | "citations" | "provider">;
    return reply({ status: "ok", crisis: false, ...cached, cached: true });
  }

  const outcome = await runWithFailover(
    deps.providers,
    async (p, reserve) => {
      const messages: ChatMessage[] = [
        { role: "system", content: ASK_SYSTEM_PROMPT },
        { role: "user", content: buildAskUserPrompt(trial, question, language) },
      ];
      await reserve(estimateTokens(messages.reduce((s, m) => s + m.content.length, 0)) + ASK_MAX_TOKENS);
      const raw = await p.complete({
        messages,
        maxTokens: ASK_MAX_TOKENS,
        trials: [trial],
        ask: { question, language },
      });
      const out = parseAskOutput(raw);
      // Model text must not claim eligibility or advise treatment: replace it with the safe refusal.
      if (violatesWording(out.answer)) return { kind: "refusal" as const, refusalReason: "eligibility" as const, answer: SAFE_REPLIES[language].eligibility, citations: [] };
      const citations = verifyCitations(out.citations, trial);
      // Grounded-only: an "answer" without any verified citation becomes "not in the text".
      if (out.kind === "answer" && citations.length === 0) return { kind: "not_in_text" as const, refusalReason: null, answer: SAFE_REPLIES[language].not_in_text, citations: [] };
      return { ...out, citations };
    },
    {
      breakerFor: deps.breakerFor,
      consumeBudget: async (p, tokens = 0) => (await tryConsumeBudget(deps.store, p.name, dailyBudget(env, p.name))) && tryConsumeTokens(deps.store, p.name, tokens, dailyTokenBudget(env, p.name)),
      log: (e) => deps.log({ requestId, route: "ask", ...e }),
    },
  );
  if (!outcome.ok) return reply({ status: "degraded", kind: null, answer: "", citations: [], crisis: false, provider: null, degradedReason: outcome.reason });

  const v = outcome.value;
  const result = { kind: v.kind, ...(v.refusalReason ? { refusalReason: v.refusalReason } : {}), answer: v.answer, citations: v.citations, provider: outcome.provider };
  await deps.store.put(cacheKey, JSON.stringify(result), ASK_TTL_SECONDS);
  return reply({ status: "ok", crisis: false, ...result });
}
