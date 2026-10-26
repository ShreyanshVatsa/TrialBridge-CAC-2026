/**
 * Loader for the TREC Clinical Trials 2021/2022 cancer-topic benchmark (see eval/trec/README.md).
 *
 * For each cancer topic it returns the topic text, the structured TrialBridge answers, the human
 * relevance judgments (nctId -> 0 | 1 | 2) and the judged trials converted to TrialCard objects with the same
 * `buildRecord` pipeline that ingestion uses. Nothing under lib/ is modified: the one benchmark-specific adaptation
 * (a synthetic U.S. placeholder site for trials with no usable U.S. site, since TREC judgments ignore location)
 * lives here in `withPlaceholderSite`.
 */
import { existsSync, readFileSync } from "node:fs";
import type { TrecYear } from "./select-topics";
import path from "node:path";
import MiniSearch from "minisearch";
import { RawStudySchema, type RawLocation, type RawStudy } from "../../../lib/ingest/raw";
import { buildRecord } from "../../../lib/ingest/record";
import { usSites } from "../../../lib/ingest/parse";
import { MINISEARCH_OPTIONS, MINISEARCH_SEARCH, toSearchDoc, type SearchDoc } from "../../../lib/match/minisearch-config";
import type { TrialCard } from "../../../lib/types/trial";
import type { CancerGroupId } from "../../../config/cancer-groups";
import { TREC_CACHE_DIR, TREC_EVAL_DIR, TREC_STUDIES_DIR } from "./paths";
import { readQrels, type TopicQrels } from "./qrels";
import type { TrecTopicText } from "./select-topics";
import type { StudiesIndex } from "./fetch-studies";

export type { Grade, TopicQrels } from "./qrels";

/** One questionnaire answer: option id, option ids (multi), or a biomarker grid. */
export type StructuredAnswerValue = string | number | string[] | Record<string, string>;

/** TrialBridge answers for a topic (eval/trec/structured-answers.json). */
export interface StructuredAnswers {
  group: CancerGroupId;
  age: number;
  sex?: "female" | "male";
  rationale: string;
  /** Any other catalog question id -> answer. */
  [question: string]: StructuredAnswerValue | undefined;
}

export interface TrecTrial {
  card: TrialCard;
  /** True when the study had no recruiting U.S. site and was given the synthetic placeholder location. */
  syntheticSite: boolean;
}

export interface TrecTopic {
  year: TrecYear;
  topicId: number;
  /** `${year}-${topicId}`, the key used in structured-answers.json. */
  key: string;
  text: string;
  answers: StructuredAnswers;
  /** Human judgments over judged NCT ids: 0 not relevant, 1 excluded, 2 eligible. */
  qrels: TopicQrels;
  /** Judged trials that were fetched and converted to cards (missing/dropped ones are listed on the benchmark). */
  trials: TrecTrial[];
}

export interface TrecBenchmark {
  topics: TrecTopic[];
  /** Judged NCT ids the live API no longer returns. */
  missing: string[];
  /** Fetched studies that could not become cards: nctId -> reason (schema failure or buildRecord reason). */
  dropped: Record<string, string>;
  /** Number of fetched studies that received the placeholder site. */
  syntheticSites: number;
  fetchedAt: string;
}

export const PLACEHOLDER_SITE: RawLocation = {
  facility: "TREC placeholder",
  city: "Bethesda",
  state: "Maryland",
  country: "United States",
  status: "RECRUITING",
};

/**
 * TREC relevance does not depend on location, but `buildRecord` drops studies without a recruiting U.S. site.
 * Give such a study one synthetic placeholder location (no geoPoint) so it can become a card; flag it.
 */
export function withPlaceholderSite(study: RawStudy): { study: RawStudy; synthetic: boolean } {
  if (usSites(study).length > 0) return { study, synthetic: false };
  const cl = study.protocolSection.contactsLocationsModule ?? {};
  return {
    synthetic: true,
    study: {
      ...study,
      protocolSection: { ...study.protocolSection, contactsLocationsModule: { ...cl, locations: [...(cl.locations ?? []), PLACEHOLDER_SITE] } },
    },
  };
}

/** Validate one raw API study and convert it to a TrialCard (with the placeholder-site adaptation). */
export function toTrecTrial(raw: unknown): { ok: true; trial: TrecTrial } | { ok: false; id: string; reason: string } {
  const parsed = RawStudySchema.safeParse(raw);
  const id = (raw as { protocolSection?: { identificationModule?: { nctId?: string } } })?.protocolSection?.identificationModule?.nctId ?? "unknown";
  if (!parsed.success) return { ok: false, id, reason: `schema: ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? ""}`.trim() };
  const { study, synthetic } = withPlaceholderSite(parsed.data);
  const built = buildRecord(study);
  if (!built.ok) return { ok: false, id, reason: built.reason };
  return { ok: true, trial: { card: built.card, syntheticSite: synthetic } };
}

/** Read every fetched study from data/cache/trec/studies/batch-*.json. */
export function readFetchedStudies(studiesDir = TREC_STUDIES_DIR): { studies: unknown[]; index: StudiesIndex } {
  const indexFile = path.join(studiesDir, "index.json");
  if (!existsSync(indexFile)) throw new Error(`${indexFile} not found; run \`npx tsx scripts/eval/trec/fetch-studies.ts\` first`);
  const index = JSON.parse(readFileSync(indexFile, "utf8")) as StudiesIndex;
  const studies: unknown[] = [];
  for (const b of index.batches) {
    const page = JSON.parse(readFileSync(path.join(studiesDir, b.file), "utf8")) as { studies: unknown[] };
    studies.push(...page.studies);
  }
  return { studies, index };
}

export function readStructuredAnswers(evalDir = TREC_EVAL_DIR): Record<string, StructuredAnswers> {
  return JSON.parse(readFileSync(path.join(evalDir, "structured-answers.json"), "utf8")) as Record<string, StructuredAnswers>;
}

export function readCancerTopics(evalDir = TREC_EVAL_DIR): TrecTopicText[] {
  return JSON.parse(readFileSync(path.join(evalDir, "topics-cancer.json"), "utf8")) as TrecTopicText[];
}

/** Load the whole benchmark: cancer topics with text, structured answers, qrels and judged trials as cards. */
export function loadTrec(dirs: { cacheDir?: string; evalDir?: string } = {}): TrecBenchmark {
  const cacheDir = dirs.cacheDir ?? TREC_CACHE_DIR;
  const evalDir = dirs.evalDir ?? TREC_EVAL_DIR;
  const topics = readCancerTopics(evalDir);
  const answers = readStructuredAnswers(evalDir);
  const { studies, index } = readFetchedStudies(path.join(cacheDir, "studies"));

  const trials = new Map<string, TrecTrial>();
  const dropped: Record<string, string> = {};
  let syntheticSites = 0;
  for (const raw of studies) {
    const r = toTrecTrial(raw);
    if (r.ok) {
      trials.set(r.trial.card.id, r.trial);
      if (r.trial.syntheticSite) syntheticSites++;
    } else dropped[r.id] = r.reason;
  }

  const qrelsByYear = new Map<number, Map<number, TopicQrels>>();
  const out: TrecTopic[] = topics.map((t) => {
    let yearQrels = qrelsByYear.get(t.year);
    if (!yearQrels) {
      yearQrels = readQrels(path.join(cacheDir, `qrels${t.year}.txt`));
      qrelsByYear.set(t.year, yearQrels);
    }
    const key = `${t.year}-${t.topicId}`;
    const a = answers[key];
    if (!a) throw new Error(`no structured answers for topic ${key}`);
    const qrels = yearQrels.get(t.topicId);
    if (!qrels) throw new Error(`no qrels for topic ${key}`);
    const judged: TrecTrial[] = [];
    for (const id of Object.keys(qrels)) {
      const trial = trials.get(id);
      if (trial) judged.push(trial);
    }
    return { year: t.year, topicId: t.topicId, key, text: t.text, answers: a, qrels, trials: judged };
  });
  return { topics: out, missing: index.missing, dropped, syntheticSites, fetchedAt: index.fetchedAt };
}

/** BM25 baseline: rank `cards` for the raw topic text with the production MiniSearch configuration. Returns NCT ids. */
export function trecBm25Baseline(topicText: string, cards: readonly TrialCard[]): string[] {
  const index = new MiniSearch<SearchDoc>(MINISEARCH_OPTIONS);
  index.addAll(cards.map(toSearchDoc));
  return index.search(topicText, MINISEARCH_SEARCH).map((r) => String(r.id));
}

/**
 * Graded nDCG@k with gains 0/1/2 and the standard log2(rank + 1) discount. Unjudged ids gain 0. The ideal ranking is
 * taken from the qrels (all judged documents sorted by grade), so a perfect run scores 1 and no judged relevant
 * documents scores 0.
 */
export function ndcgGraded(ranked: readonly string[], qrels: Readonly<Record<string, number>>, k: number): number {
  const discount = (i: number) => 1 / Math.log2(i + 2); // i is 0-based rank
  let dcg = 0;
  for (let i = 0; i < Math.min(k, ranked.length); i++) dcg += (qrels[ranked[i] ?? ""] ?? 0) * discount(i);
  const ideal = Object.values(qrels)
    .filter((g) => g > 0)
    .sort((a, b) => b - a)
    .slice(0, k);
  let idcg = 0;
  ideal.forEach((g, i) => (idcg += g * discount(i)));
  return idcg === 0 ? 0 : dcg / idcg;
}
