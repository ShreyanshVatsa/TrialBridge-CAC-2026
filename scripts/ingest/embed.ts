/**
 * Node-side embeddings with Transformers.js, using the self-hosted model in public/models
 * (identical weights to the browser). Results are cached on disk by key
 * `<id>|sha1(text)|<model>|<dtype>`, so a vector is reused only while the embedded text itself is unchanged.
 *
 * Older caches were keyed `<id>|<lastUpdated>|<model>`; `legacyKey` lets a caller adopt such an entry. Adopted
 * entries are spot-checked by re-embedding a sample: if any differs, the whole legacy set is re-embedded.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { EMBEDDING_DIMS, EMBEDDING_DTYPE, EMBEDDING_MODEL } from "../../config/embedding";
import { cosineSimilarity } from "../../lib/match/cosine";

const CACHE_FILE = "data/cache/embeddings.json";
const BATCH = 32;
const LEGACY_CHECK_SAMPLE = 24;
const LEGACY_MIN_COSINE = 0.995;

export const textHash = (text: string): string => createHash("sha1").update(text).digest("hex").slice(0, 16);
/** Cache key for one embedded text. */
export const embeddingKey = (id: string, text: string, model: string = EMBEDDING_MODEL, dtype: string = EMBEDDING_DTYPE): string => `${id}|${textHash(text)}|${model}|${dtype}`;

export interface EmbedItem {
  key: string;
  text: string;
  /** Older cache key to adopt when `key` is missing. */
  legacyKey?: string;
}

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    env.localModelPath = path.resolve("public/models") + "/";
    env.allowRemoteModels = false;
    extractorPromise = pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: EMBEDDING_DTYPE }) as Promise<FeatureExtractionPipeline>;
  }
  return extractorPromise;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const extractor = await getExtractor();
  const out = await extractor(texts, { pooling: "mean", normalize: true });
  const data = out.data as Float32Array;
  // Round to 5 decimals to keep the cache compact; int8 quantization happens later anyway.
  return texts.map((_, j) => Array.from(data.subarray(j * EMBEDDING_DIMS, (j + 1) * EMBEDDING_DIMS), (v) => Math.round(v * 1e5) / 1e5));
}

export async function embedTexts(items: EmbedItem[], opts: { label?: string } = {}): Promise<Float32Array[]> {
  let cache: Record<string, number[]> = {};
  try {
    cache = JSON.parse(await readFile(CACHE_FILE, "utf8")) as Record<string, number[]>;
  } catch {
    /* empty cache */
  }
  let dirty = false;
  // Adopt legacy entries, then verify a sample of them against fresh embeddings.
  const adopted = items.filter((i) => !cache[i.key] && i.legacyKey && cache[i.legacyKey]);
  if (adopted.length) {
    const step = Math.max(1, Math.floor(adopted.length / LEGACY_CHECK_SAMPLE));
    const sample = adopted.filter((_, i) => i % step === 0).slice(0, LEGACY_CHECK_SAMPLE);
    const fresh = await embedBatch(sample.map((s) => s.text));
    const worst = Math.min(...sample.map((s, i) => cosineSimilarity(Float32Array.from(fresh[i] as number[]), Float32Array.from(cache[s.legacyKey as string] as number[]))));
    if (worst >= LEGACY_MIN_COSINE) {
      for (const a of adopted) cache[a.key] = cache[a.legacyKey as string] as number[];
      dirty = true;
      console.log(`  embeddings: adopted ${adopted.length} cached vectors from the previous cache key (sample of ${sample.length} re-embedded, min cosine ${worst.toFixed(4)})`);
    } else console.log(`  embeddings: previous cache differs (min cosine ${worst.toFixed(4)}); re-embedding ${adopted.length} texts`);
  }
  // Longest texts last: batches of similar length waste far less compute on padding.
  const todo = items.filter((i) => !cache[i.key]).sort((a, b) => a.text.length - b.text.length);
  if (todo.length) {
    const t0 = Date.now();
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      const vecs = await embedBatch(batch.map((b) => b.text));
      batch.forEach((b, j) => (cache[b.key] = vecs[j] as number[]));
      const done = Math.min(i + BATCH, todo.length);
      const rate = done / ((Date.now() - t0) / 1000);
      process.stdout.write(`\r  embedded ${opts.label ?? ""} ${done}/${todo.length} (${rate.toFixed(1)}/s, ~${Math.round((todo.length - done) / rate)}s left)   `);
    }
    process.stdout.write("\n");
    dirty = true;
  } else if (!adopted.length) console.log(`  embeddings${opts.label ? ` (${opts.label})` : ""}: all cached`);
  if (dirty) {
    await mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(cache));
  }
  return items.map((i) => Float32Array.from(cache[i.key] as number[]));
}
