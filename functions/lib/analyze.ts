import { AnalyzeRequestSchema, type AnalyzeResponse, type MinimizedProfile, type TrialAnalysis } from "@/lib/types/analysis";
import { isAiExperimental } from "@/lib/i18n/ai-language";
import { ANALYZE_PROMPT_VERSION, ANALYZE_SYSTEM_PROMPT, buildAnalyzeUserPrompt, buildRepairPrompt } from "@/prompts/analyze-v2";
import type { Env } from "./env";
import { apiError, devCorsHeaders, isSameOrigin, json, readJsonBody } from "./http";
import type { KvStore } from "./store";
import type { ServerTrial, TrialStore } from "./trials";
import { ANALYSIS_TTL_SECONDS, analysisCacheKey } from "./cache";
import { checkRateLimit, hashIp } from "./ratelimit";
import { sha256Hex, stableStringify } from "./crypto";
import { estimateTokens, tryConsumeBudget, tryConsumeTokens } from "./budget";
import { verifyQuotes } from "./quotes";
import { parseModelOutput } from "./ai/output";
import { NEUTRAL_NOTE, violatesWording } from "./safety";
import { runWithFailover, type FailoverDeps, type Reserve } from "./ai/failover";
import { ProviderError, type AiProvider, type ChatMessage } from "./ai/types";
import { dailyBudget, dailyTokenBudget } from "./ai/providers";

/** If more than this share of quotes fail verification, retry once with a repair prompt. */
const MAX_QUOTE_FAILURE_RATE = 0.5;

/**
 * Sizing for one explanation request. Groq's free tier refuses any request whose prompt plus `max_tokens` is over 8000
 * tokens per minute (HTTP 413, measured live), so a request covers at most `maxTrials` trials with each trial's
 * criteria cut to `criteriaChars`; quotes are still verified against the full stored text.
 */
export const ANALYZE = {
  /** Trials explained per request (the browser sends the first ones in its final order). */
  maxTrials: 3,
  /** Criteria characters per trial sent to the model (whole criteria, in order, until this is reached). */
  criteriaChars: 2000,
  maxTokens: 3000,
  reasoningEffort: "low",
  /** Whole-request budget for the model calls (the browser gives up at 95 s; the Worker stops first). */
  deadlineMs: 85_000,
} as const;

/** The trial as the model sees it: whole criteria in order until `ANALYZE.criteriaChars` (at least one of each section). */
export function trimForPrompt(t: ServerTrial, limit: number = ANALYZE.criteriaChars): ServerTrial {
  let used = 0;
  const keep = (list: ServerTrial["inclusion"]) =>
    list.filter((c, i) => {
      if (i > 0 && used + c.text.length > limit) return false;
      used += c.text.length;
      return true;
    });
  const inclusion = keep(t.inclusion);
  const exclusion = keep(t.exclusion);
  return { ...t, inclusion, exclusion };
}

export interface AnalyzeDeps {
  env: Env;
  store: KvStore;
  trials: TrialStore;
  providers: AiProvider[];
  breakerFor: FailoverDeps["breakerFor"];
  verifyTurnstile: (token: string, ip: string | null) => Promise<boolean>;
  /** Salt for IP hashing (secret in production). */
  salt: string;
  requestId: string;
  log: (event: Record<string, string | number>) => void;
}

/** Split trials into at most 2 batches so each prompt fits the provider's context budget. */
export function splitBatches(trials: readonly ServerTrial[], maxChars: number, size: (t: ServerTrial) => number): ServerTrial[][] {
  const total = trials.reduce((s, t) => s + size(t), 0);
  if (total <= maxChars || trials.length < 2) return [trials.slice()];
  const mid = Math.ceil(trials.length / 2);
  return [trials.slice(0, mid), trials.slice(mid)];
}

const trialChars = (t: ServerTrial) => t.title.length + [...t.inclusion, ...t.exclusion].reduce((s, c) => s + c.text.length + 6, 0);

/** Replace any model-written text that claims eligibility or advises treatment with a neutral note. */
export function sanitizeAnalysis(a: TrialAnalysis, language: MinimizedProfile["language"]): TrialAnalysis {
  const note = NEUTRAL_NOTE[language];
  const clean = (t: string) => (violatesWording(t) ? note : t);
  return {
    ...a,
    summary: clean(a.summary),
    doctorQuestions: a.doctorQuestions.map(clean),
    criteria: a.criteria.map((c) => ({ ...c, explanation: clean(c.explanation) })),
  };
}

/** One provider attempt over all batches, with quote verification and a single repair retry per batch. */
async function analyzeWith(provider: AiProvider, profile: MinimizedProfile, trials: readonly ServerTrial[], reserve: Reserve, deadline: number): Promise<TrialAnalysis[]> {
  const results: TrialAnalysis[] = [];
  const call = (messages: ChatMessage[], batch: readonly ServerTrial[]) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ProviderError("timeout", `${provider.name}: analyze deadline`);
    return provider.complete({ messages, profile, trials: batch, maxTokens: ANALYZE.maxTokens, reasoningEffort: ANALYZE.reasoningEffort, signal: AbortSignal.timeout(remaining) });
  };
  /** Estimated tokens of one request: its prompt plus the completion cap. */
  const requestTokens = (messages: readonly ChatMessage[]) => estimateTokens(messages.reduce((s, m) => s + m.content.length, 0)) + ANALYZE.maxTokens;
  for (const batch of splitBatches(trials, provider.maxInputChars, trialChars)) {
    const messages: ChatMessage[] = [
      { role: "system", content: ANALYZE_SYSTEM_PROMPT },
      { role: "user", content: buildAnalyzeUserPrompt(profile, profile.language, batch.map((t) => trimForPrompt(t))) },
    ];
    await reserve(requestTokens(messages));
    const raw = await call(messages, batch);
    const repair = async (problem: string) => {
      const retry: ChatMessage[] = [...messages, { role: "assistant", content: raw }, { role: "user", content: buildRepairPrompt(problem) }];
      await reserve(requestTokens(retry));
      return call(retry, batch);
    };
    let analyses: TrialAnalysis[];
    try {
      analyses = parseModelOutput(raw);
    } catch (err) {
      // One re-ask for malformed output (the free model occasionally breaks the JSON shape), then fail over.
      if (!(err instanceof ProviderError) || err.kind !== "invalid_output") throw err;
      analyses = parseModelOutput(await repair("The output was not valid JSON in the required shape."));
    }
    let check = verifyQuotes(analyses, batch);
    if (check.total > 0 && check.failed / check.total > MAX_QUOTE_FAILURE_RATE) {
      const repaired = await repair(`${check.failed} of ${check.total} quotes were not verbatim.`);
      check = verifyQuotes(parseModelOutput(repaired), batch);
      if (check.total > 0 && check.failed / check.total > MAX_QUOTE_FAILURE_RATE) throw new ProviderError("invalid_output", "quote verification failed after repair");
    }
    results.push(...check.analyses.map((a) => sanitizeAnalysis(a, profile.language)));
  }
  return results;
}

/** POST /api/analyze */
export async function handleAnalyze(request: Request, deps: AnalyzeDeps): Promise<Response> {
  const { env, requestId } = deps;
  const cors = devCorsHeaders(request, env);
  if (request.method !== "POST") return apiError("method_not_allowed", requestId, cors);
  if (!isSameOrigin(request, env)) return apiError("forbidden_origin", requestId);

  const body = await readJsonBody(request);
  if (body === null) return apiError("payload_too_large", requestId, cors);
  const parsed = AnalyzeRequestSchema.safeParse(body);
  if (!parsed.success) return apiError("bad_request", requestId, cors);
  const { profile, nctIds, turnstileToken } = parsed.data;

  const ip = request.headers.get("CF-Connecting-IP");
  if (!(await deps.verifyTurnstile(turnstileToken, ip))) return apiError("turnstile_failed", requestId, cors);

  const rl = await checkRateLimit(deps.store, "analyze", await hashIp(ip ?? "unknown", deps.salt));
  if (!rl.allowed) return apiError("rate_limited", requestId, { ...cors, "Retry-After": String(rl.retryAfter) });

  // The first `maxTrials` in the client's order, then sorted: one cache entry per set, whatever order the client sent.
  const ids = [...new Set(nctIds)].slice(0, ANALYZE.maxTrials).sort();
  const trials = await deps.trials.getTrials(ids);
  const experimental = isAiExperimental(profile.language);
  const dataVersion = env.DATA_VERSION ?? "unknown";
  if (trials.length === 0) {
    const empty: AnalyzeResponse = { status: "degraded", provider: null, results: [], experimental, cached: false, degradedReason: "ai_unavailable" };
    return json(empty, 200, requestId, cors);
  }

  // Include a hash of the trials' own text so cached analyses refresh whenever trial data changes.
  const contentHash = (await sha256Hex(stableStringify(trials))).slice(0, 16);
  const cacheKey = await analysisCacheKey(profile, ids, `${dataVersion}:${contentHash}`, ANALYZE_PROMPT_VERSION);
  const hit = await deps.store.get(cacheKey);
  if (hit) {
    const cached = JSON.parse(hit) as { provider: string; results: TrialAnalysis[] };
    const res: AnalyzeResponse = { status: "ok", provider: cached.provider, results: cached.results, experimental, cached: true };
    deps.log({ requestId, route: "analyze", status: "cache_hit" });
    return json(res, 200, requestId, cors);
  }

  const deadline = Date.now() + ANALYZE.deadlineMs;
  const outcome = await runWithFailover(deps.providers, (p, reserve) => analyzeWith(p, profile, trials, reserve, deadline), {
    breakerFor: deps.breakerFor,
    consumeBudget: async (p, tokens = 0) => (await tryConsumeBudget(deps.store, p.name, dailyBudget(env, p.name))) && tryConsumeTokens(deps.store, p.name, tokens, dailyTokenBudget(env, p.name)),
    log: (e) => deps.log({ requestId, route: "analyze", ...e }),
  });

  if (!outcome.ok) {
    const res: AnalyzeResponse = { status: "degraded", provider: null, results: [], experimental, cached: false, degradedReason: outcome.reason };
    return json(res, 200, requestId, cors);
  }
  await deps.store.put(cacheKey, JSON.stringify({ provider: outcome.provider, results: outcome.value }), ANALYSIS_TTL_SECONDS);
  const res: AnalyzeResponse = { status: "ok", provider: outcome.provider, results: outcome.value, experimental, cached: false };
  return json(res, 200, requestId, cors);
}
