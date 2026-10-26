/**
 * Shared BM25 helpers for the browser: one parsed MiniSearch index per shard (cached for the whole session) and a
 * search across a group's shard indexes. The search page and the questionnaire's candidate pool both use these, so a
 * shard's index is parsed once, not once per feature.
 */
import MiniSearch from "minisearch";
import { expandQueryTerms } from "@/lib/ingest/synonyms";
import { perfCounters } from "@/lib/perf/counters";
import { MINISEARCH_OPTIONS, MINISEARCH_SEARCH, type SearchDoc } from "./minisearch-config";

const indexCache = new Map<string, MiniSearch<SearchDoc>>();

/** The shard's MiniSearch index, parsed from its serialized JSON on first use. */
export function getShardIndex(shard: { id: string; indexJson: string }): MiniSearch<SearchDoc> {
  let idx = indexCache.get(shard.id);
  if (!idx) {
    idx = MiniSearch.loadJSON<SearchDoc>(shard.indexJson, MINISEARCH_OPTIONS);
    indexCache.set(shard.id, idx);
  }
  return idx;
}

/**
 * Raw BM25 score per candidate id for `text`. A trial lives in one shard, but if it appears in several the best
 * score wins. Only ids in `candidates` are scored.
 */
export function keywordScores(indexes: readonly MiniSearch<SearchDoc>[], text: string, candidates: ReadonlySet<string>): Map<string, number> {
  const scores = new Map<string, number>();
  const extra = expandQueryTerms(text); // gene aliases and generic drug names (HGNC, NCIt); empty for most queries
  const query = extra.length ? `${text} ${extra.join(" ")}` : text;
  for (const idx of indexes) {
    perfCounters.bm25Search++;
    for (const r of idx.search(query, { ...MINISEARCH_SEARCH, filter: (res) => candidates.has(String(res.id)) })) {
      const id = String(r.id);
      scores.set(id, Math.max(scores.get(id) ?? 0, r.score));
    }
  }
  return scores;
}

/** Candidate ids best score first (ties by id, so the order is deterministic). */
export function keywordRanking(indexes: readonly MiniSearch<SearchDoc>[], text: string, candidates: ReadonlySet<string>): string[] {
  return [...keywordScores(indexes, text, candidates).entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([id]) => id);
}
