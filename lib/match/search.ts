/**
 * Browser search orchestration (client-only): load shard(s) + ZIP centroid + profile embedding
 * in parallel, then run the pure ranking pipeline (rank.ts). Nothing leaves the browser.
 */
import { IntakeAnswersSchema, type IntakeAnswers } from "@/lib/types/intake";
import type { SearchOutcome, SearchProgress } from "@/lib/types/match";
import { loadTrials, lookupZip } from "@/lib/data/loader";
import { hydrateResults } from "./lite";
import { getShardIndex, keywordRanking, keywordScores } from "./keyword";
import { buildProfileText } from "./query";
import { embedProfile } from "./embedder";
import { loadGroupShards } from "./group-data";
import { rankTrials, type MatchContext, type RankEntry } from "./rank";
import { FACT_POLICY, getCatalog } from "@/config/questionnaire";

export { applyAnalysis } from "./apply";

export interface SearchOptions extends MatchContext {
  onProgress?: (p: SearchProgress) => void;
  signal?: AbortSignal;
}

/** Catalog + fact policy that give questionnaire answers their meaning (explicit options win). */
function matchContext(a: IntakeAnswers, opts: SearchOptions): MatchContext {
  if (!a.questionnaire) return {};
  return { catalog: opts.catalog ?? getCatalog("cancer", a.cancerType), policy: opts.policy ?? FACT_POLICY };
}

/** User Timing marks ("tb:search:<step>") so the search can be profiled in the browser or by a Playwright run. */
function mark(step: string): void {
  if (typeof performance !== "undefined" && typeof performance.mark === "function") performance.mark(`tb:search:${step}`);
}

export async function searchTrials(answers: IntakeAnswers, opts: SearchOptions = {}): Promise<SearchOutcome> {
  const a = IntakeAnswersSchema.parse(answers);
  const report = opts.onProgress ?? (() => undefined);
  const ctx = matchContext(a, opts);
  const queryText = buildProfileText(a, ctx.catalog);
  const signalOpt = opts.signal ? { signal: opts.signal } : {};

  mark("start");
  report({ stage: "loading_shards", fraction: 0 });
  // Start the embedding immediately; it runs in the worker while shards download.
  let modelFraction = 0;
  const vectorPromise = embedProfile(queryText, {
    ...signalOpt,
    onProgress: (f) => {
      modelFraction = f;
    },
  });
  const [{ shards }, origin] = await Promise.all([
    loadGroupShards(a.cancerType, { ...signalOpt, onProgress: (fraction) => report({ stage: "loading_shards", fraction }) }),
    lookupZip(a.zip, signalOpt).catch(() => null),
  ]);
  mark("shards");
  if (shards.length === 0) return { results: [], candidateCount: 0, searchedCount: 0, keywordOnly: false };

  report({ stage: "loading_model", fraction: modelFraction });
  const vector = await vectorPromise;
  mark("vector");
  if (opts.signal?.aborted) throw opts.signal.reason;

  report({ stage: "ranking" });
  const entries: RankEntry[] = shards.flatMap((s) => s.entries);
  const indexes = shards.map((s) => getShardIndex({ id: s.info.id, indexJson: s.indexJson }));
  mark("index");
  const keywordSearch = (ids: ReadonlySet<string>) => keywordRanking(indexes, queryText, ids);

  const scoresOf = (ids: ReadonlySet<string>) => keywordScores(indexes, queryText, ids);
  let outcome = rankTrials({ entries, answers: a, origin, keywordSearch, keywordScores: scoresOf, queryVector: vector, ...ctx });
  mark("ranked");
  if (shards.some((s) => s.info.kind === "lite")) {
    // Lite index: load full cards for just the top results from per-trial buckets.
    const full = await loadTrials(outcome.results.map((r) => r.card.id), signalOpt);
    outcome = hydrateResults(outcome, full, a, origin, ctx);
    mark("hydrated");
  }
  // Never drop the distance limit silently: tell the UI when it could not be applied.
  if (a.travelMiles !== null && !origin) outcome = { ...outcome, distanceUnavailable: true };
  if (origin && "approximate" in origin && origin.approximate) outcome = { ...outcome, zipApproximate: true };
  report({ stage: "done" });
  mark("done");
  return outcome;
}

/**
 * Warm caches while the user is still answering intake questions: download the shard(s) for the
 * chosen cancer type and load the embedding model in the worker. Safe to call repeatedly; never
 * throws. Nothing about the user is sent anywhere (only static files are fetched).
 */
export function prefetchSearch(cancerType: IntakeAnswers["cancerType"]): void {
  void (async () => {
    try {
      embedProfile("warm up", { timeoutMs: 120_000 }).catch(() => null);
      await loadGroupShards(cancerType);
    } catch {
      /* best effort: the real search retries and reports errors */
    }
  })();
}
