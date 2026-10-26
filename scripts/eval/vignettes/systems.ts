/**
 * The retrieval systems compared on the vignette benchmark, all ranking the SAME hard-filtered candidate set of the
 * national data (group, age, distance, definite sex): BM25 over the profile text, embedding cosine, and the full
 * TrialBridge pipeline (BM25 + cosine fused, pre-check, scoring). The ClinicalTrials.gov API system lives in ctgov.ts.
 */
import MiniSearch from "minisearch";
import { FACT_POLICY, getCatalog } from "../../../config/questionnaire";
import { cosineSimilarity } from "../../../lib/match/cosine";
import { nearestSite, passesAge, passesDistance, passesGroup, passesSex } from "../../../lib/match/filters";
import { MINISEARCH_SEARCH, type SearchDoc } from "../../../lib/match/minisearch-config";
import { buildProfileText } from "../../../lib/match/query";
import { rankTrials, sexFilter, type RankEntry } from "../../../lib/match/rank";
import { toIntakeAnswers } from "../../../lib/questionnaire/adapter";
import type { IntakeAnswers } from "../../../lib/types/intake";
import type { LatLon } from "../../../lib/geo/distance";
import { MODELS, embedAll } from "../embed";
import type { National } from "../national";
import { loadZip, zipCentroid } from "../common";
import { vignetteState, type Vignette } from "./schema";

export const SYSTEM_IDS = ["bm25", "vector", "pipeline", "ctgov"] as const;
export type SystemId = (typeof SYSTEM_IDS)[number];

export interface VignetteContext {
  vignette: Vignette;
  answers: IntakeAnswers;
  catalog: ReturnType<typeof getCatalog>;
  queryText: string;
  origin: LatLon | null;
  /** Hard-filtered candidates (the set every system ranks). */
  candidates: RankEntry[];
  indexes: MiniSearch<SearchDoc>[];
}

export function vignetteContexts(vignettes: readonly Vignette[], national: National): VignetteContext[] {
  const zips = loadZip();
  return vignettes.map((v) => {
    const state = vignetteState(v);
    const answers = toIntakeAnswers(state, "en");
    const catalog = getCatalog("cancer", v.group);
    const queryText = buildProfileText(answers, catalog);
    const origin = zipCentroid(zips, v.zip);
    const maxMiles = origin ? answers.travelMiles : null;
    const sex = sexFilter(answers, { catalog, policy: FACT_POLICY });
    const seen = new Set<string>();
    const candidates = national.entries(v.group).filter((e) => {
      if (seen.has(e.card.id)) return false;
      seen.add(e.card.id);
      return passesGroup(e.card, v.group) && passesAge(e.card, v.age) && passesSex(e.card, sex) && passesDistance(nearestSite(e.sites, origin), maxMiles);
    });
    return { vignette: v, answers, catalog, queryText, origin, candidates, indexes: national.indexes(v.group) };
  });
}

/** Query vectors for every context (cached on disk by text). */
export async function queryVectors(ctxs: readonly VignetteContext[]): Promise<Float32Array[]> {
  return embedAll("minilm", "q8", ctxs.map((c) => MODELS.minilm.queryPrefix + c.queryText));
}

export function bm25Ranking(ctx: VignetteContext, text: string = ctx.queryText): string[] {
  const ids = new Set(ctx.candidates.map((c) => c.card.id));
  const scores = new Map<string, number>();
  for (const idx of ctx.indexes) for (const r of idx.search(text, { ...MINISEARCH_SEARCH, filter: (res) => ids.has(String(res.id)) })) scores.set(String(r.id), Math.max(scores.get(String(r.id)) ?? 0, r.score));
  return [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
}

export function vectorRanking(ctx: VignetteContext, q: Float32Array): string[] {
  return ctx.candidates
    .map((c) => ({ id: c.card.id, s: cosineSimilarity(q, c.vector) }))
    .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
    .map((x) => x.id);
}

/** The full pipeline over the candidates (the hard filters inside rankTrials are then no-ops). */
export function pipelineRanking(ctx: VignetteContext, q: Float32Array | null, limit = 50): string[] {
  return rankTrials({ entries: ctx.candidates, answers: ctx.answers, origin: ctx.origin, keywordSearch: () => bm25Ranking(ctx), queryVector: q, catalog: ctx.catalog, policy: FACT_POLICY, limit }).results.map((r) => r.card.id);
}
