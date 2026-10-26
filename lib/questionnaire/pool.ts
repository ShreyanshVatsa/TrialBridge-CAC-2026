/**
 * Candidate pool for the adaptive questionnaire (QUESTIONNAIRE_SPEC §2.1). Built right after the essentials:
 * hard filters (group, age, distance) over the loaded shard plus a BM25-only prior relevance over the current
 * profile text. No embeddings, so it takes milliseconds and the live counter can appear immediately.
 * Sex is NOT applied here: it is a live hard filter (liveCount / scoring), so editing it never needs a rebuild.
 * Client-only; nothing leaves the browser (only static shard files are fetched).
 */
import type { CancerGroupId } from "@/config/cancer-groups";
import { lookupZip } from "@/lib/data/loader";
import type { LatLon } from "@/lib/geo/distance";
import { nearestSite, passesAge, passesDistance, passesGroup } from "@/lib/match/filters";
import { loadGroupShards } from "@/lib/match/group-data";
import { getShardIndex, keywordScores } from "@/lib/match/keyword";
import { buildProfileText } from "@/lib/match/query";
import type { QuestionDef, QuestionnaireState } from "@/lib/types/questionnaire";
import { getCatalog } from "@/config/questionnaire";
import type { Site, TrialCard } from "@/lib/types/trial";
import { Q_AGE, Q_TRAVEL } from "./constants";
import type { CandidatePool, PoolTrial } from "./engine";
import { travelMiles } from "./adapter";
import { groupOf } from "./rules";

interface PoolEntry {
  card: Pick<TrialCard, "id" | "groups" | "minAge" | "maxAge" | "sex" | "facts">;
  sites: Site[];
}

/**
 * Pure core: hard filters + normalized BM25 prior. `bm25` returns raw keyword scores for the given candidate
 * ids; prior = score / best score (0 when the keyword search did not find the trial).
 */
export function poolFromEntries(input: {
  entries: readonly PoolEntry[];
  state: QuestionnaireState;
  origin: LatLon | null;
  bm25: (ids: ReadonlySet<string>) => ReadonlyMap<string, number>;
}): CandidatePool {
  const { state, origin } = input;
  const group = groupOf(state);
  if (!group) throw new Error("cancer_type must be answered before building the pool");
  const age = state.answers[Q_AGE];
  const maxMiles = origin ? travelMiles(state.answers[Q_TRAVEL]) : null;
  const kept = new Map<string, PoolEntry>();
  for (const e of input.entries) {
    if (kept.has(e.card.id) || !passesGroup(e.card, group)) continue;
    if (typeof age === "number" && !passesAge(e.card, age)) continue;
    if (!passesDistance(nearestSite(e.sites, origin), maxMiles)) continue;
    kept.set(e.card.id, e);
  }
  const scores = input.bm25(new Set(kept.keys()));
  const best = Math.max(0, ...scores.values());
  const trials: PoolTrial[] = [...kept.values()].map((e) => ({
    id: e.card.id,
    prior: best > 0 ? (scores.get(e.card.id) ?? 0) / best : 0,
    facts: e.card.facts,
    sex: e.card.sex,
  }));
  return { group, trials };
}

/**
 * Load the group's shard(s) (already prefetched after cancer_type in the usual flow) and the ZIP centroid,
 * then build the pool. Call it again after answers change to refresh the BM25 prior; shards are cached.
 */
export async function buildCandidatePool(state: QuestionnaireState, opts: { signal?: AbortSignal; catalog?: readonly QuestionDef[] } = {}): Promise<CandidatePool> {
  const group = groupOf(state) as CancerGroupId;
  const zip = state.answers["zip"];
  const signalOpt = opts.signal ? { signal: opts.signal } : {};
  const [{ shards }, origin] = await Promise.all([loadGroupShards(group, signalOpt), typeof zip === "string" ? lookupZip(zip, signalOpt).catch(() => null) : Promise.resolve(null)]);
  if (opts.signal?.aborted) throw opts.signal.reason;
  const text = buildProfileText({ cancerType: group, spread: "not_sure", treatments: ["not_sure"], biomarkers: {}, questionnaire: state }, opts.catalog ?? getCatalog("cancer", group));
  const indexes = shards.map((s) => getShardIndex({ id: s.info.id, indexJson: s.indexJson }));
  const bm25 = (candidates: ReadonlySet<string>) => keywordScores(indexes, text, candidates);
  return poolFromEntries({ entries: shards.flatMap((s) => s.entries), state, origin, bm25 });
}
