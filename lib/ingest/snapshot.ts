/**
 * Reproducible ingest inputs: ClinicalTrials.gov snapshots, the data lock file, the content-hash data version and
 * the pinned embedding model files. Pure helpers plus small synchronous fs readers (Node only; used by scripts).
 *
 * A snapshot is a directory of API pages (`page-0001.json`, ...) plus `state.json` written by
 * scripts/ingest/ctgov.ts. `data/data-lock.json` records which snapshot, query, field list, model revision and
 * pipeline version produced the current national dataset, so `npm run data:verify` can prove the inputs are intact
 * and `npm run ingest` (without `--refresh`) rebuilds from the same pages.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const SNAPSHOTS_DIR = "data/cache/snapshots";
/** The older snapshot location (no fetchedAt in its state file). */
const LEGACY_SNAPSHOT_DIR = "data/cache/national";
export const DATA_LOCK_FILE = "data/data-lock.json";

export interface SnapshotState {
  queryKey: string;
  pages: number;
  nextPageToken: string | null;
  done: boolean;
  totalCount?: number;
  /** ISO time the first page of this snapshot was fetched. */
  fetchedAt?: string;
}

/** The resume/cache key of a query: the parameters AND the requested field list (a new field => a new fetch). */
export function snapshotQueryKey(params: Record<string, string>, fields: string): string {
  return JSON.stringify({ params, fields });
}

/** `data/cache/snapshots/<YYYYMMDD-HHMMSS>` for a fresh fetch. */
export function newSnapshotDir(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");
  return path.join(SNAPSHOTS_DIR, stamp);
}

export const DataLockSchema = z.strictObject({
  lockVersion: z.literal(1),
  source: z.enum(["seed", "national"]),
  /** Snapshot directory relative to the repo root. */
  snapshot: z.string(),
  query: z.record(z.string(), z.string()),
  fields: z.string(),
  fetchedAt: z.string(),
  /** True when fetchedAt was inferred from file times (older snapshot). */
  fetchedAtApproximate: z.boolean().optional(),
  pages: z.array(z.strictObject({ file: z.string(), sha256: z.string().length(64) })),
  model: z.strictObject({ id: z.string(), revision: z.string(), files: z.record(z.string(), z.string().length(64)) }),
  pipelineVersion: z.string(),
  formatVersion: z.number().int(),
  dataVersion: z.string(),
  totalTrials: z.number().int(),
});
export type DataLock = z.infer<typeof DataLockSchema>;

export const sha256Hex = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");

/** Snapshot files in page order with their hashes. */
export function snapshotPageHashes(dir: string): { file: string; sha256: string }[] {
  return readdirSync(dir)
    .filter((f) => /^page-\d{4}\.json$/.test(f))
    .sort()
    .map((file) => ({ file, sha256: sha256Hex(readFileSync(path.join(dir, file))) }));
}

/** state.json of a snapshot, with fetchedAt inferred from the file time for older snapshots. */
export function readSnapshotState(dir: string): (SnapshotState & { fetchedAtApproximate?: boolean }) | null {
  const file = path.join(dir, "state.json");
  if (!existsSync(file)) return null;
  const state = JSON.parse(readFileSync(file, "utf8")) as SnapshotState;
  if (state.fetchedAt) return state;
  return { ...state, fetchedAt: statSync(file).mtime.toISOString(), fetchedAtApproximate: true };
}

/** Every study of a complete snapshot (unvalidated), in page order. */
export function readSnapshotStudies(dir: string): unknown[] {
  const files = readdirSync(dir)
    .filter((f) => /^page-\d{4}\.json$/.test(f))
    .sort();
  const all: unknown[] = [];
  for (const f of files) all.push(...(JSON.parse(readFileSync(path.join(dir, f), "utf8")) as unknown[]));
  return all;
}

export function readDataLock(file: string = DATA_LOCK_FILE): DataLock | null {
  if (!existsSync(file)) return null;
  return DataLockSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

/**
 * Which snapshot an ingest should read: an explicit `--snapshot`, else the lock file's snapshot (when present on
 * disk), else the newest directory under data/cache/snapshots, else the older location. Returns null when nothing
 * exists yet (the caller then fetches a new snapshot).
 */
export function resolveSnapshotDir(opts: { explicit?: string; lock?: DataLock | null } = {}): string | null {
  if (opts.explicit) return opts.explicit;
  if (opts.lock && existsSync(path.join(opts.lock.snapshot, "state.json"))) return opts.lock.snapshot;
  if (existsSync(SNAPSHOTS_DIR)) {
    const dirs = readdirSync(SNAPSHOTS_DIR)
      .filter((d) => existsSync(path.join(SNAPSHOTS_DIR, d, "state.json")))
      .sort();
    const last = dirs[dirs.length - 1];
    if (last) return path.join(SNAPSHOTS_DIR, last);
  }
  if (existsSync(path.join(LEGACY_SNAPSHOT_DIR, "state.json"))) return LEGACY_SNAPSHOT_DIR;
  return null;
}

/**
 * Content-hash data version: `<source>-<YYYYMMDD of the snapshot fetch>-<hash>` where the hash covers EVERY staged
 * output file (path + bytes, sorted) plus the on-disk format version. Any change to cards, sites, indexes, embeddings,
 * buckets or format produces a new version, so immutable shard URLs can never serve stale bytes.
 */
export function computeDataVersion(source: string, dataDate: string, files: Iterable<readonly [string, Uint8Array]>, formatVersion: number): string {
  const h = createHash("sha256");
  h.update(`format:${formatVersion}\0`);
  for (const [p, bytes] of [...files].sort((a, b) => a[0].localeCompare(b[0]))) h.update(p).update("\0").update(bytes).update("\0");
  return `${source}-${dataDate.replaceAll("-", "")}-${h.digest("hex").slice(0, 10)}`;
}

/** Local model files whose sha256 differs from the pinned value (or are missing). [] = all good. */
export function verifyModelFiles(dir: string, pinned: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];
  for (const [file, sha] of Object.entries(pinned)) {
    const p = path.join(dir, file);
    if (!existsSync(p)) problems.push(`${file}: missing`);
    else if (sha256Hex(readFileSync(p)) !== sha) problems.push(`${file}: sha256 mismatch`);
  }
  return problems;
}
