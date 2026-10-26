/**
 * Pool the systems' rankings for the vignette benchmark: `npx tsx scripts/eval/vignettes/pool.ts --tag=v4`.
 * Writes/updates eval/gold/vignettes-pool-v1.json: per vignette, the top-50 of bm25, vector, ctgov and the pipeline
 * under the given tag (pipeline rankings are kept per tag so v4 stays frozen when v5 is added). The judging pool is the
 * union of every system's top POOL_K (see judge-packets.ts). Requires national data in public/data (or NATIONAL_DIR).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadNational } from "../national";
import { ctgovRankings } from "./ctgov";
import { readVignettes } from "./files";
import { bm25Ranking, pipelineRanking, queryVectors, vectorRanking, vignetteContexts } from "./systems";

export const POOL_FILE = "eval/gold/vignettes-pool-v1.json";
export const POOL_K = 20;
export const STORED_K = 50;

export interface PoolFile {
  schema: 1;
  note: string;
  dataVersion: string;
  /** vignette id -> system id (bm25 | vector | ctgov | pipeline:<tag>) -> top STORED_K NCT ids. */
  rankings: Record<string, Record<string, string[]>>;
  /** vignette id -> hard-filtered candidate count. */
  candidates: Record<string, number>;
}

export function readPool(): PoolFile | null {
  return existsSync(POOL_FILE) ? (JSON.parse(readFileSync(POOL_FILE, "utf8")) as PoolFile) : null;
}

/** The judging pool of one vignette: the union of every stored system's top POOL_K, in a stable order. */
export function judgingPool(pool: PoolFile, vid: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ids of Object.values(pool.rankings[vid] ?? {})) for (const id of ids.slice(0, POOL_K)) if (!seen.has(id)) {
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function main(): Promise<void> {
  const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=") as [string, string | undefined]));
  const tag = args.get("tag");
  if (!tag) throw new Error("usage: pool.ts --tag=<pipeline tag, e.g. v4> [--no-ctgov]");
  const national = loadNational();
  if (!national) throw new Error("national data not found (public/data or NATIONAL_DIR)");
  const vignettes = readVignettes();
  const ctxs = vignetteContexts(vignettes, national);
  const qs = await queryVectors(ctxs);
  const prev = readPool();
  const pool: PoolFile = {
    schema: 1,
    note: "Pooled system rankings (top 50 per system) for the vignette benchmark. Pipeline rankings are frozen per tag; bm25/vector/ctgov are shared baselines. Regenerate with scripts/eval/vignettes/pool.ts.",
    dataVersion: national.manifest.dataVersion,
    rankings: prev?.rankings ?? {},
    candidates: prev?.candidates ?? {},
  };
  const ctgov = args.has("no-ctgov") ? null : await ctgovRankings(ctxs);
  ctxs.forEach((ctx, i) => {
    const vid = ctx.vignette.id;
    const r = (pool.rankings[vid] ??= {});
    const q = qs[i] as Float32Array;
    r.bm25 = bm25Ranking(ctx).slice(0, STORED_K);
    r.vector = vectorRanking(ctx, q).slice(0, STORED_K);
    r[`pipeline:${tag}`] = pipelineRanking(ctx, q, STORED_K);
    const c = ctgov?.get(vid);
    if (c) r.ctgov = c.slice(0, STORED_K);
    pool.candidates[vid] = ctx.candidates.length;
  });
  writeFileSync(POOL_FILE, `${JSON.stringify(pool, null, 0)}\n`);
  const sizes = vignettes.map((v) => judgingPool(pool, v.id).length);
  const mean = sizes.reduce((a, b) => a + b, 0) / Math.max(1, sizes.length);
  console.log(`${POOL_FILE}: ${vignettes.length} vignettes, tag ${tag}; judging pool mean ${mean.toFixed(1)} trials (total ${sizes.reduce((a, b) => a + b, 0)}), candidates median ${[...Object.values(pool.candidates)].sort((a, b) => a - b)[Math.floor(vignettes.length / 2)]}`);
}

if (process.argv[1]?.endsWith("pool.ts")) main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
