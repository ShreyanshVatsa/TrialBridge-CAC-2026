import type { Options, SearchOptions } from "minisearch";
import type { TrialCard } from "@/lib/types/trial";

/** Document shape indexed by MiniSearch (built at ingestion, loaded in the browser). */
export interface SearchDoc {
  id: string;
  title: string;
  conditions: string;
  mesh: string;
  summary: string;
  criteria: string;
}

/** Index options. Must be identical at build time and load time (MiniSearch.loadJSON). */
export const MINISEARCH_OPTIONS: Options<SearchDoc> = {
  idField: "id",
  fields: ["title", "conditions", "mesh", "summary", "criteria"],
  storeFields: [],
};

/** BM25 query options: title and conditions matter most; light prefix/fuzzy matching. */
export const MINISEARCH_SEARCH: SearchOptions = {
  boost: { title: 3, conditions: 2.5, mesh: 1.5, summary: 1, criteria: 1 },
  prefix: (term) => term.length > 4,
  fuzzy: (term) => (term.length > 6 ? 0.15 : false),
  combineWith: "OR",
};

export function toSearchDoc(card: TrialCard): SearchDoc {
  return {
    id: card.id,
    title: card.title,
    conditions: card.conditions.join(" "),
    mesh: card.meshTerms.join(" "),
    summary: card.summary,
    criteria: card.inclusion.map((c) => c.text).join(" "),
  };
}
