/**
 * Browser data loading: fetch shards, meta, lookup, and ZIP tables from /data with timeout,
 * retry, progress, and in-memory caching. All responses are zod-validated.
 */
import { z } from "zod";
import {
  LiteCardSchema,
  LiteSitesSchema,
  ManifestSchema,
  TrialBucketSchema,
  trialBucketKey,
  type LiteCard,
  type TrialBucket,
  MetaSchema,
  ShardSitesSchema,
  TrialCardSchema,
  type Manifest,
  type Meta,
  type ShardInfo,
  type ShardSites,
  type Site,
  type TrialCard,
} from "@/lib/types/trial";
import type { LatLon } from "@/lib/geo/distance";
import { sortSitesByDistance } from "@/lib/match/filters";

export { sortSitesByDistance };

type DataLoadErrorCode = "network" | "not_found" | "invalid" | "timeout";

export class DataLoadError extends Error {
  constructor(
    public readonly code: DataLoadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DataLoadError";
  }
}

const DATA_BASE = "/data";
const TIMEOUT_MS = 30_000;
const RETRIES = 2;

export interface FetchOptions {
  signal?: AbortSignal;
  /** Called with 0..1 as bytes arrive (when Content-Length is known). */
  onProgress?: (fraction: number) => void;
  /** HTTP cache mode ("reload" bypasses a stale cached manifest). */
  cache?: RequestCache;
}

/** Overridable fetch for tests. */
let fetchImpl: typeof fetch = (...a) => fetch(...a);
export function setFetchForTests(f: typeof fetch): void {
  fetchImpl = f;
  cache.clear();
  progressState.clear();
}

async function fetchBytes(url: string, opts: FetchOptions = {}): Promise<Uint8Array> {
  let lastErr: DataLoadError = new DataLoadError("network", "Download failed");
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (opts.signal?.aborted) throw opts.signal.reason;
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    try {
      const res = await fetchImpl(url, { signal, ...(opts.cache ? { cache: opts.cache } : {}) });
      if (res.status === 404) throw new DataLoadError("not_found", `Not found: ${url}`);
      if (!res.ok) throw new DataLoadError("network", `HTTP ${res.status}`);
      const total = Number(res.headers.get("content-length") ?? 0);
      if (!res.body || !opts.onProgress || !total) return new Uint8Array(await res.arrayBuffer());
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        opts.onProgress(Math.min(1, received / total));
      }
      const out = new Uint8Array(received);
      let off = 0;
      for (const c of chunks) {
        out.set(c, off);
        off += c.byteLength;
      }
      return out;
    } catch (err) {
      if (err instanceof DataLoadError && err.code === "not_found") throw err;
      if (opts.signal?.aborted) throw opts.signal.reason;
      lastErr = timeout.aborted ? new DataLoadError("timeout", "Download timed out") : err instanceof DataLoadError ? err : new DataLoadError("network", "Network error");
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr;
}

async function fetchJson<T>(url: string, schema: z.ZodType<T>, opts?: FetchOptions): Promise<T> {
  const bytes = await fetchBytes(url, opts);
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new DataLoadError("invalid", `Invalid JSON: ${url}`);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new DataLoadError("invalid", `Unexpected data format: ${url}`);
  return parsed.data;
}

/**
 * A caller's view of a shared load: it rejects as soon as that caller's signal aborts, while the load itself
 * keeps running for everyone else. (Passing a caller's signal into the shared fetch would let one consumer,
 * e.g. the questionnaire's candidate pool unmounting, abort a download the search in progress also awaits.)
 */
function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    const settle = <R>(fn: (v: R) => void) => (v: R) => {
      signal.removeEventListener("abort", onAbort);
      fn(v);
    };
    p.then(settle(resolve), settle(reject));
  });
}

/** `opts` for the shared load: everything but the caller's signal. */
function shared(opts: FetchOptions): FetchOptions {
  const { signal, ...rest } = opts;
  void signal;
  return rest;
}

/** Memoize promises; failed loads are evicted so they can be retried. */
const cache = new Map<string, Promise<unknown>>();
function memo<T>(key: string, load: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const hit = cache.get(key) as Promise<T> | undefined;
  if (hit) return abortable(hit, signal);
  const p = load();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return abortable(p, signal);
}

/**
 * Like `memo`, but every caller's `onProgress` is honoured: a caller that joins an in-flight load
 * (e.g. a prefetch started earlier) is told the current fraction and all later updates.
 */
const progressState = new Map<string, { listeners: Set<(f: number) => void>; last: number }>();
function memoProgress<T>(key: string, onProgress: ((f: number) => void) | undefined, load: (report: (f: number) => void) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const hit = cache.get(key) as Promise<T> | undefined;
  const state = progressState.get(key);
  if (hit && state) {
    if (!onProgress) return abortable(hit, signal);
    state.listeners.add(onProgress);
    onProgress(state.last);
    const done = () => state.listeners.delete(onProgress);
    hit.then(done, done);
    return abortable(hit, signal);
  }
  if (hit) {
    onProgress?.(1);
    return abortable(hit, signal);
  }
  const st = { listeners: new Set<(f: number) => void>(), last: 0 };
  if (onProgress) st.listeners.add(onProgress);
  progressState.set(key, st);
  const report = (f: number) => {
    st.last = f;
    st.listeners.forEach((cb) => cb(f));
  };
  const p = memo(key, () => load(report));
  const finish = () => {
    progressState.delete(key);
  };
  p.then(finish, finish);
  return abortable(p, signal);
}

export function loadMeta(): Promise<Meta> {
  return memo("meta", () => fetchJson(`${DATA_BASE}/meta.json`, MetaSchema));
}

export function loadManifest(): Promise<Manifest> {
  return memo("manifest", () => fetchJson(`${DATA_BASE}/manifest.json`, ManifestSchema));
}

/**
 * Re-fetch the manifest past the HTTP cache (after a shard or bucket 404: a deploy replaced the data version while
 * the browser still held the old manifest). Later `loadManifest` calls return the fresh copy.
 */
export function refreshManifest(): Promise<Manifest> {
  cache.delete("manifest");
  return memo("manifest", () => fetchJson(`${DATA_BASE}/manifest.json`, ManifestSchema, { cache: "reload" }));
}

/** A loaded shard: cards, sites, serialized MiniSearch index, int8 embeddings (row-major, cards order). */
interface LoadedShard {
  info: ShardInfo;
  cards: TrialCard[];
  sites: ShardSites;
  indexJson: string;
  embeddings: Int8Array;
}

/** The four files every shard (full or lite) consists of, fetched in parallel and validated. */
async function fetchShardFiles<C, S>(
  info: ShardInfo,
  shardBase: string,
  schemas: { cards: z.ZodType<C[]>; sites: z.ZodType<S> },
  opts: FetchOptions,
  emit: (fraction: number) => void,
) {
  const base = `${shardBase}/${info.id}/`;
  const fractions = [0, 0, 0, 0];
  const report = (i: number) => (f: number) => {
    fractions[i] = f;
    emit(fractions.reduce((a, b) => a + b, 0) / fractions.length);
  };
  const [cards, sites, indexBytes, embBytes] = await Promise.all([
    fetchJson(base + info.files.cards, schemas.cards, { ...opts, onProgress: report(0) }),
    fetchJson(base + info.files.sites, schemas.sites, { ...opts, onProgress: report(1) }),
    fetchBytes(base + info.files.index, { ...opts, onProgress: report(2) }),
    fetchBytes(base + info.files.embeddings, { ...opts, onProgress: report(3) }),
  ]);
  const embeddings = new Int8Array(embBytes.buffer, embBytes.byteOffset, embBytes.byteLength);
  if (cards.length > 0 && embeddings.length % cards.length !== 0) throw new DataLoadError("invalid", `Embedding size mismatch in shard ${info.id}`);
  return { info, cards, sites, indexJson: new TextDecoder().decode(indexBytes), embeddings };
}

const FullShardSchemas = { cards: z.array(TrialCardSchema), sites: ShardSitesSchema };
const LiteShardSchemas = { cards: z.array(LiteCardSchema), sites: LiteSitesSchema };

export function loadShard(info: ShardInfo, shardBase: string, opts: FetchOptions = {}): Promise<LoadedShard> {
  return memoProgress(`shard:${shardBase}/${info.id}`, opts.onProgress, (emit) => fetchShardFiles(info, shardBase, FullShardSchemas, shared(opts), emit), opts.signal);
}

/** The cross-group lite index used for "Other / not sure". */
interface LoadedLiteShard {
  info: ShardInfo;
  cards: LiteCard[];
  /** NCT ID -> [lat, lon][] */
  sites: Record<string, [number, number][]>;
  indexJson: string;
  embeddings: Int8Array;
}

export function loadLiteShard(info: ShardInfo, shardBase: string, opts: FetchOptions = {}): Promise<LoadedLiteShard> {
  return memoProgress(`lite:${shardBase}/${info.id}`, opts.onProgress, (emit) => fetchShardFiles(info, shardBase, LiteShardSchemas, shared(opts), emit), opts.signal);
}

/** Response started by /theme-init.js on trial pages (see there); adopted once if the URL matches. */
declare global {
  interface Window {
    __tbEarlyBucket?: Promise<{ url: string; data: unknown }>;
  }
}

async function adoptEarlyBucket(url: string): Promise<TrialBucket | null> {
  const early = typeof window === "undefined" ? undefined : window.__tbEarlyBucket;
  if (!early) return null;
  window.__tbEarlyBucket = undefined;
  try {
    const hit = await early;
    if (hit.url !== url) return null;
    const parsed = TrialBucketSchema.safeParse(hit.data);
    return parsed.success ? parsed.data : null;
  } catch {
    return null; // fall back to a normal fetch (with retries and typed errors)
  }
}

function loadBucket(trialBase: string, key: string, opts: FetchOptions = {}) {
  return memo(`bucket:${trialBase}/${key}`, async () => {
    const url = `${trialBase}/${key}.json`;
    return (await adoptEarlyBucket(url)) ?? fetchJson(url, TrialBucketSchema, shared(opts));
  }, opts.signal);
}

/** Load several trials (card + sites) by NCT ID from per-trial buckets. Unknown IDs are omitted. */
export async function loadTrials(nctIds: readonly string[], opts: FetchOptions = {}): Promise<Map<string, { card: TrialCard; sites: Site[] }>> {
  const keys = [...new Set(nctIds.map(trialBucketKey))];
  const fetchBuckets = (trialBase: string) =>
    Promise.all(
      keys.map((k) =>
        loadBucket(trialBase, k, opts).catch((err: unknown) => {
          if (err instanceof DataLoadError && err.code === "not_found") return null;
          throw err;
        }),
      ),
    );
  const manifest = await loadManifest();
  let buckets = await fetchBuckets(manifest.trialBase);
  if (buckets.some((b) => b === null)) {
    // A missing bucket usually means the browser held a stale manifest: refresh it once and retry the misses.
    const fresh = await refreshManifest();
    if (fresh.trialBase !== manifest.trialBase) buckets = await fetchBuckets(fresh.trialBase);
  }
  const out = new Map<string, { card: TrialCard; sites: Site[] }>();
  for (const id of nctIds) {
    for (const b of buckets) {
      const hit = b?.[id];
      if (hit) {
        out.set(id, hit);
        break;
      }
    }
  }
  return out;
}

/** Load one trial (card + U.S. sites) by NCT ID for the trial detail page. null = unknown ID. */
export async function loadTrial(nctId: string, opts: FetchOptions = {}): Promise<{ card: TrialCard; sites: Site[] } | null> {
  const id = nctId.trim().toUpperCase();
  if (!/^NCT\d{8}$/.test(id)) return null;
  return (await loadTrials([id], opts)).get(id) ?? null;
}

const ZipTableSchema = z.record(z.string(), z.tuple([z.number(), z.number()]));

/**
 * ZIP -> approximate centroid (Census ZCTA internal point). Loads only the 3-digit-prefix file.
 * Falls back to the prefix's average when the exact ZIP isn't a ZCTA (e.g. PO-box-only ZIPs).
 */
export async function lookupZip(zip: string, opts: FetchOptions = {}): Promise<(LatLon & { approximate?: true }) | null> {
  if (!/^\d{5}$/.test(zip)) return null;
  const prefix = zip.slice(0, 3);
  let table: Record<string, [number, number]>;
  try {
    table = await memo(`zip:${prefix}`, () => fetchJson(`${DATA_BASE}/zip/${prefix}.json`, ZipTableSchema, shared(opts)), opts.signal);
  } catch (err) {
    if (err instanceof DataLoadError && err.code === "not_found") return null;
    throw err;
  }
  const exact = table[zip];
  if (exact) return { lat: exact[0], lon: exact[1] };
  const all = Object.values(table);
  if (all.length === 0) return null;
  // Not a known ZCTA: the location is only the prefix area's centre, so flag it as approximate.
  return { lat: all.reduce((s, v) => s + v[0], 0) / all.length, lon: all.reduce((s, v) => s + v[1], 0) / all.length, approximate: true };
}
