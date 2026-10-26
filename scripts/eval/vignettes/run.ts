/**
 * Vignette benchmark runner: `npm run eval:vignettes -- [--split=dev|test] [--ref=pipeline:v4] [--drop-contested] [--json]`.
 * Scores every system stored in eval/gold/vignettes-pool-v1.json against the provisional gold
 * (eval/gold/vignettes-gold-v1.json) on one frozen split. Default split is dev; the test split only runs when asked for
 * with --split=test (use it at milestones, not while tuning). Per system: graded nDCG@10 (gains eligible 3, possibly 2),
 * recall@50 of eligible trials, and the share of excluded trials in the top 10, each with a bootstrap 95% CI over
 * vignettes; plus the paired-bootstrap difference vs the reference system (default pipeline:v4).
 * Unjudged trials (never pooled) count as non-relevant, the usual pooling assumption: a new system that surfaces trials
 * outside the pool is under-credited until its rankings are re-pooled and judged.
 */
import { readFileSync } from "node:fs";
import type { GoldFile } from "./build-gold";
import { GOLD_FILE } from "./build-gold";
import { bootstrapCI, excludedShareAtK, ndcgAtK, recallEligibleAtK, type Interval, type VignetteLabels } from "./metrics";
import { readPool } from "./pool";
import { splitOf } from "./schema";

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=") as [string, string | undefined]));
const split = (args.get("split") ?? "dev") as "dev" | "test";
if (split !== "dev" && split !== "test") throw new Error("--split must be dev or test");
const ref = args.get("ref") ?? "pipeline:v4";
const dropContested = args.has("drop-contested");

const pool = readPool();
if (!pool) throw new Error("eval/gold/vignettes-pool-v1.json missing: run pool.ts");
const gold = JSON.parse(readFileSync(GOLD_FILE, "utf8")) as GoldFile;
const vids = Object.keys(gold.vignettes).filter((v) => splitOf(v) === split).sort();
if (vids.length === 0) throw new Error(`no judged vignettes in the ${split} split yet`);

const labelsOf = (v: string): VignetteLabels => {
  const out: Record<string, string> = {};
  for (const [id, p] of Object.entries(gold.vignettes[v] as GoldFile["vignettes"][string])) if (!(dropContested && p.contested)) out[id] = p.l;
  return out as VignetteLabels;
};
const systems = [...new Set(vids.flatMap((v) => Object.keys(pool.rankings[v] ?? {})))].sort((a, b) => (a === ref ? -1 : b === ref ? 1 : a.localeCompare(b)));
const per: Record<string, { ndcg: number[]; recall: number[]; excl: number[] }> = {};
for (const s of systems) {
  per[s] = { ndcg: [], recall: [], excl: [] };
  for (const v of vids) {
    const ranked = pool.rankings[v]?.[s] ?? [];
    const labels = labelsOf(v);
    (per[s] as (typeof per)[string]).ndcg.push(ndcgAtK(ranked, labels, 10));
    (per[s] as (typeof per)[string]).recall.push(recallEligibleAtK(ranked, labels, 50));
    (per[s] as (typeof per)[string]).excl.push(excludedShareAtK(ranked, labels, 10));
  }
}

const f = (x: number) => (Number.isNaN(x) ? "  n/a" : x.toFixed(3));
const ci = (i: Interval) => `${f(i.mean)} [${f(i.lo)}, ${f(i.hi)}]`;
const dci = (i: Interval) => `${i.mean >= 0 ? "+" : ""}${i.mean.toFixed(3)} [${i.lo.toFixed(3)}, ${i.hi.toFixed(3)}]`;
const result = systems.map((s) => {
  const p = per[s] as (typeof per)[string];
  const r = per[ref];
  return { system: s, ndcg10: bootstrapCI(p.ndcg), recall50: bootstrapCI(p.recall), excludedTop10: bootstrapCI(p.excl), dNdcgVsRef: s !== ref && r ? bootstrapCI(p.ndcg, r.ndcg) : null };
});
if (args.has("json")) console.log(JSON.stringify({ split, vignettes: vids.length, ref, dropContested, result }, null, 1));
else {
  const pairs = vids.reduce((a, v) => a + Object.keys(gold.vignettes[v] as object).length, 0);
  console.log(`Vignette benchmark, ${split} split: ${vids.length} vignettes, ${pairs} judged pairs${dropContested ? " (contested pairs dropped)" : ""}. provisional gold, not clinicians. Paired deltas vs ${ref}.\n`);
  console.log("system".padEnd(16), "nDCG@10 [95% CI]".padEnd(24), "recall@50 elig [95% CI]".padEnd(26), "excluded in top10 [95% CI]".padEnd(28), `dNDCG vs ${ref}`);
  for (const r of result) console.log(r.system.padEnd(16), ci(r.ndcg10).padEnd(24), ci(r.recall50).padEnd(26), ci(r.excludedTop10).padEnd(28), r.dNdcgVsRef ? dci(r.dNdcgVsRef) : "(reference)");
}
