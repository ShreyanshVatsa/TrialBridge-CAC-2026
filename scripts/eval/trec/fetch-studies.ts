/**
 * Fetch every trial judged for the TREC CT cancer topics from the live ClinicalTrials.gov API v2 and save the raw
 * pages under data/cache/trec/studies/ plus an index of found/missing NCT ids.
 *
 * Throttled to < 45 requests/minute, descriptive User-Agent, 429/5xx retried with exponential backoff + jitter.
 * Resumable: a batch whose file already holds the same id list is not fetched again.
 * `npx tsx scripts/eval/trec/fetch-studies.ts [--refresh]`
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CTGOV_FIELDS } from "../../../lib/ingest/raw";
import { TREC_CACHE_DIR, TREC_EVAL_DIR, TREC_STUDIES_DIR } from "./paths";
import { readQrels } from "./qrels";
import { TREC_YEARS, type TrecTopicText } from "./select-topics";

const BASE = "https://clinicaltrials.gov/api/v2/studies";
const USER_AGENT = "TrialBridge-eval/0.1 (TREC Clinical Trials benchmark; cancer trial matching research)";
const MIN_INTERVAL_MS = 1400; // ~43 requests/minute max
const TIMEOUT_MS = 60_000;
const MAX_RETRIES = 6;
const BATCH_SIZE = 150; // ids per request; keeps the URL under ~3 KB

export interface StudiesIndex {
  fetchedAt: string;
  /** When judged ids missing from the earlier batches (TREC 2023) were fetched into "extra" batches. */
  extraFetchedAt?: string;
  fields: string;
  batchSize: number;
  requested: number;
  found: number;
  missing: string[];
  batches: { file: string; ids: number; found: number }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequestAt = 0;
async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

interface Page {
  studies: unknown[];
  nextPageToken?: string;
  totalCount?: number;
}

async function fetchBatch(ids: string[]): Promise<Page> {
  const url = `${BASE}?${new URLSearchParams({ format: "json", fields: CTGOV_FIELDS, "filter.ids": ids.join(","), pageSize: "1000", countTotal: "true" })}`;
  let lastError = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) {
        const page = (await res.json()) as Page;
        if (page.nextPageToken) throw new Error(`unexpected second page for a ${ids.length}-id batch`);
        return page;
      }
      lastError = `HTTP ${res.status}`;
      if (res.status !== 429 && res.status < 500) throw new Error(`ClinicalTrials.gov request failed (${lastError}): ${url}`);
    } catch (err) {
      if (err instanceof Error && (err.message.startsWith("ClinicalTrials.gov request failed") || err.message.startsWith("unexpected"))) throw err;
      lastError = err instanceof Error ? err.message : String(err);
    }
    const backoff = Math.random() * Math.min(60_000, 2 ** attempt * 2000);
    console.warn(`  retry ${attempt + 1}/${MAX_RETRIES} after ${lastError} (waiting ${Math.round(backoff)} ms)`);
    await sleep(backoff);
  }
  throw new Error(`ClinicalTrials.gov request failed after ${MAX_RETRIES} retries (${lastError})`);
}

const nctIdOf = (s: unknown): string | undefined => (s as { protocolSection?: { identificationModule?: { nctId?: string } } }).protocolSection?.identificationModule?.nctId;

/** Every NCT id judged for any cancer topic, sorted. */
export function judgedIds(): string[] {
  const topics = JSON.parse(readFileSync(path.join(TREC_EVAL_DIR, "topics-cancer.json"), "utf8")) as TrecTopicText[];
  const ids = new Set<string>();
  for (const year of TREC_YEARS) {
    const wanted = new Set(topics.filter((t) => t.year === year).map((t) => t.topicId));
    if (wanted.size === 0) continue;
    const qrels = readQrels(path.join(TREC_CACHE_DIR, `qrels${year}.txt`));
    for (const [topicId, byNct] of qrels) if (wanted.has(topicId)) for (const id of Object.keys(byNct)) ids.add(id);
  }
  return [...ids].sort();
}

async function main(): Promise<void> {
  const refresh = process.argv.includes("--refresh");
  mkdirSync(TREC_STUDIES_DIR, { recursive: true });
  const ids = judgedIds();
  console.log(`${ids.length} judged NCT ids for the cancer topics; ${Math.ceil(ids.length / BATCH_SIZE)} batches of ${BATCH_SIZE}`);

  // Batches already fetched stay as they are (the 2021/2022 pools keep their 2026-10-09 records); judged ids
  // not in them (TREC 2023) go to new "extra" batches. --refresh refetches everything.
  const indexFile = path.join(TREC_STUDIES_DIR, "index.json");
  const prevIndex = !refresh && existsSync(indexFile) ? (JSON.parse(readFileSync(indexFile, "utf8")) as StudiesIndex) : null;
  const kept: StudiesIndex["batches"] = [];
  const covered = new Set<string>();
  for (const b of prevIndex?.batches ?? []) {
    const f = path.join(TREC_STUDIES_DIR, b.file);
    if (!existsSync(f)) continue;
    const prev = JSON.parse(readFileSync(f, "utf8")) as { ids: string[]; fields?: string };
    if (prev.fields !== CTGOV_FIELDS) continue;
    kept.push(b);
    for (const id of prev.ids) covered.add(id);
  }
  const todo = ids.filter((id) => !covered.has(id));
  const extra = kept.length > 0;
  const index: StudiesIndex = { fetchedAt: prevIndex && extra ? prevIndex.fetchedAt : new Date().toISOString(), ...(extra && todo.length ? { extraFetchedAt: new Date().toISOString() } : {}), fields: CTGOV_FIELDS, batchSize: BATCH_SIZE, requested: ids.length, found: 0, missing: [], batches: [...kept] };
  const found = new Set<string>();
  for (const b of kept) for (const s of (JSON.parse(readFileSync(path.join(TREC_STUDIES_DIR, b.file), "utf8")) as { studies: unknown[] }).studies) {
    const id = nctIdOf(s);
    if (id) found.add(id);
  }
  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    const n = String(i / BATCH_SIZE + 1).padStart(4, "0");
    const file = path.join(TREC_STUDIES_DIR, extra ? `batch-extra-${n}.json` : `batch-${n}.json`);
    let saved: { ids: string[]; studies: unknown[] } | undefined;
    if (!refresh && existsSync(file)) {
      const prev = JSON.parse(readFileSync(file, "utf8")) as { ids: string[]; fields?: string; studies: unknown[] };
      if (prev.fields === CTGOV_FIELDS && prev.ids.length === batch.length && prev.ids.every((x, j) => x === batch[j])) saved = prev;
    }
    if (!saved) {
      const page = await fetchBatch(batch);
      saved = { ids: batch, studies: page.studies };
      writeFileSync(file, JSON.stringify({ fetchedAt: new Date().toISOString(), fields: CTGOV_FIELDS, ids: batch, studies: page.studies }));
      console.log(`  batch ${n}: ${page.studies.length}/${batch.length} found`);
    } else {
      console.log(`  batch ${n}: cached (${saved.studies.length}/${batch.length})`);
    }
    for (const s of saved.studies) {
      const id = nctIdOf(s);
      if (id) found.add(id);
    }
    index.batches.push({ file: path.basename(file), ids: batch.length, found: saved.studies.length });
  }
  index.found = found.size;
  index.missing = ids.filter((id) => !found.has(id));
  writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`found ${index.found}/${index.requested}; missing ${index.missing.length}. Index: ${path.join(TREC_STUDIES_DIR, "index.json")}`);
}

if (process.argv[1] && /fetch-studies\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
