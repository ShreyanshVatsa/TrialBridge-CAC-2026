/**
 * Matching eval on the TREC cancer subset (graded human qrels; 2021 = dev, 2022 = test).
 *
 * Three arms over the same candidate pool (the judged trials of each topic, hard filters applied):
 *   baseline  retrieval pipeline order (BM25 + MiniLM + RRF + rule pre-check + fusion; scripts/eval/trec/pipeline.ts)
 *   resolver  baseline order re-ranked by per-criterion labels from the deterministic resolver only (tiers A/B)
 *   llm       resolver + the LLM judge (functions/lib/match.ts judgeCriteria, Groq) on the unknown items of the top 10
 *
 * Metrics per topic (patient), then mean with a bootstrap 95% CI over topics (scripts/eval/stats.ts):
 *   nDCG@10 (graded 0/1/2), P@10 (share of the top 10 judged eligible, grade 2),
 *   missed exclusions (share of the top 10 that is TREC "excluded", grade 1, and still Tier A; baseline has no tiers,
 *   so every shown trial counts as Tier A), unknown share (unknown labels / all labels in the top 10 trials),
 *   LLM JSON validity (completions that parse as the judge's JSON shape) and coverage (items judged / items sent),
 *   latency (model time, sum of successful calls) and tokens per patient (Groq `usage.total_tokens`).
 *
 * Every Groq HTTP response is cached on disk (data/cache/matching-llm/<sha256 of request body>.json) with its latency
 * and usage, so a run resumes after the free-tier daily token cap: re-run the same command, or add `--wait` to sleep
 * through the rolling quota (same pattern as scripts/i18n/translate.ts). Without --wait a daily-cap 429 stops LLM calls;
 * topics without a complete LLM run are reported as not covered (never imputed).
 *
 * Usage: npm run eval:matching -- [--split=dev|test] [--no-llm] [--cache-only] [--wait] [--dry] [--topics=k1,k2] [--report (rewrite RESULTS.md only)]
 * The test split may run once (eval/matching/test-runs.json records it); a second run needs --allow-test-rerun.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AI_PROVIDERS } from "../../../config/ai-providers";
import { getCatalog } from "../../../config/questionnaire";
import { MATCH_JUDGE } from "../../../config/match-judge";
import { createOpenAiCompatibleProvider } from "../../../functions/lib/ai/openai-client";
import { CircuitBreaker } from "../../../functions/lib/ai/circuit";
import { parseMatchJson } from "../../../functions/lib/ai/match-output";
import { MemoryKvStore } from "../../../functions/lib/store";
import { judgeCriteria, planBatches, type JudgeTrialInput } from "../../../functions/lib/match";
import { FUSION_WEIGHTS } from "../../../lib/match/fusion";
import { judgeRequests, rankingFromJudge, resolverLabels } from "../../../lib/match/criteria-rank";
import { TOP_N, rankByCriteria } from "../../../lib/match/rank";
import { minimizeProfile } from "../../../lib/privacy/minimize";
import { toIntakeAnswers } from "../../../lib/questionnaire/adapter";
import type { CriterionLabel } from "../../../lib/types/criteria";
import type { MatchResponse } from "../../../lib/types/match-judge";
import type { TrialCard } from "../../../lib/types/trial";
import { MATCH_SYSTEM_PROMPT, buildMatchUserPrompt, numberAnswers } from "../../../prompts/analyze-v3";
import { ndcgAt, rankIds } from "../fusion-fit";
import { bootstrapCI, fmtCI, fmtDiff, pairedBootstrapCI, type CI } from "../stats";
import { loadTrec } from "../trec/load";
import { REPO_ROOT } from "../trec/paths";
import { topicState, trecQueries } from "../trec/pipeline";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const SPLIT = (opt("split") ?? "dev") as "dev" | "test";
if (SPLIT !== "dev" && SPLIT !== "test") throw new Error("--split must be dev or test");
/** test = TREC 2022 (2 topics) + TREC 2023 breast-cancer templates (5 topics), held out from all tuning. */
const YEARS: readonly number[] = SPLIT === "dev" ? [2021] : [2022, 2023];
const SPLIT_LABEL: Record<"dev" | "test", string> = { dev: "TREC 2021", test: "TREC 2022 + 2023" };
const WAIT = flag("wait");
const NO_LLM = flag("no-llm");
const DRY = flag("dry");
/** Replay the disk cache only: a request with no cached response fails like a daily-cap stop (no Groq call is made). */
const CACHE_ONLY = flag("cache-only");
/** Only these topic keys (comma-separated), for smoke runs; the reported numbers always come from full runs. */
const ONLY = opt("topics")?.split(",");
/** How many retrieved results the criteria ranking reorders: production passes rankTrials' TOP_N (15). */
const POOL = Number(opt("pool") ?? TOP_N);
const OUT_DIR = path.join(REPO_ROOT, "eval/matching");
const CACHE_DIR = path.join(REPO_ROOT, "data/cache/matching-llm");
/**
 * Request size for the eval. Groq's free tier caps one request at 8000 tokens per minute (prompt + max_tokens), so the
 * old 60k-char production batch could not be sent there. Batches are planned with this smaller cap (planBatches still
 * keeps trials whole when they fit and never truncates); the prompt text itself is unchanged.
 */
const EVAL_MAX_INPUT_CHARS = Number(opt("max-chars") ?? 16000);
/** Completion cap sent to Groq for the same reason (production now uses the same values, config/match-judge.ts). */
const EVAL_MAX_TOKENS = Number(opt("max-tokens") ?? 3500);
const REASONING = opt("reasoning") ?? "low";

// ---------------------------------------------------------------------------------------------
// Groq access: key from env or .dev.vars (never printed), pacing, disk cache, --wait.
// ---------------------------------------------------------------------------------------------

function devVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const m = readFileSync(path.join(REPO_ROOT, ".dev.vars"), "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
    const v = (m?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
    return v || undefined;
  } catch {
    return undefined;
  }
}

class DailyLimitError extends Error {}
let dailyLimitHit = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_RPM = 20;
const MAX_TPM = 7000;
const window: { t: number; tokens: number }[] = [];
async function pace(est: number): Promise<{ t: number; tokens: number }> {
  for (;;) {
    const now = Date.now();
    while (window.length && now - (window[0] as { t: number }).t > 60_000) window.shift();
    const used = window.reduce((a, w) => a + w.tokens, 0);
    if (window.length === 0 || (window.length < MAX_RPM && used + est <= MAX_TPM)) {
      const slot = { t: now, tokens: est };
      window.push(slot);
      return slot;
    }
    await sleep(Math.max(250, 60_000 - (now - (window[0] as { t: number }).t) + 50));
  }
}

interface CallRecord {
  ms: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  cached: boolean;
  valid: boolean;
}
interface CacheEntry {
  status: number;
  body: string;
  ms: number;
  at: string;
}

/** Per-topic call log, filled by the fetch wrapper. */
let calls: CallRecord[] = [];

function record(entry: CacheEntry, cached: boolean) {
  let tokens = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let valid = false;
  try {
    const j = JSON.parse(entry.body) as { usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number }; choices?: { message?: { content?: string } }[] };
    tokens = j.usage?.total_tokens ?? 0;
    promptTokens = j.usage?.prompt_tokens ?? 0;
    completionTokens = j.usage?.completion_tokens ?? 0;
    try {
      parseMatchJson(j.choices?.[0]?.message?.content ?? "");
      valid = true;
    } catch {}
  } catch {}
  calls.push({ ms: entry.ms, tokens, promptTokens, completionTokens, cached, valid });
}

function groqFetch(): typeof fetch {
  mkdirSync(CACHE_DIR, { recursive: true });
  const seen = new Map<string, number>();
  const inner = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    body.max_tokens = EVAL_MAX_TOKENS;
    // gpt-oss defaults to medium reasoning, which spent 3077 of 3500 completion tokens on reasoning in the first
    // probe and truncated the JSON. Low effort keeps a request inside the free-tier per-minute cap.
    body.reasoning_effort = REASONING;
    const payload = JSON.stringify(body);
    // The nth identical request of a run (a re-ask after malformed output) gets its own entry, so a resumed run
    // replays the same sequence instead of serving the broken first answer twice.
    const hash = createHash("sha256").update(`${url}\n${payload}`).digest("hex");
    const nth = seen.get(hash) ?? 0;
    seen.set(hash, nth + 1);
    const file = path.join(CACHE_DIR, `${hash}-${nth}.json`);
    if (existsSync(file)) {
      const hit = JSON.parse(readFileSync(file, "utf8")) as CacheEntry;
      record(hit, true);
      return new Response(hit.body, { status: hit.status, headers: { "content-type": "application/json" } });
    }
    if (dailyLimitHit || CACHE_ONLY) throw new DailyLimitError(CACHE_ONLY ? "not in cache (--cache-only)" : "daily quota reached");
    const est = Math.ceil(payload.length / 3.5) + EVAL_MAX_TOKENS;
    for (let attempt = 0; ; attempt++) {
      const slot = await pace(Math.min(MAX_TPM, est));
      const t0 = Date.now();
      // The client's 30 s signal is not passed on: pacing waits happen here. The model call gets its own timeout.
      const { signal: _ignored, ...rest } = init;
      void _ignored;
      let res: Response;
      try {
        res = await fetch(url, { ...rest, body: payload, signal: AbortSignal.timeout(120_000) });
      } catch (err) {
        if (attempt < 4) {
          await sleep(5000);
          continue;
        }
        throw err;
      }
      const ms = Date.now() - t0;
      if (res.ok) {
        const text = await res.text();
        const entry: CacheEntry = { status: res.status, body: text, ms, at: new Date().toISOString() };
        writeFileSync(file, JSON.stringify(entry));
        record(entry, false);
        try {
          const t = (JSON.parse(text) as { usage?: { total_tokens?: number } }).usage?.total_tokens;
          if (t) slot.tokens = t;
        } catch {}
        return new Response(text, { status: res.status, headers: { "content-type": "application/json" } });
      }
      if ((res.status === 429 || res.status >= 500) && attempt < (WAIT ? 500 : 6)) {
        const ra = Number(res.headers.get("retry-after"));
        if (res.status === 429 && ra > 300 && !WAIT) {
          try {
            const msg = ((await res.clone().json()) as { error?: { message?: string } }).error?.message ?? "";
            console.warn(`\nGroq 429 (daily quota): ${msg.slice(0, 200)}`);
          } catch {}
          dailyLimitHit = true;
          throw new DailyLimitError(`retry-after ${Math.round(ra)} s`);
        }
        const backoff = Math.min(60_000, 2000 * 2 ** attempt) * (0.5 + Math.random() * 0.5);
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 + Math.random() * 500 : backoff);
        continue;
      }
      if (res.status === 413 || res.status === 400) {
        try {
          console.warn(`\nGroq ${res.status}: ${(((await res.clone().json()) as { error?: { message?: string } }).error?.message ?? "").slice(0, 200)}`);
        } catch {}
      }
      if (!res.ok) console.warn(`\nGroq HTTP ${res.status}`);
      return res;
    }
  }) as (url: string, init: RequestInit) => Promise<Response>;
  return (async (url: string, init: RequestInit) => {
    try {
      return await inner(url, init);
    } catch (err) {
      if (!(err instanceof DailyLimitError)) console.warn(`\nGroq request failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------------------------

type Arm = "baseline" | "resolver" | "llm" | "resolverFull";
const ARMS: Arm[] = ["baseline", "resolver", "llm", "resolverFull"];

interface ArmMetrics {
  ndcg10: number;
  p10: number;
  missedExclusions: number;
  /** null for the baseline (no per-criterion labels). */
  unknownShare: number | null;
  top10: { id: string; grade: number; tier: "A" | "B" | null }[];
  /** For Tier B trials in the top 10, the failing criterion ids with label, source and reason (error analysis). */
  hardFailures?: { id: string; grade: number; items: { id: string; label: string; source: string; reason?: string }[] }[];
}

interface LlmTopic {
  status: "ok" | "degraded" | "quota" | "not_run";
  degradedReason?: string;
  trialsSent: number;
  itemsSent: number;
  itemsJudged: number;
  calls: number;
  validCalls: number;
  cachedCalls: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  /** Calls slower than the production client's 30 s timeout (would fail over in the app). */
  slowCalls: number;
}

interface TopicOut {
  key: string;
  candidates: number;
  arms: Partial<Record<Arm, ArmMetrics>>;
  llm: LlmTopic;
}

function armMetrics(order: readonly string[], gains: Readonly<Record<string, number>>, labels: Record<string, { labels: CriterionLabel[]; score: { tier: "A" | "B"; hardFailures?: CriterionLabel[] } }> | null): ArmMetrics {
  const top = order.slice(0, 10);
  const n = Math.max(1, top.length);
  const tierOf = (id: string) => (labels ? (labels[id]?.score.tier ?? "A") : null);
  let unknown = 0;
  let total = 0;
  if (labels)
    for (const id of top) {
      for (const l of labels[id]?.labels ?? []) {
        total++;
        if (l.label === "unknown") unknown++;
      }
    }
  return {
    ndcg10: ndcgAt(order, gains, 10),
    p10: top.filter((id) => gains[id] === 2).length / n,
    missedExclusions: top.filter((id) => gains[id] === 1 && (tierOf(id) ?? "A") === "A").length / n,
    unknownShare: labels ? (total ? unknown / total : 0) : null,
    top10: top.map((id) => ({ id, grade: gains[id] ?? 0, tier: tierOf(id) })),
    ...(labels
      ? {
          hardFailures: top
            .filter((id) => tierOf(id) === "B")
            .map((id) => ({ id, grade: gains[id] ?? 0, items: (labels[id]?.score.hardFailures ?? []).map((l) => ({ id: l.id, label: l.label, source: l.source, ...(l.reason ? { reason: l.reason } : {}) })) })),
        }
      : {}),
  };
}

async function main() {
  // A separate log for the current test composition (2022 + 2023); test-runs.json keeps the earlier runs on 2022 alone.
  const testLog = path.join(OUT_DIR, "test-runs-v7.json");
  mkdirSync(OUT_DIR, { recursive: true });
  const priorTestRuns = existsSync(testLog) ? (JSON.parse(readFileSync(testLog, "utf8")) as { runs: { at: string; sha: string; llm: boolean }[] }).runs : [];
  if (SPLIT === "test" && !DRY && priorTestRuns.length > 0 && !flag("allow-test-rerun")) throw new Error(`test split already ran ${priorTestRuns.length}x (${testLog}); pass --allow-test-rerun to run it again`);

  const key = NO_LLM || DRY ? undefined : devVar("GROQ_API_KEY");
  if (!NO_LLM && !DRY && !key) console.warn("GROQ_API_KEY not set: LLM arm skipped");
  const cfg = AI_PROVIDERS.find((p) => p.name === "groq");
  if (!cfg) throw new Error("no groq provider config");
  const groq = key ? { ...createOpenAiCompatibleProvider(cfg, key, groqFetch()), maxInputChars: EVAL_MAX_INPUT_CHARS } : null;

  const bench = loadTrec();
  const cards = new Map<string, TrialCard>(bench.topics.flatMap((t) => t.trials.map((x) => [x.card.id, x.card] as const)));
  const { queries } = await trecQueries();
  const topics = bench.topics.filter((t) => YEARS.includes(t.year) && (!ONLY || ONLY.includes(t.key)));
  const out: TopicOut[] = [];

  for (const t of topics) {
    const q = queries.find((x) => x.id === t.key);
    if (!q) throw new Error(`no query for ${t.key}`);
    const order = rankIds(q, FUSION_WEIGHTS);
    // Production (find-flow) reorders only the results rankTrials returns (TOP_N); the rest keep the retrieval order.
    const all = order.map((id) => ({ card: cards.get(id) as TrialCard }));
    const results = all.slice(0, POOL);
    const tail = order.slice(POOL);
    const state = topicState(t);
    const answers = toIntakeAnswers(state, "en");
    const catalog = getCatalog("cancer", t.answers.group);
    const resolver = resolverLabels(results, answers, catalog);
    const resolverRank = rankByCriteria(results, resolver, null);
    // Exploratory (dev only, not production): the resolver tiering applied to the whole candidate pool.
    const resolverFullRank = rankByCriteria(all, resolverLabels(all, answers, catalog), null);
    const wanted = judgeRequests(results, resolver);
    const inputs: JudgeTrialInput[] = wanted.map((w) => {
      const c = cards.get(w.nctId) as TrialCard;
      const ids = new Set(w.unknownIds.slice(0, MATCH_JUDGE.maxItemsPerTrial));
      return { trialId: c.id, criteriaVersion: w.criteriaVersion, title: c.title, ...(c.summary ? { summary: c.summary } : {}), items: (c.criteria ?? []).filter((x) => ids.has(x.id)) };
    });
    const itemsSent = inputs.reduce((s, x) => s + x.items.length, 0);
    const topicOut: TopicOut = {
      key: t.key,
      candidates: order.length,
      arms: { baseline: armMetrics(order, q.gains, null), resolver: armMetrics([...resolverRank.order, ...tail], q.gains, resolverRank.byTrial), resolverFull: armMetrics(resolverFullRank.order, q.gains, resolverFullRank.byTrial) },
      llm: { status: "not_run", trialsSent: inputs.length, itemsSent, itemsJudged: 0, calls: 0, validCalls: 0, cachedCalls: 0, tokens: 0, promptTokens: 0, completionTokens: 0, latencyMs: 0, slowCalls: 0 },
    };
    const profile = minimizeProfile(answers);
    if (DRY) {
      const ans = numberAnswers(profile);
      const overhead = MATCH_SYSTEM_PROMPT.length + buildMatchUserPrompt(ans, []).length;
      const batches = planBatches(inputs.map((x) => ({ trialId: x.trialId, items: x.items, ...(x.title ? { title: x.title } : {}), ...(x.summary ? { summary: x.summary } : {}) })), EVAL_MAX_INPUT_CHARS, overhead);
      console.log(`${t.key}: ${inputs.length} trials, ${itemsSent} unknown items, ${batches.length} requests at ${EVAL_MAX_INPUT_CHARS} chars (overhead ${overhead})`);
    } else if (groq && inputs.length) {
      calls = [];
      // No request deadline here. The eval paces itself to the free tier (waits that production would not make in
      // one request), and with the 45 s production deadline those waits cut later batches short (one dev run had
      // coverage 52.9%). The eval measures judge quality on full coverage; production coverage is checked live.
      const judged = await judgeCriteria(profile, inputs, { store: new MemoryKvStore(), providers: [groq], breakerFor: () => new CircuitBreaker(), consumeBudget: async () => true, deadlineMs: 30 * 60_000, log: (e) => { if (e.status !== "ok") console.warn("judge", JSON.stringify(e)); } });
      const quota = dailyLimitHit && !judged.ok;
      const response: MatchResponse = judged.ok
        ? { status: "ok", provider: judged.provider, results: judged.results, cachedIds: judged.cachedIds, skippedIds: [] }
        : { status: "degraded", provider: null, results: judged.results, cachedIds: judged.cachedIds, skippedIds: [], degradedReason: judged.reason };
      const llm = topicOut.llm;
      llm.status = quota ? "quota" : judged.ok ? "ok" : "degraded";
      if (!judged.ok) llm.degradedReason = judged.reason;
      llm.calls = calls.length;
      llm.validCalls = calls.filter((c) => c.valid).length;
      llm.cachedCalls = calls.filter((c) => c.cached).length;
      llm.tokens = calls.reduce((s, c) => s + c.tokens, 0);
      llm.promptTokens = calls.reduce((s, c) => s + c.promptTokens, 0);
      llm.completionTokens = calls.reduce((s, c) => s + c.completionTokens, 0);
      llm.latencyMs = calls.reduce((s, c) => s + c.ms, 0);
      llm.slowCalls = calls.filter((c) => c.ms > 30_000).length;
      if (judged.ok) {
        const sentBy = new Map(inputs.map((x) => [x.trialId, x.items.length]));
        llm.itemsJudged = Math.round(judged.results.reduce((s, r) => s + (r.coverage ?? 0) * (sentBy.get(r.trialId) ?? 0), 0));
      }
      if (!quota) {
        const ranking = rankingFromJudge(results, resolver, response, answers, catalog);
        topicOut.arms.llm = armMetrics([...ranking.order, ...tail], q.gains, ranking.byTrial);
      }
    } else if (groq && !inputs.length) {
      topicOut.llm.status = "ok";
      topicOut.arms.llm = topicOut.arms.resolver;
    }
    out.push(topicOut);
    const a = topicOut.arms;
    console.log(`${t.key.padEnd(8)} n=${String(order.length).padStart(3)}  nDCG@10 base ${a.baseline?.ndcg10.toFixed(3)} res ${a.resolver?.ndcg10.toFixed(3)} llm ${a.llm ? a.llm.ndcg10.toFixed(3) : "  -  "}  llm ${topicOut.llm.status} calls ${topicOut.llm.calls} (cached ${topicOut.llm.cachedCalls}) tokens ${topicOut.llm.tokens}`);
  }
  if (DRY) return;

  // Aggregate. The LLM arm is compared on the topics where it completed; the other arms are reported both on all
  // topics and on that same subset (paired).
  const llmTopics = out.filter((x) => x.arms.llm);
  const metricNames = ["ndcg10", "p10", "missedExclusions", "unknownShare"] as const;
  const agg = (rows: TopicOut[], arm: Arm, m: (typeof metricNames)[number]): CI | null => {
    const v = rows.map((r) => r.arms[arm]?.[m]).filter((x): x is number => typeof x === "number");
    return v.length ? bootstrapCI(v) : null;
  };
  const summary: Record<string, unknown> = {};
  for (const subset of ["all", "llmCovered"] as const) {
    const rows = subset === "all" ? out : llmTopics;
    const s: Record<string, Record<string, CI | null>> = {};
    for (const arm of ARMS) {
      s[arm] = {};
      for (const m of metricNames) s[arm][m] = arm === "llm" && subset === "all" ? null : agg(rows, arm, m);
    }
    const deltas: Record<string, Record<string, CI | null>> = {};
    for (const arm of ["resolver", "llm", "resolverFull"] as const) {
      const d: Record<string, CI | null> = {};
      deltas[`${arm}-baseline`] = d;
      for (const m of ["ndcg10", "p10", "missedExclusions"] as const) {
        const pairs = rows.filter((r) => r.arms[arm] && r.arms.baseline);
        d[m] = pairs.length && !(arm === "llm" && subset === "all") ? pairedBootstrapCI(pairs.map((r) => (r.arms[arm] as ArmMetrics)[m]), pairs.map((r) => (r.arms.baseline as ArmMetrics)[m])) : null;
      }
    }
    summary[subset] = { topics: rows.map((r) => r.key), arms: s, deltas };
  }
  const judgedTopics = out.filter((x) => x.llm.status === "ok" || x.llm.status === "degraded");
  const calls_ = judgedTopics.reduce((s, x) => s + x.llm.calls, 0);
  const valid = judgedTopics.reduce((s, x) => s + x.llm.validCalls, 0);
  const sent = judgedTopics.reduce((s, x) => s + x.llm.itemsSent, 0);
  const judgedItems = judgedTopics.reduce((s, x) => s + x.llm.itemsJudged, 0);
  const llmSummary = {
    provider: groq ? `groq ${cfg.model}` : null,
    evalMaxInputChars: EVAL_MAX_INPUT_CHARS,
    evalMaxTokens: EVAL_MAX_TOKENS,
    reasoningEffort: REASONING,
    callsOver30s: judgedTopics.reduce((s, x) => s + x.llm.slowCalls, 0),
    topicsWithLlm: llmTopics.length,
    topicsTotal: out.length,
    statusCounts: Object.fromEntries(["ok", "degraded", "quota", "not_run"].map((s) => [s, out.filter((x) => x.llm.status === s).length])),
    jsonValidity: calls_ ? { valid, calls: calls_, share: valid / calls_ } : null,
    coverage: sent ? { judged: judgedItems, sent, share: judgedItems / sent } : null,
    tokensPerPatient: judgedTopics.length ? bootstrapCI(judgedTopics.map((x) => x.llm.tokens)) : null,
    latencyMsPerPatient: judgedTopics.length ? bootstrapCI(judgedTopics.map((x) => x.llm.latencyMs)) : null,
    tokensTotal: judgedTopics.reduce((s, x) => s + x.llm.tokens, 0),
    tokensUncachedThisRun: "see per-topic cachedCalls",
  };
  const sha = (() => {
    try {
      return execSync("git rev-parse HEAD", { cwd: REPO_ROOT }).toString().trim();
    } catch {
      return "";
    }
  })();
  const report = { split: SPLIT, years: YEARS, pool: POOL, ranAt: new Date().toISOString(), head: sha, judgeTopN: MATCH_JUDGE.topN, llm: llmSummary, summary, topics: out };
  // A dry run only plans requests: it writes nothing (and never counts as a test run).
  if (DRY) return;
  writeFileSync(path.join(OUT_DIR, `${SPLIT}.json`), JSON.stringify(report, null, 2) + "\n");
  if (SPLIT === "test") writeFileSync(testLog, JSON.stringify({ note: "v7 test split (TREC 2022 + 2023 cancer topics): run once at the end of development, after all dev decisions.", runs: [...priorTestRuns, { at: report.ranAt, sha, llm: !!groq, llmStatus: llmSummary.statusCounts }] }, null, 2) + "\n");
  writeMarkdown();
  console.log(`\nwrote eval/matching/${SPLIT}.json and eval/matching/RESULTS.md`);
  const all = summary.llmCovered as { arms: Record<Arm, Record<string, CI | null>> };
  for (const arm of ARMS) console.log(`${arm.padEnd(9)} nDCG@10 ${all.arms[arm].ndcg10 ? fmtCI(all.arms[arm].ndcg10 as CI) : "n/a"}`);
}

const fmtInt = (c: CI) => `${Math.round(c.mean)} [${Math.round(c.lo)}, ${Math.round(c.hi)}]`;

/** RESULTS.md from whichever of dev.json / test.json exist. */
function writeMarkdown() {
  const lines: string[] = ["# Matching eval (v8)", "", "Generated by `npm run eval:matching` (scripts/eval/matching/run.ts). TREC Clinical Trials cancer subset, human qrels (0 not relevant, 1 excluded, 2 eligible), structured answers per topic. Dev = TREC 2021 (10 topics), test = TREC 2022 (2 topics) + TREC 2023 (5 breast-cancer template topics, which give no age or sex: age 50, female assumed). Means over topics with bootstrap 95% CIs (4000 resamples over topics). Not a clinical-accuracy claim.", "", "Arms: **baseline** = v5 pipeline order; **resolver** = the top 15 of that order (what rankTrials returns and find-flow reorders) re-ranked by deterministic per-criterion labels (Tier A first, then incScore), rest unchanged; **llm** = resolver + Groq judge on the unknown items of the top " + MATCH_JUDGE.topN + " (MATCH_JUDGE.topN; screening-only items are not sent); **resolver, full pool** = exploratory, the resolver tiering over every candidate (not what the app does).", "", "Caveats: 10 dev topics and 7 test topics are few; test CIs over 7 topics are wide. The candidate pool is each topic's judged trials (the TREC pool), not the national index. Groq free tier: requests are capped at 16000 chars (see LLM judge notes).", "", "Definitions: P@10 = share of the top 10 judged eligible (2). Missed exclusions = share of the top 10 that TREC judged excluded (1) and the arm still shows in Tier A (baseline has no tiers, so all shown count). Unknown share = unknown labels / all criterion labels of the top-10 trials.", ""];
  for (const split of ["dev", "test"] as const) {
    const f = path.join(OUT_DIR, `${split}.json`);
    if (!existsSync(f)) {
      lines.push(`## ${split}`, "", "Not run.", "");
      continue;
    }
    const r = JSON.parse(readFileSync(f, "utf8")) as { ranAt: string; head: string; llm: Record<string, unknown> & { jsonValidity: { valid: number; calls: number; share: number } | null; coverage: { judged: number; sent: number; share: number } | null; tokensPerPatient: CI | null; latencyMsPerPatient: CI | null; statusCounts: Record<string, number>; topicsWithLlm: number; topicsTotal: number; tokensTotal: number }; summary: Record<"all" | "llmCovered", { topics: string[]; arms: Record<Arm, Record<string, CI | null>>; deltas: Record<string, Record<string, CI | null>> }>; topics: TopicOut[] };
    lines.push(`## ${split} (${SPLIT_LABEL[split]})`, "", `Ran ${r.ranAt}. LLM arm evaluated on ${r.llm.topicsWithLlm}/${r.llm.topicsTotal} topics (status: ${Object.entries(r.llm.statusCounts).map(([k, v]) => `${k} ${v}`).join(", ")}; "degraded" = the judge failed and the app's resolver-only fallback is scored, "quota" = Groq daily cap reached, not scored).`, "");
    if ((r.llm.statusCounts.quota ?? 0) > 0) lines.push(`LLM arm incomplete: ${r.llm.statusCounts.quota} topic(s) hit the Groq free-tier daily token cap (200000 TPD) and are not scored for that arm (nothing imputed). Resume from the response cache with \`npm run eval:matching -- --split=${split}${split === "test" ? " --allow-test-rerun" : ""} --wait\` (same frozen settings).`, "");
    for (const subset of ["all", "llmCovered"] as const) {
      // When every topic has an LLM run, the llmCovered summary is the same topic set with the LLM arm filled in.
      const s = subset === "all" && r.summary.llmCovered.topics.length === r.topics.length ? r.summary.llmCovered : r.summary[subset];
      if (subset === "llmCovered" && (s.topics.length === r.topics.length || s.topics.length === 0)) continue;
      lines.push(`### ${subset === "all" ? `All ${s.topics.length} topics` : `Topics with a completed LLM run (${s.topics.length}: ${s.topics.join(", ")})`}`, "", "| metric | baseline | resolver | resolver+LLM | resolver, full pool (exploratory) |", "| --- | --- | --- | --- | --- |");
      const c = (x: CI | null | undefined) => (x ? fmtCI(x) : "n/a");
      for (const [m, label] of [["ndcg10", "nDCG@10"], ["p10", "P@10"], ["missedExclusions", "missed exclusions"], ["unknownShare", "unknown share"]] as const) lines.push(`| ${label} | ${c(s.arms.baseline[m])} | ${c(s.arms.resolver[m])} | ${c(s.arms.llm[m])} | ${c(s.arms.resolverFull?.[m])} |`);
      lines.push("", "Paired difference vs baseline (bootstrap 95% CI):", "");
      for (const [d, v] of Object.entries(s.deltas)) for (const [m, ci] of Object.entries(v)) if (ci) lines.push(`- ${d} ${m}: ${fmtDiff(ci, m === "missedExclusions" || m === "unknownShare")}`);
      lines.push("");
    }
    // How often a Tier B demotion in the shown top 10 is right. TREC "excluded" (1) = correct,
    // "eligible" (2) = a false exclusion, "not relevant" (0) is counted apart. Pooled over topics.
    lines.push("Tier B precision (top 10, pooled over topics; correct = TREC excluded, wrong = TREC eligible):", "");
    for (const arm of ["resolver", "llm"] as const) {
      const shown = r.topics.flatMap((t) => (t.arms[arm]?.top10 ?? []).filter((x) => x.tier === "B"));
      const ok = shown.filter((x) => x.grade === 1).length;
      const wrong = shown.filter((x) => x.grade === 2).length;
      const nr = shown.length - ok - wrong;
      lines.push(`- ${arm}: ${shown.length} tier B in top 10; ${ok} correct, ${wrong} wrong (eligible), ${nr} not relevant; precision ${ok + wrong ? `${((100 * ok) / (ok + wrong)).toFixed(0)}% (${ok}/${ok + wrong})` : "n/a"}`);
    }
    lines.push("");
    const L = r.llm;
    lines.push("LLM judge:", "");
    lines.push(`- JSON validity: ${L.jsonValidity ? `${L.jsonValidity.valid}/${L.jsonValidity.calls} completions (${(L.jsonValidity.share * 100).toFixed(1)}%)` : "n/a"}`);
    lines.push(`- coverage (items judged / sent): ${L.coverage ? `${L.coverage.judged}/${L.coverage.sent} (${(L.coverage.share * 100).toFixed(1)}%)` : "n/a"}`);
    lines.push(`- tokens per patient: ${L.tokensPerPatient ? fmtInt(L.tokensPerPatient) : "n/a"}; total ${L.tokensTotal}`);
    lines.push(`- model latency per patient (ms, sum of calls, pacing waits excluded): ${L.latencyMsPerPatient ? fmtInt(L.latencyMsPerPatient) : "n/a"}`);
    lines.push(`- provider ${String(L.provider)}; eval request cap ${String(L.evalMaxInputChars)} chars, max_tokens ${String(L.evalMaxTokens)}, reasoning_effort ${String(L.reasoningEffort)}; calls over the app's 30 s timeout: ${String(L.callsOver30s)} (Groq free-tier 8000 TPM per request; production now uses MATCH_JUDGE ${String(MATCH_JUDGE.maxBatchChars)} chars / ${String(MATCH_JUDGE.maxTokens)} / ${MATCH_JUDGE.reasoningEffort})`, "");
    lines.push("| topic | n | nDCG base | res | llm | missed excl base | res | llm | unknown res | llm | llm status | calls | tokens |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    const f3 = (x: number | null | undefined) => (typeof x === "number" ? x.toFixed(3) : "-");
    for (const t of r.topics) lines.push(`| ${t.key} | ${t.candidates} | ${f3(t.arms.baseline?.ndcg10)} | ${f3(t.arms.resolver?.ndcg10)} | ${f3(t.arms.llm?.ndcg10)} | ${f3(t.arms.baseline?.missedExclusions)} | ${f3(t.arms.resolver?.missedExclusions)} | ${f3(t.arms.llm?.missedExclusions)} | ${f3(t.arms.resolver?.unknownShare)} | ${f3(t.arms.llm?.unknownShare)} | ${t.llm.status} | ${t.llm.calls} | ${t.llm.tokens} |`);
    lines.push("");
  }
  for (const log of ["test-runs.json", "test-runs-v7.json"]) {
    const f = path.join(OUT_DIR, log);
    if (existsSync(f)) lines.push(`Test split runs recorded in eval/matching/${log}${log === "test-runs.json" ? " (v6, TREC 2022 only)" : " (v7, TREC 2022 + 2023)"}: ${(JSON.parse(readFileSync(f, "utf8")) as { runs: unknown[] }).runs.length}.`, "");
  }
  lines.push("Vignettes: see eval/RESULTS.md section 3 (`npm run eval:vignettes -- --split=dev|test`).", "");
  writeFileSync(path.join(OUT_DIR, "RESULTS.md"), lines.join("\n"));
}

(flag("report") ? Promise.resolve(writeMarkdown()) : main()).catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
