/**
 * Ingestion pipeline: `npm run ingest` (national, resumable) or `npm run ingest:seed` (committed seed).
 *
 * snapshot/load -> zod-validate -> build cards (groups, barriers, rule facts) -> embeddings (int8)
 * -> shards (cards, sites, MiniSearch index, embeddings per cancer group) -> ZIP tables
 * -> content-hash data version over every staged file -> validate -> atomically replace public/data,
 * write the backend's criteria copy (data/build) and, for national data, data/data-lock.json.
 *
 * Flags: `--source=seed|national` (default national), `--snapshot=<dir>` (read exactly these ClinicalTrials.gov pages),
 * `--refresh` (fetch a new snapshot into data/cache/snapshots/<stamp>/). Without either, the snapshot named in
 * data/data-lock.json is used (else the newest one, else the older cache), so a rebuild reproduces the dataset.
 *
 * Safety: aborts (keeping the last good dataset) if >5% of records fail validation or the trial
 * count drops >40% versus the previous dataset of the same source.
 */
import { mkdir, readFile, writeFile, rm, rename, stat, readdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import MiniSearch from "minisearch";
import { CTGOV_FIELDS, RawStudySchema } from "../../lib/ingest/raw";
import { buildRecord, embeddingText, NOT_CANCER, OUT_OF_SCOPE } from "../../lib/ingest/record";
import { MINISEARCH_OPTIONS, toSearchDoc, type SearchDoc } from "../../lib/match/minisearch-config";
import { qualifiedMarkerFact } from "../../lib/match/marker-qualifier";
import { ManifestSchema, MetaSchema, trialBucketKey, type LiteCard, type Manifest, type Meta, type ShardInfo, type Site, type TrialBucket, type TrialCard } from "../../lib/types/trial";
import { AccessDataSchema } from "../../lib/types/access";
import { aggregateAccess } from "../../lib/access/aggregate";
import { BASKET_SHARD_ID, CANCER_GROUP_IDS, basketAppliesTo, isBasketOnly, type CancerGroupId } from "../../config/cancer-groups";
import { DATA_FORMAT_VERSION, EMBEDDING_DIMS, EMBEDDING_MODEL, EMBEDDING_MODEL_FILES, EMBEDDING_MODEL_REVISION, INT8_SCALE, PIPELINE_VERSION, PROMPT_VERSION } from "../../config/embedding";
import { embeddingKey, embedTexts } from "./embed";
import { ingestAbortReason } from "../../lib/ingest/safety";
import { LLM_CACHE_FILE, readV2Cache, toTrialText, type LlmCacheEntry } from "./llm";
import { llmCacheKey, mergeFacts } from "../../lib/ingest/llm-facts";
import { applyLlmLayer, DEFAULT_VERIFY, familyCacheKey, LLM_FAMILY_IDS, LLM_LAYER_FAMILIES, type FamilyCacheEntry, type LlmFamily } from "../../lib/ingest/llm-families";
import { FAMILY_PRECISION } from "../../config/questionnaire/precision.generated";
import { fetchAllResumable, NATIONAL_QUERY } from "./ctgov";
import {
  computeDataVersion,
  DATA_LOCK_FILE,
  DataLockSchema,
  newSnapshotDir,
  readDataLock,
  readSnapshotState,
  resolveSnapshotDir,
  snapshotPageHashes,
  verifyModelFiles,
  type DataLock,
} from "../../lib/ingest/snapshot";

/** Output directory (override with INGEST_OUT for tests and CI). */
const OUT = process.env.INGEST_OUT ?? "public/data";
const TMP = `${OUT}.tmp`;
const BUILD = "data/build";
/** Split a group into parts above this many trials to keep each shard a few MB. */
const MAX_PER_SHARD = 700;
const ALL_SHARD = "_all";
/** Shards are staged under this name until the content hash (the data version) is known. */
const STAGING = "_staging";

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=") as [string, string | undefined]));
const source = (args.get("source") ?? "national") as "seed" | "national";

function fail(msg: string): never {
  console.error(`\nINGEST ABORTED: ${msg}\nThe previous dataset in ${OUT} was kept.`);
  process.exit(1);
}

async function loadZipTable(): Promise<Map<string, { lat: number; lon: number }>> {
  const text = await readFile("data/geo/zcta.csv", "utf8");
  const map = new Map<string, { lat: number; lon: number }>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [zip, lat, lon] = line.split(",");
    if (zip && lat && lon) map.set(zip, { lat: Number(lat), lon: Number(lon) });
  }
  return map;
}

interface RawInput {
  studies: unknown[];
  /** ISO time the records were fetched from ClinicalTrials.gov. */
  fetchedAt: string;
  fetchedAtApproximate: boolean;
  /** Snapshot directory (national only). */
  snapshotDir: string | null;
}

async function loadRaw(lock: DataLock | null): Promise<RawInput> {
  if (source === "seed") {
    const seed = JSON.parse(await readFile("data/seed/studies.json", "utf8")) as { studies: unknown[]; fetchedAt?: string };
    const st = await stat("data/seed/studies.json");
    return { studies: seed.studies, fetchedAt: seed.fetchedAt ?? st.mtime.toISOString(), fetchedAtApproximate: !seed.fetchedAt, snapshotDir: null };
  }
  const explicit = args.get("snapshot");
  const dir = args.has("refresh") ? newSnapshotDir() : (resolveSnapshotDir({ ...(explicit ? { explicit } : {}), lock }) ?? newSnapshotDir());
  console.log(`Snapshot: ${dir}${args.has("refresh") ? " (new fetch from ClinicalTrials.gov)" : ""}`);
  const studies = await fetchAllResumable(NATIONAL_QUERY, dir);
  const state = readSnapshotState(dir);
  if (!state?.fetchedAt) throw new Error(`snapshot ${dir} has no state`);
  return { studies, fetchedAt: state.fetchedAt, fetchedAtApproximate: state.fetchedAtApproximate === true, snapshotDir: dir };
}

async function previousMeta(): Promise<Meta | null> {
  try {
    return MetaSchema.parse(JSON.parse(await readFile(path.join(OUT, "meta.json"), "utf8")));
  } catch {
    return null;
  }
}

function quantize(vec: Float32Array): Int8Array {
  const q = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round((vec[i] ?? 0) * INT8_SCALE)));
  return q;
}

/** Every staged file written so far, for the content hash and the manifest byte counts. */
const staged = new Map<string, Uint8Array>();
async function writeStaged(file: string, data: Uint8Array | string): Promise<number> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  staged.set(path.relative(TMP, file).split(path.sep).join("/"), bytes);
  return bytes.byteLength;
}
const writeJson = (file: string, data: unknown) => writeStaged(file, JSON.stringify(data));

async function main(): Promise<void> {
  const t0 = Date.now();
  const modelDir = path.join("public/models", EMBEDDING_MODEL);
  const modelProblems = verifyModelFiles(modelDir, EMBEDDING_MODEL_FILES);
  if (modelProblems.length) fail(`embedding model files failed verification (${modelProblems.join("; ")}); run npm run models:fetch`);
  const lock = source === "national" ? readDataLock() : null;
  const raw = await loadRaw(lock);
  console.log(`Loaded ${raw.studies.length} raw studies (${source}; fetched ${raw.fetchedAt}${raw.fetchedAtApproximate ? ", approximate" : ""})`);

  // 1. Validate + build cards.
  const zips = await loadZipTable();
  const cards: TrialCard[] = [];
  const sitesById = new Map<string, Site[]>();
  const failures: string[] = [];
  let outOfScope = 0;
  const seen = new Set<string>();
  for (const r of raw.studies) {
    const parsed = RawStudySchema.safeParse(r);
    if (!parsed.success) {
      failures.push(`invalid record: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
      continue;
    }
    const built = buildRecord(parsed.data, (z) => zips.get(z));
    if (!built.ok) {
      // Out-of-scope (no recruiting U.S. site) is a normal skip, not a validation failure.
      if (built.reason === OUT_OF_SCOPE || built.reason === NOT_CANCER) outOfScope++;
      else failures.push(`${built.id}: ${built.reason}`);
      continue;
    }
    if (seen.has(built.card.id)) continue;
    seen.add(built.card.id);
    cards.push(built.card);
    sitesById.set(built.card.id, built.sites);
  }
  const invalidFraction = failures.length / Math.max(1, raw.studies.length);
  console.log(`Built ${cards.length} trials; ${outOfScope} out of scope (no recruiting U.S. site, or not a cancer trial); ${failures.length} failed validation (${(invalidFraction * 100).toFixed(1)}%)`);
  for (const f of failures.slice(0, 10)) console.log(`  skipped ${f}`);
  const prev = await previousMeta();
  const abort = ingestAbortReason({ rawCount: raw.studies.length, invalidCount: failures.length, builtCount: cards.length, previousCount: prev && prev.source === source ? prev.totalTrials : null });
  if (abort) fail(abort);
  cards.sort((a, b) => a.id.localeCompare(b.id));

  // Optional local-LLM layer: merge cached LLM facts (from `npm run ingest:llm`) for unchanged trials.
  let llmModel: string | null = null;
  try {
    const llmCache = JSON.parse(await readFile(LLM_CACHE_FILE, "utf8")) as Record<string, LlmCacheEntry>;
    let merged = 0;
    for (const c of cards) {
      const hit = llmCache[llmCacheKey(c.id, c.lastUpdated)];
      if (!hit) continue;
      c.facts = mergeFacts(c.facts, hit.facts);
      llmModel = hit.model;
      merged++;
    }
    if (merged) console.log(`Merged cached LLM facts for ${merged} trials (${llmModel})`);
  } catch {
    /* no LLM cache: rule layer only */
  }
  // v2 high-precision layer (`npm run ingest:llm`): verified LLM facts over the rule layer for LLM_LAYER_FAMILIES.
  // Families switched on by the verified layer (precision.generated.ts layer "llm") keep only verified directional
  // facts, also in trials the LLM has not processed yet.
  {
    const v2 = readV2Cache();
    const gated = new Set<LlmFamily>(LLM_LAYER_FAMILIES);
    const demote = new Set<LlmFamily>(LLM_LAYER_FAMILIES.filter((f) => {
      const p = FAMILY_PRECISION[f] as { passes?: boolean; layer?: string } | undefined;
      return p?.layer === "llm" && p.passes === true;
    }));
    let withLlm = 0;
    for (const c of cards) {
      const res: Partial<Record<LlmFamily, FamilyCacheEntry>> = {};
      for (const fam of LLM_FAMILY_IDS) {
        const e = v2.get(familyCacheKey(c.id, c.lastUpdated, fam));
        if (e) res[fam] = e;
      }
      if (Object.keys(res).length) {
        withLlm++;
        llmModel = Object.values(res)[0]?.model ?? llmModel;
      }
      c.facts = applyLlmLayer(toTrialText(c), c.facts, res, gated, DEFAULT_VERIFY, demote);
    }
    console.log(`LLM v2 layer [${[...gated].join(", ")}]: ${withLlm} trials with verified-LLM results; demoted when missing: [${[...demote].join(", ")}]`);
  }

  // 2. Embeddings, cached by NCT id + hash of the embedded text + model + dtype (older entries are adopted after a spot check).
  const vectors = await embedTexts(cards.map((c) => ({ key: embeddingKey(c.id, embeddingText(c)), text: embeddingText(c), legacyKey: `${c.id}|${c.lastUpdated}|${EMBEDDING_MODEL}` })), { label: "trials" });
  const quantized = new Map(cards.map((c, i) => [c.id, quantize(vectors[i] as Float32Array)]));

  // 3. Shards, staged under a placeholder name until the content hash is known.
  await rm(TMP, { recursive: true, force: true });
  staged.clear();
  const shards: ShardInfo[] = [];
  const groups: Manifest["groups"] = {};
  const stagingDir = path.join(TMP, "shards", STAGING);

  const writeShard = async (id: string, group: CancerGroupId, list: TrialCard[]) => {
    const dir = path.join(stagingDir, id);
    const index = new MiniSearch<SearchDoc>(MINISEARCH_OPTIONS);
    index.addAll(list.map(toSearchDoc));
    const emb = new Int8Array(list.length * EMBEDDING_DIMS);
    list.forEach((c, i) => emb.set(quantized.get(c.id) as Int8Array, i * EMBEDDING_DIMS));
    const sites: Record<string, Site[]> = {};
    for (const c of list) sites[c.id] = sitesById.get(c.id) ?? [];
    let bytes = 0;
    bytes += await writeJson(path.join(dir, "cards.json"), list);
    bytes += await writeJson(path.join(dir, "sites.json"), sites);
    bytes += await writeJson(path.join(dir, "index.json"), index.toJSON());
    bytes += await writeStaged(path.join(dir, "emb.bin"), new Uint8Array(emb.buffer));
    shards.push({ id, group, kind: "full", count: list.length, files: { cards: "cards.json", sites: "sites.json", index: "index.json", embeddings: "emb.bin" }, bytes });
  };

  for (const g of CANCER_GROUP_IDS) {
    const list = cards.filter((c) => c.groups.includes(g));
    if (list.length === 0) continue;
    const parts = Math.ceil(list.length / MAX_PER_SHARD);
    const per = Math.ceil(list.length / parts); // balanced parts
    const ids: string[] = [];
    for (let p = 0; p < parts; p++) {
      const id = parts === 1 ? g : `${g}-${p + 1}`;
      const part = list.slice(p * per, (p + 1) * per);
      await writeShard(id, g, part);
      ids.push(id);
    }
    groups[g] = ids;
  }
  // Basket-only shard: solid-tumor trials that name no specific cancer type are searched for every
  // solid-tumor group, so a lung patient also sees "advanced solid tumor" studies that allow NSCLC.
  {
    const basket = cards.filter((c) => isBasketOnly(c.groups));
    if (basket.length > 0) {
      await writeShard(BASKET_SHARD_ID, "solid-tumors", basket);
      for (const g of CANCER_GROUP_IDS) if (groups[g] && basketAppliesTo(g)) groups[g] = [...(groups[g] as string[]), BASKET_SHARD_ID];
    }
  }
  // Cross-group LITE index for "Other / not sure": no criteria text, summaries, contacts, or
  // site details; keyword index over title/conditions/MeSH only. Full cards for the final top
  // results come from the per-trial buckets below.
  {
    const dir = path.join(stagingDir, ALL_SHARD);
    const lite: LiteCard[] = cards.map((c) => ({
      id: c.id,
      title: c.title,
      conditions: c.conditions,
      groups: c.groups,
      minAge: c.minAge,
      maxAge: c.maxAge,
      // Directional, non-review facts only, as [key, value] or [key, value, param] (thresholds/carve-outs).
      // Lite facts carry no quote, so biomarker facts with qualifier wording ("other than EGFR") are left out
      // here; on full cards the pre-check skips them by their quote (lib/match/marker-qualifier.ts).
      f: c.facts.filter((x) => x.value !== "mentioned" && !x.needsReview && !qualifiedMarkerFact(x)).map((x): LiteCard["f"][number] => (x.param !== undefined ? [x.key, x.value, x.param] : [x.key, x.value])),
      ...(c.sex !== "ALL" ? { s: c.sex } : {}),
      b: [...new Set(c.barriers.map((x) => x.type))],
    }));
    const liteSites: Record<string, [number, number][]> = {};
    for (const c of cards) {
      const pts = new Set<string>();
      for (const s of sitesById.get(c.id) ?? []) if (s.lat !== undefined && s.lon !== undefined) pts.add(`${s.lat.toFixed(2)},${s.lon.toFixed(2)}`);
      liteSites[c.id] = [...pts].map((p) => p.split(",").map(Number) as [number, number]);
    }
    const index = new MiniSearch<SearchDoc>(MINISEARCH_OPTIONS);
    index.addAll(cards.map((c) => ({ ...toSearchDoc(c), summary: "", criteria: "" })));
    const emb = new Int8Array(cards.length * EMBEDDING_DIMS);
    cards.forEach((c, i) => emb.set(quantized.get(c.id) as Int8Array, i * EMBEDDING_DIMS));
    let bytes = 0;
    bytes += await writeJson(path.join(dir, "cards.json"), lite);
    bytes += await writeJson(path.join(dir, "sites.json"), liteSites);
    bytes += await writeJson(path.join(dir, "index.json"), index.toJSON());
    bytes += await writeStaged(path.join(dir, "emb.bin"), new Uint8Array(emb.buffer));
    shards.push({ id: ALL_SHARD, group: "other", kind: "lite", count: cards.length, files: { cards: "cards.json", sites: "sites.json", index: "index.json", embeddings: "emb.bin" }, bytes });
  }

  // Per-trial buckets (last 3 digits of the NCT ID): trial detail page + "not sure" top results.
  const buckets = new Map<string, TrialBucket>();
  for (const c of cards) {
    const k = trialBucketKey(c.id);
    const b = buckets.get(k) ?? {};
    b[c.id] = { card: c, sites: sitesById.get(c.id) ?? [] };
    buckets.set(k, b);
  }
  for (const [k, b] of buckets) await writeJson(path.join(stagingDir, "trials", `${k}.json`), b);

  // 4. ZIP tables by 3-digit prefix (loaded on demand by the browser).
  const byPrefix = new Map<string, Record<string, [number, number]>>();
  for (const [zip, c] of zips) {
    const p = zip.slice(0, 3);
    const rec = byPrefix.get(p) ?? {};
    rec[zip] = [c.lat, c.lon];
    byPrefix.set(p, rec);
  }
  for (const [p, rec] of byPrefix) await writeJson(path.join(TMP, "zip", `${p}.json`), rec);

  // 5. Data version = hash of every staged file + the format version; dataDate = the snapshot's fetch date.
  // access.json, manifest.json and meta.json are derived from these files and the version, so they are written after.
  const dataDate = raw.fetchedAt.slice(0, 10);
  const dataVersion = computeDataVersion(source, dataDate, staged, DATA_FORMAT_VERSION);
  await rename(stagingDir, path.join(TMP, "shards", dataVersion));

  // Access Intelligence aggregates (public).
  await writeJson(path.join(TMP, "access.json"), AccessDataSchema.parse(aggregateAccess(cards, sitesById, dataDate, dataVersion)));

  // 6. Manifest, meta.
  const manifest: Manifest = {
    dataVersion,
    shardBase: `/data/shards/${dataVersion}`,
    embedding: { model: EMBEDDING_MODEL, dims: EMBEDDING_DIMS, quantization: "int8", scale: INT8_SCALE },
    groups,
    shards,
    allShard: ALL_SHARD,
    trialBase: `/data/shards/${dataVersion}/trials`,
  };
  const countsByGroup: Meta["countsByGroup"] = {};
  for (const g of CANCER_GROUP_IDS) {
    const n = cards.filter((c) => c.groups.includes(g)).length;
    if (n) countsByGroup[g] = n;
  }
  const meta: Meta = {
    dataDate,
    dataVersion,
    source,
    totalTrials: cards.length,
    countsByGroup,
    statesCovered: new Set(cards.flatMap((c) => c.states)).size,
    embeddingModel: EMBEDDING_MODEL,
    llmModel,
    pipelineVersion: PIPELINE_VERSION,
    promptVersion: PROMPT_VERSION,
  };
  await writeJson(path.join(TMP, "manifest.json"), ManifestSchema.parse(manifest));
  await writeJson(path.join(TMP, "meta.json"), MetaSchema.parse(meta));

  // 7. Validate output, then atomically swap directories.
  for (const s of shards) {
    for (const f of Object.values(s.files)) {
      const st = await stat(path.join(TMP, "shards", dataVersion, s.id, f)).catch(() => null);
      if (!st || st.size === 0) fail(`missing shard file ${s.id}/${f}`);
    }
  }
  const old = `${OUT}.old`;
  await rm(old, { recursive: true, force: true });
  await rename(OUT, old).catch(() => undefined);
  await rename(TMP, OUT);
  await rm(old, { recursive: true, force: true });

  // 8. Backend copy of trial criteria (the API never trusts trial text from the browser).
  await mkdir(BUILD, { recursive: true });
  const serverTrials = Object.fromEntries(
    cards.map((c) => [c.id, { id: c.id, title: c.title, summary: c.summary, inclusion: c.inclusion, exclusion: c.exclusion, minAge: c.minAge, maxAge: c.maxAge, groups: c.groups, facts: c.facts, barriers: c.barriers, lastUpdated: c.lastUpdated, criteria: c.criteria, criteriaVersion: c.criteriaVersion }]),
  );
  await writeFile(path.join(BUILD, "criteria.json"), JSON.stringify({ dataVersion, trials: serverTrials }));
  const esc = (s: string) => s.replaceAll("'", "''");
  const sql = [
    "DELETE FROM trials;",
    ...Object.values(serverTrials).map((t) => `INSERT INTO trials (nct_id, data_version, payload) VALUES ('${t.id}', '${esc(dataVersion)}', '${esc(JSON.stringify(t))}');`),
  ].join("\n");
  await writeFile(path.join(BUILD, "criteria.sql"), sql);

  // 9. Lock file (national): the exact inputs that produced this dataset.
  if (source === "national" && raw.snapshotDir) {
    const lockOut: DataLock = DataLockSchema.parse({
      lockVersion: 1,
      source,
      snapshot: raw.snapshotDir.split(path.sep).join("/"),
      query: NATIONAL_QUERY,
      fields: CTGOV_FIELDS,
      fetchedAt: raw.fetchedAt,
      ...(raw.fetchedAtApproximate ? { fetchedAtApproximate: true } : {}),
      pages: snapshotPageHashes(raw.snapshotDir),
      model: { id: EMBEDDING_MODEL, revision: EMBEDDING_MODEL_REVISION, files: EMBEDDING_MODEL_FILES },
      pipelineVersion: PIPELINE_VERSION,
      formatVersion: DATA_FORMAT_VERSION,
      dataVersion,
      totalTrials: cards.length,
    });
    await writeFile(DATA_LOCK_FILE, `${JSON.stringify(lockOut, null, 1)}\n`);
    console.log(`Wrote ${DATA_LOCK_FILE} (${lockOut.pages.length} pages, snapshot ${lockOut.snapshot})`);
  }

  // 10. Report.
  console.log(`\nData version ${dataVersion}: ${cards.length} trials, ${meta.statesCovered} states, ${shards.length} shards`);
  const sizes: Record<string, { trials: number; raw: number; gzip: number }> = {};
  for (const s of shards) {
    const dir = path.join(OUT, "shards", dataVersion, s.id);
    let gz = 0;
    for (const f of await readdir(dir)) gz += gzipSync(await readFile(path.join(dir, f))).byteLength;
    sizes[s.id] = { trials: s.count, raw: s.bytes, gzip: gz };
    console.log(`  ${s.id.padEnd(18)} ${String(s.count).padStart(5)} trials  ${(s.bytes / 1024).toFixed(0).padStart(6)} KB raw  ${(gz / 1024).toFixed(0).padStart(5)} KB gzip`);
  }
  const bucketDir = path.join(OUT, "shards", dataVersion, "trials");
  let maxBucketGz = 0;
  for (const f of await readdir(bucketDir)) maxBucketGz = Math.max(maxBucketGz, gzipSync(await readFile(path.join(bucketDir, f))).byteLength);
  const accessGz = gzipSync(await readFile(path.join(OUT, "access.json"))).byteLength;
  console.log(`  trial buckets: ${buckets.size} files, largest ${(maxBucketGz / 1024).toFixed(0)} KB gzip; access.json ${(accessGz / 1024).toFixed(0)} KB gzip`);
  await writeFile(path.join(BUILD, "shard-sizes.json"), JSON.stringify({ dataVersion, totalTrials: cards.length, skipped: failures.length, shards: sizes, buckets: buckets.size, maxBucketGzip: maxBucketGz, accessGzip: accessGz }));
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
