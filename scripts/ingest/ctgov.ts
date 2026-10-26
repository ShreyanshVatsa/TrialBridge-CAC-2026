/**
 * ClinicalTrials.gov API v2 client for ingestion: throttled (< 50 req/min), retries 429/5xx with
 * exponential backoff + jitter, per-request timeout, descriptive User-Agent, and resumable paging
 * (each page is saved to disk with the next page token, so an interrupted run continues).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CTGOV_FIELDS } from "../../lib/ingest/raw";
import { readSnapshotStudies, snapshotQueryKey, type SnapshotState } from "../../lib/ingest/snapshot";

const BASE = "https://clinicaltrials.gov/api/v2/studies";
const USER_AGENT = "TrialBridge-ingest/0.1 (cancer clinical trial matching; open data use)";
const MIN_INTERVAL_MS = 1300; // ~46 requests/minute max
const TIMEOUT_MS = 60_000;
const MAX_RETRIES = 6;

let lastRequestAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait so consecutive requests are at least MIN_INTERVAL_MS apart. */
async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

export interface PageResponse {
  studies: unknown[];
  nextPageToken?: string;
  totalCount?: number;
}

/** GET one page with retry/backoff. Throws a clear error after MAX_RETRIES. */
export async function fetchPage(params: Record<string, string>): Promise<PageResponse> {
  const url = `${BASE}?${new URLSearchParams({ format: "json", fields: CTGOV_FIELDS, ...params })}`;
  let lastError = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) return (await res.json()) as PageResponse;
      lastError = `HTTP ${res.status}`;
      if (res.status !== 429 && res.status < 500) throw new Error(`ClinicalTrials.gov request failed (${lastError}): ${url}`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("ClinicalTrials.gov request failed")) throw err;
      lastError = err instanceof Error ? err.message : String(err);
    }
    // Exponential backoff with full jitter: random in [0, 2^attempt * 2s], capped at 60s.
    const backoff = Math.random() * Math.min(60_000, 2 ** attempt * 2000);
    console.warn(`  retry ${attempt + 1}/${MAX_RETRIES} after ${lastError} (waiting ${Math.round(backoff)} ms)`);
    await sleep(backoff);
  }
  throw new Error(`ClinicalTrials.gov request failed after ${MAX_RETRIES} retries (${lastError})`);
}

/**
 * Fetch every page of a query into the snapshot directory `cacheDir` (page-0001.json, ...), resuming from
 * `state.json`. The resume key covers the query parameters AND the requested field list, so asking for a new field
 * starts a new fetch instead of reusing pages that lack it. `fetchedAt` (first page time) is recorded in the state.
 * Returns all studies (unvalidated) from the saved pages.
 */
export async function fetchAllResumable(params: Record<string, string>, cacheDir: string, pageSize = 1000): Promise<unknown[]> {
  await mkdir(cacheDir, { recursive: true });
  const statePath = path.join(cacheDir, "state.json");
  const queryKey = snapshotQueryKey(params, CTGOV_FIELDS);
  let state: SnapshotState = { queryKey, pages: 0, nextPageToken: null, done: false };
  try {
    const prev = JSON.parse(await readFile(statePath, "utf8")) as SnapshotState;
    // Older snapshots keyed the query alone; a complete one is still readable (never extended) for exact comparisons.
    const legacy = prev.queryKey === JSON.stringify(params) && prev.done;
    if (prev.queryKey === queryKey || legacy) state = prev;
    else if (prev.pages > 0) throw new Error(`${cacheDir} holds a different query or field list; use --refresh to fetch a new snapshot`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("--refresh")) throw err;
    /* no previous state: fresh run */
  }
  if (state.pages > 0 && !state.done) console.log(`Resuming after page ${state.pages}`);

  while (!state.done) {
    const page = await fetchPage({ ...params, pageSize: String(pageSize), countTotal: "true", ...(state.nextPageToken ? { pageToken: state.nextPageToken } : {}) });
    state.pages += 1;
    state.fetchedAt ??= new Date().toISOString();
    if (page.totalCount !== undefined) state.totalCount = page.totalCount;
    await writeFile(path.join(cacheDir, `page-${String(state.pages).padStart(4, "0")}.json`), JSON.stringify(page.studies));
    state.nextPageToken = page.nextPageToken ?? null;
    state.done = !page.nextPageToken;
    await writeFile(statePath, JSON.stringify(state));
    const fetched = Math.min(state.pages * pageSize, state.totalCount ?? Infinity);
    console.log(`  page ${state.pages}: ${fetched}/${state.totalCount ?? "?"} studies`);
  }
  return readSnapshotStudies(cacheDir);
}

/** Base filters for v1 scope: recruiting, interventional, at least one U.S. location. */
export const SCOPE_PARAMS = {
  "filter.overallStatus": "RECRUITING",
  "filter.advanced": "AREA[StudyType]INTERVENTIONAL AND AREA[LocationCountry]United States",
} as const;

/** National condition query: broad cancer terms (MeSH-expanded by ClinicalTrials.gov). */
export const NATIONAL_CONDITION_QUERY =
  "cancer OR neoplasm OR tumor OR carcinoma OR lymphoma OR leukemia OR myeloma OR melanoma OR sarcoma OR glioma OR malignancy OR myelodysplastic";

/** The full national query (scope + condition), the one thing a national snapshot is keyed by. */
export const NATIONAL_QUERY: Record<string, string> = { ...SCOPE_PARAMS, "query.cond": NATIONAL_CONDITION_QUERY };
