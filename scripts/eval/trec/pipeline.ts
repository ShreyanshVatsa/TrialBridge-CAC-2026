/**
 * Full-pipeline scoring on the TREC cancer subset: hard filters + BM25 + MiniLM cosine + RRF + rule pre-check + score,
 * ranked over the judged trials of each topic (the same candidate pool the BM25 baseline sees), using the topic's
 * written structured answers as the questionnaire state. Graded nDCG@10 against the human qrels.
 *
 * Nothing here reads judgments except to score: the ranker sees cards, sites, embeddings and answers only.
 * `npx tsx scripts/eval/trec/pipeline.ts` prints per-topic BM25 (raw topic text) vs the pipeline (structured answers).
 */
import MiniSearch from "minisearch";
import { FACT_POLICY, getCatalog } from "../../../config/questionnaire";
import { embeddingText } from "../../../lib/ingest/record";
import { MINISEARCH_OPTIONS, MINISEARCH_SEARCH, toSearchDoc, type SearchDoc } from "../../../lib/match/minisearch-config";
import { buildProfileText } from "../../../lib/match/query";
import { rankTrials, type RankEntry } from "../../../lib/match/rank";
import { toIntakeAnswers } from "../../../lib/questionnaire/adapter";
import type { AnswerValue, QuestionnaireState } from "../../../lib/types/questionnaire";
import { MODELS, embedAll, quantize } from "../embed";
import { FUSION_WEIGHTS, type Features, type FusionWeights } from "../../../lib/match/fusion";
import { loadTrec, ndcgGraded, trecBm25Baseline, type TrecTopic } from "./load";
import { ndcgAt, rankIds, type FitQuery } from "../fusion-fit";

/** Questionnaire state for a topic's structured answers (no ZIP signal: the placeholder site has no coordinates). */
export function topicState(t: TrecTopic): QuestionnaireState {
  const { group, age, sex, rationale, ...rest } = t.answers;
  void rationale;
  const answers: Record<string, AnswerValue> = { cancer_type: group, age, zip: "20892", travel: null, ...(sex ? { sex } : {}) };
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) answers[k] = v as AnswerValue;
  return { v: 2, area: "cancer", mode: "thorough", answers, history: Object.keys(answers), deferred: [], updatedAt: 1 };
}

export interface TopicResult {
  key: string;
  bm25: number;
  /** BM25 over the same hard-filtered candidates as the pipeline (a like-for-like lexical baseline). */
  bm25Filtered: number;
  pipeline: number;
  /** Judged cards the hard filters (group, age, sex) removed before ranking. */
  hardFiltered: number;
  /** Judged-eligible (grade 2) cards among them. */
  hardFilteredEligible: number;
  /** Excluded (grade 1) share of the pipeline top 10. */
  excludedAt10: number;
}

interface TopicMeta {
  bm25: number;
  bm25Filtered: number;
  hardFiltered: number;
  hardFilteredEligible: number;
}

/** One ranking problem per topic: the pipeline's feature rows over the hard-filtered candidates, plus the qrels. */
export async function trecQueries(years?: readonly number[]): Promise<{ queries: FitQuery[]; meta: Map<string, TopicMeta> }> {
  const bench = loadTrec();
  if (years) bench.topics = bench.topics.filter((t) => years.includes(t.year));
  const cards = new Map(bench.topics.flatMap((t) => t.trials.map((x) => [x.card.id, x.card] as const)));
  const list = [...cards.values()];
  const vecs = await embedAll("minilm", "q8", list.map(embeddingText));
  const vecOf = new Map(list.map((c, i) => [c.id, quantize(vecs[i] as Float32Array) as ArrayLike<number>]));
  const queries: FitQuery[] = [];
  const meta = new Map<string, TopicMeta>();
  for (const t of bench.topics) {
    const state = topicState(t);
    const answers = toIntakeAnswers(state, "en");
    const catalog = getCatalog("cancer", t.answers.group);
    const queryText = buildProfileText(answers, catalog);
    const [q] = await embedAll("minilm", "q8", [MODELS.minilm.queryPrefix + queryText]);
    const index = new MiniSearch<SearchDoc>(MINISEARCH_OPTIONS);
    index.addAll(t.trials.map((x) => toSearchDoc(x.card)));
    const entries: RankEntry[] = t.trials.map((x) => ({ card: x.card, sites: [{ facility: "", city: "", state: "", zip: "", lat: 38.99, lon: -77.1 }], vector: vecOf.get(x.card.id) as ArrayLike<number> }));
    const scoresOf = (ids: ReadonlySet<string>) => new Map(index.search(queryText, { ...MINISEARCH_SEARCH, filter: (r) => ids.has(String(r.id)) }).map((r) => [String(r.id), r.score] as const));
    const out = rankTrials({ entries, answers, origin: null, keywordSearch: (ids) => [...scoresOf(ids).keys()], keywordScores: scoresOf, queryVector: q as Float32Array, catalog, policy: FACT_POLICY, limit: entries.length, ...(process.env.RRF_K ? { rrfK: Number(process.env.RRF_K) } : {}) });
    const loadable: Record<string, number> = {};
    for (const x of t.trials) loadable[x.card.id] = t.qrels[x.card.id] ?? 0;
    const kept = new Set(out.results.map((r) => r.card.id));
    const dropped = t.trials.filter((x) => !kept.has(x.card.id));
    queries.push({ id: t.key, rows: out.results.map((r) => ({ id: r.card.id, f: r.scores.features as Features })), gains: loadable });
    meta.set(t.key, {
      bm25: ndcgGraded(trecBm25Baseline(t.text, t.trials.map((x) => x.card)), loadable, 10),
      bm25Filtered: ndcgGraded([...scoresOf(kept).entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id), loadable, 10),
      hardFiltered: dropped.length,
      hardFilteredEligible: dropped.filter((x) => t.qrels[x.card.id] === 2).length,
    });
  }
  return { queries, meta };
}

export async function trecPipeline(weightsOverride: Partial<FusionWeights> = {}, years?: readonly number[]): Promise<{ topics: TopicResult[]; meanBm25: number; meanBm25Filtered: number; meanPipeline: number }> {
  const { queries, meta } = await trecQueries(years);
  const w = { ...FUSION_WEIGHTS, ...weightsOverride } as FusionWeights;
  const topics: TopicResult[] = queries.map((q) => {
    const m = meta.get(q.id) as TopicMeta;
    const ids = rankIds(q, w);
    return {
      key: q.id,
      bm25: m.bm25,
      bm25Filtered: m.bm25Filtered,
      pipeline: ndcgAt(ids, q.gains),
      hardFiltered: m.hardFiltered,
      hardFilteredEligible: m.hardFilteredEligible,
      excludedAt10: ids.slice(0, 10).filter((id) => q.gains[id] === 1).length / Math.max(1, Math.min(10, ids.length)),
    };
  });
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return { topics, meanBm25: mean(topics.map((x) => x.bm25)), meanBm25Filtered: mean(topics.map((x) => x.bm25Filtered)), meanPipeline: mean(topics.map((x) => x.pipeline)) };
}

if (process.argv[1]?.endsWith("trec/pipeline.ts")) {
  // Dev split (TREC 2021) by default: the test split (2022 + 2023) is frozen and runs only through
  // `npm run eval:matching -- --split=test`, which logs every run.
  const years = process.argv.includes("--split=test") ? [2022, 2023] : [2021];
  trecPipeline(process.env.W ? (JSON.parse(process.env.W) as Partial<FusionWeights>) : {}, years)
    .then((r) => {
      console.log("topic      BM25(topic text)  BM25(profile, filtered)  pipeline  excl@10  hard-filtered (eligible)");
      for (const x of r.topics) console.log(`${x.key.padEnd(10)} ${x.bm25.toFixed(3).padStart(10)} ${x.bm25Filtered.toFixed(3).padStart(18)} ${x.pipeline.toFixed(3).padStart(14)} ${x.excludedAt10.toFixed(2).padStart(8)} ${String(x.hardFiltered).padStart(8)} (${x.hardFilteredEligible})`);
      console.log(`mean nDCG@10: BM25 topic text ${r.meanBm25.toFixed(3)}  BM25 profile+filters ${r.meanBm25Filtered.toFixed(3)}  pipeline ${r.meanPipeline.toFixed(3)}`);
    })
    .catch((e: unknown) => {
      console.error(e);
      process.exit(1);
    });
}
