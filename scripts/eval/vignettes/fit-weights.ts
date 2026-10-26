/**
 * Cross-validated re-fit of the fusion weights (lib/match/fusion-weights.json) on the vignette DEV split only:
 *   npx tsx scripts/eval/vignettes/fit-weights.ts [--folds=10] [--free=kw,vec,cosine,bm25,penalty,bonus,subtypeMatch,subtypeConflict,basket,weakGroup]
 * Each vignette is one ranking problem: the hard-filtered candidates' feature rows (computed by rankTrials, independent
 * of the weights) and the graded gold gains. Reports the shipped weights' mean nDCG@10 of the retrieval order, the
 * k-fold cross-validated nDCG@10 of fitWeights (each fold scored with weights fit on the other folds), and the weights
 * fit on the whole dev split. Unpooled trials count as non-relevant (eval/gold/README.md), so a fit that reorders
 * towards unpooled trials is under-credited; adopt a refit only when the CV gain is clear and TREC dev agrees.
 */
import { readFileSync } from "node:fs";
import { FACT_POLICY } from "../../../config/questionnaire";
import { FUSION_WEIGHTS, type Features, type FusionWeights } from "../../../lib/match/fusion";
import { rankTrials } from "../../../lib/match/rank";
import { bootstrapCi, crossValidate, fitWeights, meanNdcg, pairedBootstrapCi, perQueryNdcg, type FitQuery } from "../fusion-fit";
import { loadNational } from "../national";
import type { GoldFile } from "./build-gold";
import { GOLD_FILE } from "./build-gold";
import { readVignettes } from "./files";
import { GAIN, type Label } from "./judge-prompt";
import { bm25Ranking, queryVectors, vignetteContexts } from "./systems";

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=") as [string, string | undefined]));
const folds = Number(args.get("folds") ?? 10);
const free = (args.get("free") ?? "kw,vec,cosine,bm25,penalty,bonus,subtypeMatch,subtypeConflict,basket,weakGroup").split(",") as (keyof Features)[];

async function main(): Promise<void> {
  const national = loadNational();
  if (!national) throw new Error("national data not found");
  const gold = JSON.parse(readFileSync(GOLD_FILE, "utf8")) as GoldFile;
  const vignettes = readVignettes(undefined, "dev").filter((v) => gold.vignettes[v.id]);
  const ctxs = vignetteContexts(vignettes, national);
  const qs = await queryVectors(ctxs);
  const queries: FitQuery[] = ctxs.map((ctx, i) => {
    const out = rankTrials({ entries: ctx.candidates, answers: ctx.answers, origin: ctx.origin, keywordSearch: () => bm25Ranking(ctx), queryVector: qs[i] as Float32Array, catalog: ctx.catalog, policy: FACT_POLICY, limit: ctx.candidates.length });
    const gains: Record<string, number> = {};
    for (const [id, p] of Object.entries(gold.vignettes[ctx.vignette.id] ?? {})) gains[id] = GAIN[p.l as Label];
    return { id: ctx.vignette.id, rows: out.results.map((r) => ({ id: r.card.id, f: r.scores.features as Features })), gains };
  });
  const shipped = perQueryNdcg(queries, FUSION_WEIGHTS);
  const cv = crossValidate(queries, { free }, folds);
  const full = fitWeights(queries, { free });
  const fmt = (c: { mean: number; lo: number; hi: number }) => `${c.mean.toFixed(3)} [${c.lo.toFixed(3)}, ${c.hi.toFixed(3)}]`;
  console.log(`vignette dev, ${queries.length} ranking problems, free features: ${free.join(", ")}`);
  console.log(`shipped weights: retrieval-order nDCG@10 ${fmt(bootstrapCi(shipped))}`);
  console.log(`${folds}-fold CV refit:  retrieval-order nDCG@10 ${fmt(bootstrapCi(cv.perQuery))}; paired CV - shipped ${fmt(pairedBootstrapCi(cv.perQuery, shipped))}`);
  console.log(`fit on all dev (in-sample, optimistic): ${meanNdcg(queries, full).toFixed(3)}`);
  console.log("weights fit on all dev:", JSON.stringify(full));
  console.log("per-fold weights:", cv.weights.map((w: FusionWeights) => JSON.stringify(Object.fromEntries(Object.entries(w).filter(([k, v]) => v !== (FUSION_WEIGHTS as Record<string, number>)[k])))).join("\n  "));
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
