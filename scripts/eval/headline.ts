/**
 * National-scale evaluation section of `npm run eval`: the same 40 synthetic profiles and written title/condition
 * label rules (make-labels.ts) applied to the national shards in public/data (or NATIONAL_DIR), with
 *   - the production v2 pipeline,
 *   - a BM25-only baseline over the same hard-filtered candidates,
 *   - a random-ranking baseline over the same candidates,
 *   - the independent hard-filter oracle (oracle.ts) run over what the pipeline returned and over every candidate.
 * The title/condition labels are a SMOKE TEST (see RESULTS.md): BM25 reads the same text the labels do.
 */
import MiniSearch from "minisearch";
import { FACT_POLICY, getCatalog } from "../../config/questionnaire";
import type { CancerGroupId } from "../../config/cancer-groups";
import { buildProfileText } from "../../lib/match/query";
import { TOP_N, rankTrials, type RankEntry } from "../../lib/match/rank";
import { MINISEARCH_SEARCH, type SearchDoc } from "../../lib/match/minisearch-config";
import type { IntakeAnswers } from "../../lib/types/intake";
import type { QuestionnaireState } from "../../lib/types/questionnaire";
import { zipCentroid } from "./common";
import { MODELS, embedAll } from "./embed";
import { labelProfile, PROFILES } from "./make-labels";
import type { National } from "./national";
import { emptyTally, oracleEligibleIds, tallyResults, type OracleStudy, type OracleTally } from "./oracle";
import { randomBaseline, rng } from "./stats";
import type { LatLon } from "../../lib/geo/distance";
import { nearestSite, passesDistance, passesGroup } from "../../lib/match/filters";

export interface HeadlineRow {
  id: string;
  group: string;
  candidates: number;
  relevant: number;
  pipeline: number;
  bm25: number;
  random: number;
  pipelineExcluded: number;
  randomExcluded: number;
}
export interface HeadlineResult {
  trials: number;
  rows: HeadlineRow[];
  oracle: { raw: number; returned: OracleTally; candidates: OracleTally; missed: number; missedByGroup: number; missedByDistance: number; oracleEligible: number };
}

function ndcg10(ranked: readonly string[], rel: ReadonlySet<string>): number {
  if (rel.size === 0) return NaN;
  const dcg = ranked.slice(0, 10).reduce((s, id, i) => s + (rel.has(id) ? 1 / Math.log2(i + 2) : 0), 0);
  let idcg = 0;
  for (let i = 0; i < Math.min(rel.size, 10); i++) idcg += 1 / Math.log2(i + 2);
  return dcg / idcg;
}
const excludedShare = (ranked: readonly string[], exc: ReadonlySet<string>): number => (exc.size ? ranked.slice(0, 10).filter((id) => exc.has(id)).length / Math.min(10, ranked.length || 1) : NaN);

export async function runHeadline(opts: { national: National; zips: Map<string, LatLon>; labels: { profiles: Array<{ id: string; answers: IntakeAnswers; state: QuestionnaireState }> }; rawNational: Map<string, OracleStudy> | null }): Promise<HeadlineResult> {
  const { national, zips, labels, rawNational } = opts;
  const profiles = labels.profiles.map((p, i) => {
    const a: IntakeAnswers = { ...p.answers, questionnaire: p.state };
    const catalog = getCatalog("cancer", a.cancerType);
    return { id: p.id, i, a, catalog, text: buildProfileText(a, catalog), origin: zipCentroid(zips, a.zip) };
  });
  const vecs = await embedAll("minilm", "q8", profiles.map((p) => MODELS.minilm.queryPrefix + p.text));
  const entriesCache = new Map<string, RankEntry[]>();
  const rand = rng(20261012);
  const rows: HeadlineRow[] = [];
  const returned = emptyTally();
  const candidatesTally = emptyTally();
  let missed = 0, missedByGroup = 0, missedByDistance = 0, oracleEligible = 0;
  const allEntries = new Map(national.entries("other").map((e) => [e.card.id, e])); // every trial the national build contains
  const allIds = new Set(allEntries.keys());

  for (const p of profiles) {
    const g = p.a.cancerType as CancerGroupId;
    if (g === "other") continue;
    const entries = entriesCache.get(g) ?? national.entries(g);
    entriesCache.set(g, entries);
    const indexes = national.indexes(g);
    const bm25 = (ids: ReadonlySet<string>): string[] => {
      const best = new Map<string, number>();
      for (const idx of indexes as MiniSearch<SearchDoc>[]) for (const r of idx.search(p.text, { ...MINISEARCH_SEARCH, filter: (x) => ids.has(String(x.id)) })) best.set(String(r.id), Math.max(best.get(String(r.id)) ?? 0, r.score));
      return [...best.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([id]) => id);
    };
    const out = rankTrials({ entries, answers: p.a, origin: p.origin, keywordSearch: bm25, queryVector: vecs[p.i] as Float32Array, catalog: p.catalog, policy: FACT_POLICY, limit: 1e9 });
    const candidateIds = out.results.map((r) => r.card.id);
    const cards = entries.map((e) => e.card);
    const sites = new Map(entries.map((e) => [e.card.id, e.sites]));
    const lab = labelProfile(PROFILES[p.i]!, cards, sites, p.origin);
    const rel = new Set(lab.relevant), exc = new Set(lab.excluded);
    // BM25 baseline over the same hard-filtered candidates (candidates BM25 does not match rank after, in id order).
    const kwRanked = bm25(new Set(candidateIds));
    const kwSet = new Set(kwRanked);
    const kwAll = [...kwRanked, ...candidateIds.filter((id) => !kwSet.has(id)).sort()];
    rows.push({
      id: p.id, group: g, candidates: candidateIds.length, relevant: rel.size,
      pipeline: ndcg10(candidateIds, rel), bm25: ndcg10(kwAll, rel),
      random: randomBaseline(candidateIds, (r) => ndcg10(r, rel), rand),
      pipelineExcluded: excludedShare(candidateIds, exc),
      randomExcluded: randomBaseline(candidateIds, (r) => excludedShare(r, exc), rand),
    });

    if (rawNational) {
      const sexAns = p.a.questionnaire?.answers["sex"];
      const patient = { group: g, age: p.a.age, origin: p.origin, travelMiles: p.origin ? p.a.travelMiles : null, sex: sexAns === "female" || sexAns === "male" ? sexAns : null } as const;
      tallyResults(returned, rawNational, candidateIds.slice(0, TOP_N), patient, p.id);
      tallyResults(candidatesTally, rawNational, candidateIds, patient, p.id);
      const eligible = new Set(oracleEligibleIds(rawNational, patient));
      const cand = new Set(candidateIds);
      const inBuild = [...eligible].filter((id) => allIds.has(id)); // raw records outside the build (no recruiting U.S. site, not a cancer trial) cannot be ranked
      oracleEligible += inBuild.length;
      for (const id of inBuild) {
        if (cand.has(id)) continue;
        missed++;
        const e = allEntries.get(id);
        if (e && !passesGroup(e.card, g)) missedByGroup++; // the app does not tag the trial with this group
        else if (e && !passesDistance(nearestSite(e.sites, p.origin), p.origin ? p.a.travelMiles : null)) missedByDistance++; // the app finds no site in range
      }
    }
  }
  return { trials: allIds.size, rows, oracle: { raw: rawNational?.size ?? 0, returned, candidates: candidatesTally, missed, missedByGroup, missedByDistance, oracleEligible } };
}
