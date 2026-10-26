/**
 * Headroom diagnostic for the vignette benchmark (dev split only): what limits nDCG@10, measured with oracles on the
 * live top 50 (rankTrials + the deterministic resolver on the top TOP_N, as the app shows before the judge answers).
 *
 *   npx tsx scripts/eval/vignettes/diagnose.ts [--answers=v9] [--pool=15]
 *
 * Prints (1) the metric table of eval/RESULTS.md section 3.6 (both denominators, binary, eligible-only, retrieval-only,
 * oracle re-rankings of the top 15 and top 50, condensed), (2) slot and recall counts (micro totals over vignettes), and
 * (3) the cumulative waterfall: each step removes one class of gold-excluded trial from the ranking, using the bucket
 * that error-analysis.ts assigns from the primary judge's not_met evidence (it is run first, at depth 50). Oracles read
 * the gold, so they bound what a fix could gain; nothing here is a system score. The test split is refused.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveRanking } from "../../../lib/match/criteria-rank";
import { TOP_N } from "../../../lib/match/rank";
import { loadNational } from "../national";
import { GOLD_FILE, type GoldFile } from "./build-gold";
import { readVignettes } from "./files";
import { GAIN, type Label } from "./judge-prompt";
import { binaryNdcgAtK, condensed, mean, ndcgAtK, type VignetteLabels } from "./metrics";
import { STORED_K } from "./pool";
import { pipelineRanking, queryVectors, vignetteContexts } from "./systems";

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=") as [string, string | undefined]));
if (args.get("split") && args.get("split") !== "dev") throw new Error("diagnose runs on the dev split only");
const pool = Number(args.get("pool") ?? TOP_N);
const answers = args.get("answers");

type Bucket = { bucket: string; topic: string };

function readBuckets(): Record<string, Bucket> {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "tb-diag-")), "buckets.json");
  const extra = answers ? [`--answers=${answers}`] : [];
  execFileSync("npx", ["tsx", path.join(import.meta.dirname, "error-analysis.ts"), "--live", "--depth=50", `--buckets=${out}`, "--examples=0", ...extra], { stdio: ["ignore", "ignore", "inherit"] });
  return JSON.parse(readFileSync(out, "utf8")) as Record<string, Bucket>;
}

async function main(): Promise<void> {
  const national = loadNational();
  if (!national) throw new Error("national data not found");
  const gold = JSON.parse(readFileSync(GOLD_FILE, "utf8")) as GoldFile;
  const buckets = readBuckets();
  const ctxs = vignetteContexts(readVignettes(undefined, "dev", answers).filter((v) => gold.vignettes[v.id]), national);
  const qs = await queryVectors(ctxs);
  const gainOf = (labels: VignetteLabels, id: string) => (labels[id] ? GAIN[labels[id] as Label] : 0);
  const sortByGain = (labels: VignetteLabels, r: readonly string[]) => [...r].sort((a, b) => gainOf(labels, b) - gainOf(labels, a));

  const table: Record<string, number[]> = {};
  const push = (k: string, x: number) => (table[k] ??= []).push(x);
  const steps: [string, (vid: string, id: string, l: Label | undefined) => boolean][] = [
    ["resolver says not_met but shown (tiering)", (v, i) => buckets[`${v}|${i}`]?.bucket === "tier_b_shown"],
    ["resolver could settle it (resolver gap)", (v, i) => buckets[`${v}|${i}`]?.bucket === "resolver_gap"],
    ["no usable fact extracted (extractor gap)", (v, i) => buckets[`${v}|${i}`]?.bucket === "extractor_gap"],
    ["needs detail no question asks / unanswered", (_v, _i, l) => l === "excluded"],
    ["gold not_relevant removed (population)", (_v, _i, l) => l === "not_relevant"],
  ];
  const wf: number[][] = Array.from({ length: steps.length + 3 }, () => []);
  const fam: Record<string, number> = {};
  const tot: Record<string, number> = {};
  const add = (k: string, n: number) => (tot[k] = (tot[k] ?? 0) + n);
  let withRel = 0;

  ctxs.forEach((ctx, i) => {
    const vid = ctx.vignette.id;
    const labels = Object.fromEntries(Object.entries(gold.vignettes[vid] ?? {}).map(([id, p]) => [id, p.l])) as VignetteLabels;
    const ids = pipelineRanking(ctx, qs[i] as Float32Array, STORED_K);
    const byId = new Map(ctx.candidates.map((c) => [c.card.id, c] as const));
    const rr = resolveRanking(ids.slice(0, pool).map((id) => byId.get(id)!), ctx.answers, ctx.catalog);
    const ranked = [...rr.order, ...ids.slice(pool)];
    const all = Object.keys(labels);
    const rel = all.filter((id) => gainOf(labels, id) > 0);
    const elig = all.filter((id) => labels[id] === "eligible");
    const hasRel = rel.length > 0;
    if (hasRel) withRel++;
    const both = (k: string, x: number) => {
      push(`${k}|all`, Number.isNaN(x) ? 0 : x);
      push(`${k}|rel`, hasRel ? x : Number.NaN);
    };
    both("graded", ndcgAtK(ranked, labels, 10));
    both("binary", binaryNdcgAtK(ranked, labels, 10));
    push("eligibleOnly|rel", binaryNdcgAtK(ranked, labels, 10, true));
    both("retrieval only", ndcgAtK(ids, labels, 10));
    both("oracle: perfect order of top 15", ndcgAtK([...sortByGain(labels, ranked.slice(0, 15)), ...ranked.slice(15)], labels, 10));
    both("oracle: perfect order of top 50", ndcgAtK(sortByGain(labels, ranked.slice(0, 50)), labels, 10));
    both("condensed (judged only)", ndcgAtK(condensed(ranked, labels), labels, 10));

    const top10 = ranked.slice(0, 10);
    add("slots", top10.length);
    add("slot relevant", top10.filter((id) => gainOf(labels, id) > 0).length);
    add("slot excluded", top10.filter((id) => labels[id] === "excluded").length);
    add("slot not_relevant", top10.filter((id) => labels[id] === "not_relevant").length);
    add("slot unjudged", top10.filter((id) => labels[id] === undefined).length);
    add("relevant", rel.length);
    add("eligible", elig.length);
    const cands = new Set(ctx.candidates.map((c) => c.card.id));
    add("relevant in candidates", rel.filter((id) => cands.has(id)).length);
    for (const k of [10, 15, 30, 50]) {
      const top = new Set(ranked.slice(0, k));
      add(`relevant@${k}`, rel.filter((id) => top.has(id)).length);
      add(`eligible@${k}`, elig.filter((id) => top.has(id)).length);
    }
    add("p10 ceiling", hasRel ? Math.min(rel.length, 10) / 10 : 0);

    // Waterfall: cumulative removals (scored over all vignettes, no relevant = 0).
    const nd = (r: readonly string[]) => (hasRel ? ndcgAtK(r, labels, 10) : 0);
    let cur = ranked;
    wf[0]!.push(nd(cur));
    steps.forEach(([, f], k) => {
      cur = cur.filter((id) => !f(vid, id, labels[id]));
      wf[k + 1]!.push(nd(cur));
    });
    const judged = condensed(cur, labels);
    wf[steps.length + 1]!.push(nd(judged));
    wf[steps.length + 2]!.push(nd(sortByGain(labels, judged)));
    for (const t of new Set(Object.values(buckets).map((b) => b.topic))) {
      const r = ranked.filter((id) => !(labels[id] === "excluded" && buckets[`${vid}|${id}`]?.topic === t));
      fam[t] = (fam[t] ?? 0) + nd(r) - nd(ranked);
    }
  });

  const f = (x: number) => (Number.isNaN(x) ? "  n/a" : x.toFixed(3));
  console.log(`dev split, ${ctxs.length} vignettes (${withRel} with a relevant trial), resolver pool ${pool}${answers ? `, answers ${answers}` : ""}`);
  console.log(`all-vignette ceiling ${f(withRel / ctxs.length)}; mean P@10 ceiling over vignettes with a relevant trial ${f(tot["p10 ceiling"]! / withRel)}`);
  console.log("\nmetric                                      all     relevant-only");
  for (const k of ["graded", "binary", "retrieval only", "oracle: perfect order of top 15", "oracle: perfect order of top 50", "condensed (judged only)"]) {
    console.log(`  ${k.padEnd(40)} ${f(mean(table[`${k}|all`]!))}   ${f(mean(table[`${k}|rel`]!))}`);
  }
  console.log(`  ${"eligible-only binary".padEnd(40)}   n/a   ${f(mean(table["eligibleOnly|rel"]!))} (n=${table["eligibleOnly|rel"]!.filter((x) => !Number.isNaN(x)).length})`);
  const pct = (a: string, b: string) => `${Math.round((100 * tot[a]!) / tot[b]!)}%`;
  console.log(`\ntop-10 slots ${tot.slots}: relevant ${tot["slot relevant"]} (${pct("slot relevant", "slots")}), excluded ${tot["slot excluded"]} (${pct("slot excluded", "slots")}), not_relevant ${tot["slot not_relevant"]} (${pct("slot not_relevant", "slots")}), unjudged ${tot["slot unjudged"]} (${pct("slot unjudged", "slots")})`);
  console.log(`relevant trials ${tot.relevant} (in hard-filtered candidates ${tot["relevant in candidates"]}); recall @10 ${pct("relevant@10", "relevant")} @15 ${pct("relevant@15", "relevant")} @30 ${pct("relevant@30", "relevant")} @50 ${pct("relevant@50", "relevant")}`);
  console.log(`eligible trials ${tot.eligible}; recall @10 ${pct("eligible@10", "eligible")} @15 ${pct("eligible@15", "eligible")} @50 ${pct("eligible@50", "eligible")}`);
  console.log("\nwaterfall (cumulative oracles, nDCG@10 over all vignettes):");
  const names = ["current", ...steps.map((s) => s[0]), "drop unjudged (pooling-bias bound)", "perfect order of what remains"];
  let prev = 0;
  names.forEach((n, k) => {
    const v = mean(wf[k]!);
    console.log(`  ${n.padEnd(44)} ${f(v)} ${k ? `+${(v - prev).toFixed(3)}` : ""}`);
    prev = v;
  });
  console.log("\nsingle-oracle gain by topic of the judge's not_met evidence (demote only that topic's excluded trials):");
  for (const [t, g] of Object.entries(fam).sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(18)} +${(g / ctxs.length).toFixed(3)}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
