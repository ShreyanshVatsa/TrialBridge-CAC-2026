/**
 * Score the CURRENT pipeline code on the vignette benchmark without touching the frozen pool file:
 *   npx tsx scripts/eval/vignettes/live.ts [--split=dev] [--pool=15] [--ref=pipeline:v7+resolver] [--json]
 * Re-runs rankTrials over each vignette's hard-filtered candidates, re-ranks the top `--pool` by the deterministic
 * resolver (what the app shows before the judge answers) and reports, with bootstrap 95% CIs: graded nDCG@10 over all
 * vignettes (no relevant trial scores 0, ceiling = share with one) and over the vignettes with a relevant trial (TREC
 * convention, the v9 headline), binary nDCG, hit@10/@50, P@10 and its ceiling, recall, excluded and unjudged share in the
 * top 10, the condensed (judged-only) nDCG, Tier B demotion precision, and the paired delta against a stored system
 * (default: the v8 resolver ranking). Unpooled trials count as non-relevant, so a
 * change that surfaces new trials is under-credited (eval/gold/README.md). The test split needs --split=test and is for
 * the final report only.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolveRanking } from "../../../lib/match/criteria-rank";
import { TOP_N } from "../../../lib/match/rank";
import { loadNational } from "../national";
import type { GoldFile } from "./build-gold";
import { GOLD_FILE } from "./build-gold";
import { readVignettes } from "./files";
import { binaryNdcgAtK, bootstrapCI, condensed, excludedShareAtK, hasRelevant, hitAtK, mean, ndcgAtK, precisionCeilingAtK, precisionRelevantAtK, recallEligibleAtK, recallRelevantAtK, unjudgedShareAtK, type Interval, type VignetteLabels } from "./metrics";
import { readPool, STORED_K } from "./pool";
import { pipelineRanking, queryVectors, vignetteContexts } from "./systems";

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=") as [string, string | undefined]));
const split = (args.get("split") ?? "dev") as "dev" | "test";
if (split !== "dev" && split !== "test") throw new Error("--split must be dev or test");
const pool = Number(args.get("pool") ?? TOP_N);
const ref = args.get("ref") ?? "pipeline:v8+resolver";
/** --audit: per hard-failure key, how the gold labels the Tier B trials of the re-ranked pool (precision of the resolver's demotions). */
const audit = args.has("audit");
const auditRows: Record<string, Record<string, number>> = {};
const auditExamples: string[] = [];

async function main(): Promise<void> {
  const national = loadNational();
  if (!national) throw new Error("national data not found");
  const stored = readPool();
  if (!stored) throw new Error("pool missing");
  const gold = JSON.parse(readFileSync(GOLD_FILE, "utf8")) as GoldFile;
  const vignettes = readVignettes(undefined, split, args.get("answers")).filter((v) => gold.vignettes[v.id]);
  const ctxs = vignetteContexts(vignettes, national);
  const qs = await queryVectors(ctxs);
  const keys = ["ndcg", "recall", "excl", "refNdcg", "refExcl", "retrievalNdcg", "pooled", "ndcgRel", "refNdcgRel", "binary", "binaryRel", "eligibleOnly", "hit10", "hit50", "p10", "p10Ceiling", "recallRel10", "recallRel15", "recallRel50", "unjudged10", "condensedNdcg", "condensedNdcgRel"] as const;
  const per = Object.fromEntries(keys.map((k) => [k, [] as number[]])) as Record<(typeof keys)[number], number[]>;
  const tierB = { eligible: 0, possibly: 0, excluded: 0, not_relevant: 0, unjudged: 0 };
  ctxs.forEach((ctx, i) => {
    const v = ctx.vignette;
    const labels = Object.fromEntries(Object.entries(gold.vignettes[v.id] ?? {}).map(([id, p]) => [id, p.l])) as VignetteLabels;
    const ids = pipelineRanking(ctx, qs[i] as Float32Array, STORED_K);
    const byId = new Map(ctx.candidates.map((c) => [c.card.id, c] as const));
    const head = ids.slice(0, pool).map((id) => byId.get(id)!);
    const ranking = resolveRanking(head, ctx.answers, ctx.catalog);
    const ranked = [...ranking.order, ...ids.slice(pool)];
    if (audit) {
      for (const [id, t] of Object.entries(ranking.byTrial)) {
        if (t.score.tier !== "B") continue;
        const g = labels[id] ?? "unjudged";
        for (const f of t.score.hardFailures) {
          const key = (f.reason ?? "").slice(0, 40);
          (auditRows[key] ??= {})[g] = (auditRows[key]?.[g] ?? 0) + 1;
          if ((g === "eligible" || g === "possibly") && auditExamples.length < 40) auditExamples.push(`${v.id} ${id} ${g} ${f.id}: ${(byId.get(id)?.card.criteria ?? []).find((c) => c.id === f.id)?.text.slice(0, 200) ?? ""}`);
        }
      }
    }
    for (const [id, t] of Object.entries(ranking.byTrial)) if (t.score.tier === "B") tierB[(labels[id] ?? "unjudged") as keyof typeof tierB]++;
    const rel = hasRelevant(labels);
    const relOnly = (x: number) => (rel ? x : Number.NaN);
    const nd = ndcgAtK(ranked, labels, 10);
    per.ndcg.push(nd);
    per.ndcgRel.push(relOnly(nd));
    per.binary.push(rel ? binaryNdcgAtK(ranked, labels, 10) : 0);
    per.binaryRel.push(binaryNdcgAtK(ranked, labels, 10));
    per.eligibleOnly.push(binaryNdcgAtK(ranked, labels, 10, true));
    per.hit10.push(hitAtK(ranked, labels, 10));
    per.hit50.push(hitAtK(ranked, labels, 50));
    per.p10.push(relOnly(precisionRelevantAtK(ranked, labels, 10)));
    per.p10Ceiling.push(precisionCeilingAtK(labels, 10));
    per.recallRel10.push(recallRelevantAtK(ranked, labels, 10));
    per.recallRel15.push(recallRelevantAtK(ranked, labels, 15));
    per.recallRel50.push(recallRelevantAtK(ranked, labels, 50));
    per.unjudged10.push(unjudgedShareAtK(ranked, labels, 10));
    const cn = ndcgAtK(condensed(ranked, labels), labels, 10);
    per.condensedNdcg.push(cn);
    per.condensedNdcgRel.push(relOnly(cn));
    per.recall.push(recallEligibleAtK(ranked, labels, 50));
    per.excl.push(excludedShareAtK(ranked, labels, 10));
    per.retrievalNdcg.push(ndcgAtK(ids, labels, 10));
    const r = stored.rankings[v.id]?.[ref] ?? [];
    per.refNdcg.push(ndcgAtK(r, labels, 10));
    per.refNdcgRel.push(relOnly(ndcgAtK(r, labels, 10)));
    per.refExcl.push(excludedShareAtK(r, labels, 10));
    per.pooled.push(ranked.slice(0, 10).filter((id) => labels[id] !== undefined).length / Math.max(1, Math.min(10, ranked.length)));
  });
  const f = (x: number) => (Number.isNaN(x) ? "n/a" : x.toFixed(3));
  const ci = (x: Interval) => `${f(x.mean)} [${f(x.lo)}, ${f(x.hi)}]`;
  const d = (x: Interval) => `${x.mean >= 0 ? "+" : ""}${x.mean.toFixed(3)} [${x.lo.toFixed(3)}, ${x.hi.toFixed(3)}]`;
  const out = {
    split,
    vignettes: ctxs.length,
    pool,
    ref,
    ndcg10: bootstrapCI(per.ndcg),
    recall50: bootstrapCI(per.recall),
    excludedTop10: bootstrapCI(per.excl),
    retrievalOnlyNdcg10: bootstrapCI(per.retrievalNdcg),
    refNdcg10: bootstrapCI(per.refNdcg),
    dNdcgVsRef: bootstrapCI(per.ndcg, per.refNdcg),
    dExclVsRef: bootstrapCI(per.excl, per.refExcl),
    top10Judged: bootstrapCI(per.pooled),
    withRelevant: per.ndcgRel.filter((x) => !Number.isNaN(x)).length,
    ceilingAll: per.ndcgRel.filter((x) => !Number.isNaN(x)).length / ctxs.length,
    ndcg10Relevant: bootstrapCI(per.ndcgRel),
    dNdcgRelVsRef: bootstrapCI(per.ndcgRel, per.refNdcgRel),
    binaryNdcg10: bootstrapCI(per.binary),
    binaryNdcg10Relevant: bootstrapCI(per.binaryRel),
    eligibleOnlyNdcg10: bootstrapCI(per.eligibleOnly),
    hit10: bootstrapCI(per.hit10),
    hit50: bootstrapCI(per.hit50),
    p10Relevant: bootstrapCI(per.p10),
    p10Ceiling: mean(per.p10Ceiling),
    recallRelevant: { at10: bootstrapCI(per.recallRel10), at15: bootstrapCI(per.recallRel15), at50: bootstrapCI(per.recallRel50) },
    unjudgedTop10: bootstrapCI(per.unjudged10),
    condensedNdcg10: bootstrapCI(per.condensedNdcg),
    condensedNdcg10Relevant: bootstrapCI(per.condensedNdcgRel),
    tierB: { ...tierB, precision: (tierB.excluded + tierB.not_relevant) / Math.max(1, tierB.excluded + tierB.not_relevant + tierB.eligible + tierB.possibly) },
  };
  if (args.has("json")) {
    console.log(JSON.stringify(out, null, 1));
    return;
  }
  const dump = args.get("dump");
  if (dump) writeFileSync(dump, JSON.stringify({ ids: ctxs.map((c) => c.vignette.id), ...per }));
  if (audit) {
    console.log("Tier B hard failures in the re-ranked pool, by reason -> gold label:");
    for (const [k, v] of Object.entries(auditRows)) console.log(`  ${k.padEnd(42)} ${JSON.stringify(v)}`);
    console.log("wrong demotions (gold eligible/possibly):");
    for (const e of auditExamples) console.log("  - " + e);
  }
  console.log(`live pipeline+resolver, ${split} split, ${ctxs.length} vignettes, resolver pool ${pool}`);
  console.log(`nDCG@10 ${ci(out.ndcg10)}  recall@50 elig ${ci(out.recall50)}  excluded in top10 ${ci(out.excludedTop10)}  (retrieval only: nDCG@10 ${ci(out.retrievalOnlyNdcg10)})`);
  console.log(`vs ${ref} (nDCG@10 ${ci(out.refNdcg10)}): dNDCG ${d(out.dNdcgVsRef)}, dExcluded ${d(out.dExclVsRef)}; top-10 judged share ${f(out.top10Judged.mean)}`);
  console.log(`relevant-only (${out.withRelevant} of ${ctxs.length} have a relevant trial; all-vignette ceiling ${f(out.ceilingAll)}): nDCG@10 ${ci(out.ndcg10Relevant)}, dNDCG vs ref ${d(out.dNdcgRelVsRef)}`);
  console.log(`binary nDCG@10 all ${ci(out.binaryNdcg10)}, relevant-only ${ci(out.binaryNdcg10Relevant)}; eligible-only ${ci(out.eligibleOnlyNdcg10)} (n=${out.eligibleOnlyNdcg10.n})`);
  console.log(`hit@10 ${ci(out.hit10)}  hit@50 ${ci(out.hit50)}  P@10 relevant ${ci(out.p10Relevant)} (ceiling ${f(out.p10Ceiling)})`);
  console.log(`recall of relevant (per-vignette mean) @10 ${ci(out.recallRelevant.at10)} @15 ${ci(out.recallRelevant.at15)} @50 ${ci(out.recallRelevant.at50)}`);
  console.log(`pooling: unjudged share of top 10 ${ci(out.unjudgedTop10)}; condensed (judged-only) nDCG@10 all ${ci(out.condensedNdcg10)}, relevant-only ${ci(out.condensedNdcg10Relevant)}`);
  console.log(`Tier B in the re-ranked pool: ${JSON.stringify(tierB)}; demotion precision (excluded or not relevant, of judged) ${f(out.tierB.precision)}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
