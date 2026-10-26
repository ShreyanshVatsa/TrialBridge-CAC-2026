/**
 * Criterion judge: the LLM labels, one by one, the criterion items the deterministic resolver left
 * "unknown" for the top N trials. Prompt: prompts/analyze-v3.ts (TrialGPT port). Output: TrialCriteriaLabels with
 * source "llm" (or "default" for items the model skipped). The explanation endpoint (/api/analyze) stays as it is for fallback.
 *
 * Same guard rails as /api/analyze: same-origin, Turnstile, per-IP rate limit, daily per-provider budget reserved
 * before every request, circuit breaker and failover (Groq, then Cerebras when its key and data terms are set,
 * then the mock). Results are cached per trial.
 */
import type { SplitCriterion } from "@/lib/ingest/criteria-split";
import type { MinimizedProfile } from "@/lib/types/analysis";
import type { TrialCriteriaLabels } from "@/lib/types/criteria";
import { MatchRequestSchema, type MatchResponse } from "@/lib/types/match-judge";
import { MATCH_JUDGE } from "@/config/match-judge";
import { MATCH_PROMPT_VERSION, MATCH_SYSTEM_PROMPT, buildMatchUserPrompt, numberAnswers, renderTrialBlock, type MatchPromptTrial, type NumberedAnswer } from "@/prompts/analyze-v3";
import type { AnalyzeDeps } from "./analyze";
import { ANALYSIS_TTL_SECONDS } from "./cache";
import { sha256Hex, stableStringify } from "./crypto";
import { apiError, devCorsHeaders, isSameOrigin, json, readJsonBody } from "./http";
import { checkRateLimit, hashIp } from "./ratelimit";
import { estimateTokens, tryConsumeBudget, tryConsumeTokens } from "./budget";
import { dailyBudget, dailyTokenBudget } from "./ai/providers";
import { BudgetExhaustedError, runWithFailover, type FailoverDeps, type FailoverResult, type Reserve } from "./ai/failover";
import { MISSING_REASON, validateMatchOutput, type ValidatedTrial } from "./ai/match-output";
import { ProviderError, type AiProvider, type ChatMessage } from "./ai/types";

/** Input contract: per trial, the criterion items the resolver left unknown (plus optional title/summary context). */
export interface JudgeTrialInput {
  trialId: string;
  criteriaVersion: number;
  items: readonly SplitCriterion[];
  title?: string;
  summary?: string;
}

export interface JudgeDeps {
  store: AnalyzeDeps["store"];
  providers: readonly AiProvider[];
  breakerFor: FailoverDeps["breakerFor"];
  consumeBudget: FailoverDeps["consumeBudget"];
  log?: (event: Record<string, string | number>) => void;
  promptVersion?: string;
  /** Overrides MATCH_JUDGE.deadlineMs (tests). */
  deadlineMs?: number;
}

type JudgeOutcome =
  | { ok: true; provider: string | null; results: TrialCriteriaLabels[]; cachedIds: string[] }
  | { ok: false; reason: Extract<FailoverResult<unknown>, { ok: false }>["reason"]; results: TrialCriteriaLabels[]; cachedIds: string[] };

/**
 * Cache key = hash(trialId, criteriaVersion, promptVersion, minimized profile). `contentHash` (hash of the items
 * actually sent: ids + text) is folded in, so a changed trial text or a different unknown set is re-judged.
 */
export async function judgeCacheKey(trialId: string, criteriaVersion: number, promptVersion: string, profile: MinimizedProfile, contentHash = ""): Promise<string> {
  return `mj:${await sha256Hex(stableStringify({ trialId, criteriaVersion, promptVersion, profile, contentHash }))}`;
}

const criteriaContentHash = async (items: readonly SplitCriterion[]) => (await sha256Hex(stableStringify(items))).slice(0, 16);

/** Prompt characters one trial chunk costs. */
export const chunkChars = (t: MatchPromptTrial) => renderTrialBlock(t).length + 2;

/**
 * Pack trials into requests under `maxChars` (fixed prompt overhead included). Trials stay whole when they fit;
 * a trial too big for one request is split into item chunks across requests (never truncated). Order is kept.
 */
export function planBatches(trials: readonly MatchPromptTrial[], maxChars: number, overheadChars: number): MatchPromptTrial[][] {
  const budget = Math.max(1, maxChars - overheadChars);
  const pieces: MatchPromptTrial[] = [];
  for (const t of trials) {
    if (chunkChars(t) <= budget || t.items.length <= 1) {
      pieces.push(t);
      continue;
    }
    let cur: SplitCriterion[] = [];
    for (const item of t.items) {
      const next = [...cur, item];
      if (cur.length > 0 && chunkChars({ ...t, items: next }) > budget) {
        pieces.push({ ...t, items: cur });
        cur = [item];
      } else cur = next;
    }
    if (cur.length) pieces.push({ ...t, items: cur });
  }
  const batches: MatchPromptTrial[][] = [];
  let batch: MatchPromptTrial[] = [];
  let size = 0;
  for (const p of pieces) {
    const c = chunkChars(p);
    if (batch.length > 0 && size + c > budget) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(p);
    size += c;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

/** Merge validated chunks of the same trial back into one result, in the trial's own item order. */
function mergeChunks(input: JudgeTrialInput, chunks: readonly ValidatedTrial[], provider: string, promptVersion: string): TrialCriteriaLabels {
  const byId = new Map(chunks.flatMap((c) => c.labels).map((l) => [l.id, l]));
  const sent = chunks.reduce((s, c) => s + c.sent, 0);
  const judged = chunks.reduce((s, c) => s + c.judged, 0);
  return {
    trialId: input.trialId,
    criteriaVersion: input.criteriaVersion,
    labels: input.items.map((c) => byId.get(c.id)).filter((l) => l !== undefined),
    provider,
    coverage: sent === 0 ? 1 : judged / sent,
    promptVersion,
  };
}

/** Default labels for the items of a batch piece that got no usable answer. */
function unjudged(t: MatchPromptTrial): ValidatedTrial {
  return {
    trialId: t.trialId,
    labels: t.items.map((c) => ({ id: c.id, section: c.section, label: "unknown" as const, source: "default" as const, reason: MISSING_REASON, answerIds: [] })),
    sent: t.items.length,
    judged: 0,
    downgraded: 0,
    dropped: 0,
  };
}

interface JudgeRun {
  results: TrialCriteriaLabels[];
  /** Trials with at least one batch that got no usable answer (kept as unknown, never cached). */
  partialIds: Set<string>;
}

/**
 * One provider attempt over every batch. Batches fail independently: a batch that stays malformed after its re-ask
 * leaves only its own items unknown, and the next batch still runs. Once a batch has succeeded, a deadline, 429,
 * budget or network error stops further batches and the answers so far are kept. The attempt fails (fail over) only
 * when no batch produced a usable answer.
 */
async function judgeWith(provider: AiProvider, answers: readonly NumberedAnswer[], inputs: readonly JudgeTrialInput[], reserve: Reserve, promptVersion: string, deadline: number): Promise<JudgeRun> {
  const answerIds = new Set(answers.map((a) => a.id));
  const prompt: MatchPromptTrial[] = inputs.map((t) => ({ trialId: t.trialId, items: t.items, ...(t.title ? { title: t.title } : {}), ...(t.summary ? { summary: t.summary } : {}) }));
  const overhead = MATCH_SYSTEM_PROMPT.length + buildMatchUserPrompt(answers, []).length;
  const chunks = new Map<string, ValidatedTrial[]>();
  const partialIds = new Set<string>();
  const add = (v: ValidatedTrial) => chunks.set(v.trialId, [...(chunks.get(v.trialId) ?? []), v]);
  const batches = planBatches(prompt, Math.min(provider.maxInputChars, MATCH_JUDGE.maxBatchChars), overhead);
  let succeeded = 0;
  let lastInvalid: unknown = null;
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b] ?? [];
    let validated: ValidatedTrial[] | null = null;
    try {
      validated = await judgeBatch(provider, answers, answerIds, batch, reserve, deadline);
    } catch (err) {
      const invalid = err instanceof ProviderError && err.kind === "invalid_output";
      if (!invalid && succeeded === 0) throw err;
      if (invalid) lastInvalid = err;
      // This batch (and, when the error is not about the output, every later one) stays unknown.
      for (const rest of invalid ? [batch] : batches.slice(b)) for (const t of rest) {
        add(unjudged(t));
        partialIds.add(t.trialId);
      }
      if (!invalid) break;
      continue;
    }
    succeeded++;
    for (const v of validated) add(v);
  }
  if (succeeded === 0 && lastInvalid) throw lastInvalid;
  return { results: inputs.map((t) => mergeChunks(t, chunks.get(t.trialId) ?? [], provider.name, promptVersion)), partialIds };
}

/** One batch, re-asked after malformed or empty output (MATCH_JUDGE.invalidOutputRetries). */
async function judgeBatch(provider: AiProvider, answers: readonly NumberedAnswer[], answerIds: ReadonlySet<string>, batch: MatchPromptTrial[], reserve: Reserve, deadline: number): Promise<ValidatedTrial[]> {
  const messages: ChatMessage[] = [
    { role: "system", content: MATCH_SYSTEM_PROMPT },
    { role: "user", content: buildMatchUserPrompt(answers, batch) },
  ];
  // On the dev run about one in four 16k-char Groq batches came back with a broken shape.
  for (let attempt = 0; ; attempt++) {
    // Batches run one after another and each model call may take up to its own 30 s timeout, so the request as a
    // whole has a deadline: past it no further call starts, and a running call is aborted when it passes.
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ProviderError("timeout", `${provider.name}: judge deadline`);
    await reserve(estimateTokens(messages.reduce((s, m) => s + m.content.length, 0)) + MATCH_JUDGE.maxTokens);
    const raw = await provider.complete({ messages, trials: [], match: { trials: batch }, maxTokens: MATCH_JUDGE.maxTokens, reasoningEffort: MATCH_JUDGE.reasoningEffort, signal: AbortSignal.timeout(remaining) });
    try {
      const v = validateMatchOutput(raw, batch, answerIds);
      const sent = v.reduce((s, x) => s + x.sent, 0);
      if (sent > 0 && v.every((x) => x.judged === 0)) throw new ProviderError("invalid_output", "no criterion judged");
      return v;
    } catch (err) {
      if (!(err instanceof ProviderError && err.kind === "invalid_output") || attempt >= MATCH_JUDGE.invalidOutputRetries) throw err;
    }
  }
}

/**
 * Judge the unknown criteria of up to MATCH_JUDGE.topN trials. Cached trials are served from the cache; the rest go
 * to the model in batches. Trials with nothing to judge come back with no labels and coverage 1, without a model call.
 * Mock results are never cached (they would hide real judgments once a provider is configured).
 */
export async function judgeCriteria(profile: MinimizedProfile, inputs: readonly JudgeTrialInput[], deps: JudgeDeps): Promise<JudgeOutcome> {
  const promptVersion = deps.promptVersion ?? MATCH_PROMPT_VERSION;
  const list = inputs.slice(0, MATCH_JUDGE.topN);
  const results = new Map<string, TrialCriteriaLabels>();
  const cachedIds: string[] = [];
  const keys = new Map<string, string>();
  const todo: JudgeTrialInput[] = [];
  for (const t of list) {
    if (t.items.length === 0) {
      results.set(t.trialId, { trialId: t.trialId, criteriaVersion: t.criteriaVersion, labels: [], provider: null, coverage: 1, promptVersion });
      continue;
    }
    const key = await judgeCacheKey(t.trialId, t.criteriaVersion, promptVersion, profile, await criteriaContentHash(t.items));
    keys.set(t.trialId, key);
    const hit = await deps.store.get(key);
    if (hit) {
      results.set(t.trialId, JSON.parse(hit) as TrialCriteriaLabels);
      cachedIds.push(t.trialId);
    } else todo.push(t);
  }
  const ordered = () => list.map((t) => results.get(t.trialId)).filter((r) => r !== undefined);
  if (todo.length === 0) return { ok: true, provider: [...results.values()].find((r) => r.provider)?.provider ?? null, results: ordered(), cachedIds };

  const answers = numberAnswers(profile);
  const deadline = Date.now() + (deps.deadlineMs ?? MATCH_JUDGE.deadlineMs);
  const outcome = await runWithFailover(
    deps.providers,
    async (p, reserve) => {
      // Past the deadline the next provider is skipped without counting against its circuit breaker.
      if (Date.now() >= deadline) throw new BudgetExhaustedError();
      return judgeWith(p, answers, todo, reserve, promptVersion, deadline);
    },
    {
      breakerFor: deps.breakerFor,
      consumeBudget: deps.consumeBudget,
      log: (e) => deps.log?.({ route: "match", ...e }),
    },
  );
  if (!outcome.ok) return { ok: false, reason: outcome.reason, results: ordered(), cachedIds };
  const isMock = deps.providers.find((p) => p.name === outcome.provider)?.isMock ?? false;
  const { partialIds } = outcome.value;
  if (partialIds.size > 0) deps.log?.({ route: "match", provider: outcome.provider, status: "partial", trials: partialIds.size });
  for (const r of outcome.value.results) {
    results.set(r.trialId, r);
    const key = keys.get(r.trialId);
    if (key && !isMock && !partialIds.has(r.trialId)) await deps.store.put(key, JSON.stringify(r), ANALYSIS_TTL_SECONDS);
  }
  return { ok: true, provider: outcome.provider, results: ordered(), cachedIds };
}

/** POST /api/match: body {profile, trials:[{nctId, criteriaVersion, unknownIds}], turnstileToken}. */
export async function handleMatch(request: Request, deps: AnalyzeDeps): Promise<Response> {
  const { env, requestId } = deps;
  const cors = devCorsHeaders(request, env);
  if (request.method !== "POST") return apiError("method_not_allowed", requestId, cors);
  if (!isSameOrigin(request, env)) return apiError("forbidden_origin", requestId);

  const body = await readJsonBody(request);
  if (body === null) return apiError("payload_too_large", requestId, cors);
  const parsed = MatchRequestSchema.safeParse(body);
  if (!parsed.success) return apiError("bad_request", requestId, cors);
  const { profile, trials: wanted, turnstileToken } = parsed.data;

  const ip = request.headers.get("CF-Connecting-IP");
  if (!(await deps.verifyTurnstile(turnstileToken, ip))) return apiError("turnstile_failed", requestId, cors);
  const rl = await checkRateLimit(deps.store, "match", await hashIp(ip ?? "unknown", deps.salt));
  if (!rl.allowed) return apiError("rate_limited", requestId, { ...cors, "Retry-After": String(rl.retryAfter) });

  // Criterion text comes from the server's own copy; the browser only names ids. Unknown ids are ignored.
  const seen = new Set<string>();
  const dedup = wanted.filter((w) => !seen.has(w.nctId) && seen.add(w.nctId));
  const stored = new Map((await deps.trials.getTrials(dedup.map((w) => w.nctId))).map((t) => [t.id, t]));
  const inputs: JudgeTrialInput[] = [];
  const skippedIds: string[] = [];
  for (const w of dedup) {
    const t = stored.get(w.nctId);
    if (!t?.criteria || t.criteriaVersion !== w.criteriaVersion) {
      skippedIds.push(w.nctId);
      continue;
    }
    const ids = new Set(w.unknownIds);
    inputs.push({ trialId: t.id, criteriaVersion: t.criteriaVersion, title: t.title, summary: t.summary, items: t.criteria.filter((c) => ids.has(c.id)) });
  }

  const outcome = await judgeCriteria(profile, inputs, {
    store: deps.store,
    providers: deps.providers,
    breakerFor: deps.breakerFor,
    consumeBudget: async (p, tokens = 0) => (await tryConsumeBudget(deps.store, p.name, dailyBudget(env, p.name))) && tryConsumeTokens(deps.store, p.name, tokens, dailyTokenBudget(env, p.name)),
    log: (e) => deps.log({ requestId, ...e }),
  });
  const res: MatchResponse = outcome.ok
    ? { status: "ok", provider: outcome.provider, results: outcome.results, cachedIds: outcome.cachedIds, skippedIds }
    : { status: "degraded", provider: null, results: outcome.results, cachedIds: outcome.cachedIds, skippedIds, degradedReason: outcome.reason };
  return json(res, 200, requestId, cors);
}
