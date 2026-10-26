/**
 * v7: add the current pipeline to the vignette pool WITHOUT touching the frozen baselines:
 * `npx tsx scripts/eval/vignettes/add-pipeline.ts --tag=v7`.
 * Stores two rankings per vignette in eval/gold/vignettes-pool-v1.json: `pipeline:<tag>` (rankTrials order) and
 * `pipeline:<tag>+resolver` (its top TOP_N re-ranked by the deterministic per-criterion resolver, Tier A first, the rest
 * unchanged: what the app shows before the AI judge answers). bm25/vector/ctgov and earlier pipeline tags are kept as is.
 * Trials these systems surface that were never pooled are unjudged; run.ts counts them non-relevant, so the script prints
 * how much of each new top 10 is judged.
 */
import { writeFileSync } from "node:fs";
import { resolveRanking } from "../../../lib/match/criteria-rank";
import { TOP_N } from "../../../lib/match/rank";
import { loadNational } from "../national";
import { readVignettes } from "./files";
import { POOL_FILE, STORED_K, readPool } from "./pool";
import { pipelineRanking, queryVectors, vignetteContexts } from "./systems";

async function main(): Promise<void> {
  const tag = process.argv.find((a) => a.startsWith("--tag="))?.slice(6);
  if (!tag) throw new Error("usage: add-pipeline.ts --tag=<tag>");
  const pool = readPool();
  if (!pool) throw new Error(`${POOL_FILE} missing`);
  const national = loadNational();
  if (!national) throw new Error("national data not found");
  const ctxs = vignetteContexts(readVignettes(), national);
  const qs = await queryVectors(ctxs);
  const judgedTop10: number[][] = [[], []];
  ctxs.forEach((ctx, i) => {
    const vid = ctx.vignette.id;
    const ids = pipelineRanking(ctx, qs[i] as Float32Array, STORED_K);
    const byId = new Map(ctx.candidates.map((c) => [c.card.id, c] as const));
    const head = ids.slice(0, TOP_N).map((id) => byId.get(id)!);
    const reranked = [...resolveRanking(head, ctx.answers, ctx.catalog).order, ...ids.slice(TOP_N)];
    const r = (pool.rankings[vid] ??= {});
    r[`pipeline:${tag}`] = ids;
    r[`pipeline:${tag}+resolver`] = reranked;
    const pooled = new Set(Object.entries(r).filter(([k]) => !k.startsWith(`pipeline:${tag}`)).flatMap(([, v]) => v.slice(0, 20)));
    judgedTop10[0]!.push(ids.slice(0, 10).filter((id) => pooled.has(id)).length / Math.max(1, Math.min(10, ids.length)));
    judgedTop10[1]!.push(reranked.slice(0, 10).filter((id) => pooled.has(id)).length / Math.max(1, Math.min(10, reranked.length)));
  });
  writeFileSync(POOL_FILE, `${JSON.stringify(pool, null, 0)}\n`);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  console.log(`${POOL_FILE}: added pipeline:${tag} and pipeline:${tag}+resolver for ${ctxs.length} vignettes; top 10 already pooled (judged): ${(100 * mean(judgedTop10[0]!)).toFixed(1)}% / ${(100 * mean(judgedTop10[1]!)).toFixed(1)}%`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
