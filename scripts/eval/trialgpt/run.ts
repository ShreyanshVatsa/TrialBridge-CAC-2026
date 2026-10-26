/**
 * `npx tsx scripts/eval/trialgpt/run.ts [--worst=N] [--sample]`: criterion-splitter gold check vs TrialGPT.
 *
 * Reads data/cache/trialgpt/overlap.json (scripts/eval/trialgpt/extract.ts) when present, else the committed
 * eval/trialgpt/sample.json. Writes eval/trialgpt/results.json and, with --write-sample, refreshes the sample.
 * Primary subset: trials whose registry text still matches TrialGPT's copy (bigram Jaccard >= 0.9); texts that were
 * edited since TrialGPT's snapshot cannot be compared item by item and are reported separately.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { compareTrial, goldItems, oursFlat, summarize, type Summary, type TrialResult } from "./compare";
import { OVERLAP_FILE, type OverlapTrial } from "./extract";

const SAMPLE = "eval/trialgpt/sample.json";
const RESULTS = "eval/trialgpt/results.json";
const SIM_MIN = 0.9;

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

function main(): void {
  const useSample = process.argv.includes("--sample") || !existsSync(OVERLAP_FILE);
  const data = JSON.parse(readFileSync(useSample ? SAMPLE : OVERLAP_FILE, "utf8")) as Record<string, OverlapTrial>;
  const rs: TrialResult[] = Object.entries(data).map(([id, t]) => compareTrial(id, t.raw, t.gold));
  const same = rs.filter((r) => r.sim >= SIM_MIN && r.gold > 0);
  const strict = rs.filter((r) => r.sim >= 0.98 && r.gold > 0);
  const changed = rs.filter((r) => r.sim < SIM_MIN && r.gold > 0);
  const bySource = (src: OverlapTrial["source"]) => same.filter((r) => data[r.id]?.source === src);
  const fmt = (s: Summary) =>
    `n=${s.trials} flat exact ${(100 * s.flatExact).toFixed(1)}% (per-section ${(100 * s.flatSectionsExact).toFixed(1)}%, within 1 ${(100 * s.flatWithin1).toFixed(1)}%) | grouped exact ${(100 * s.groupedExact).toFixed(1)}% | boundary P ${s.precision.toFixed(3)} R ${s.recall.toFixed(3)} F1 ${s.f1.toFixed(3)}`;
  const summary = {
    source: useSample ? SAMPLE : OVERLAP_FILE,
    simThreshold: SIM_MIN,
    unchanged: summarize(same),
    strict098: summarize(strict),
    unchangedTrec: summarize(bySource("trec")),
    unchangedNational: summarize(bySource("national")),
    changedText: summarize(changed),
    all: summarize(rs.filter((r) => r.gold > 0)),
  };
  console.log(`source: ${summary.source}`);
  console.log(`unchanged text  ${fmt(summary.unchanged)}`);
  console.log(`  sim>=0.98     ${fmt(summary.strict098)}`);
  console.log(`  trec          ${fmt(summary.unchangedTrec)}`);
  console.log(`  national      ${fmt(summary.unchangedNational)}`);
  console.log(`changed text    ${fmt(summary.changedText)}`);
  console.log(`all             ${fmt(summary.all)}`);

  const worst = Number(arg("worst") ?? 0);
  if (worst) {
    const only = arg("src"); const bad = (process.argv.includes("--strict") ? strict : same).filter((r) => r.flat !== r.gold && (!only || data[r.id]?.source === only)).sort((a, b) => Math.abs(b.flat - b.gold) - Math.abs(a.flat - a.gold));
    const seed = Number(arg("seed") ?? 0);
    const pick = seed ? bad.filter((_, i) => i % seed === 0) : bad;
    for (const r of pick.slice(0, worst)) {
      const t = data[r.id] as OverlapTrial;
      const g = goldItems(t.gold);
      const o = oursFlat(t.raw);
      console.log(`\n===== ${r.id} gold ${r.gold} ours ${r.flat} grouped ${r.grouped}`);
      const G = [...g.inclusion.map((x) => `I ${x}`), ...g.exclusion.map((x) => `E ${x}`)];
      const O = [...o.inclusion.map((x) => `I ${x}`), ...o.exclusion.map((x) => `E ${x}`)];
      let k = 0;
      while (k < Math.min(G.length, O.length) && G[k] === O[k]) k++;
      for (let i = Math.max(0, k - 1); i < Math.min(Math.max(G.length, O.length), k + 4); i++) console.log(`  G| ${(G[i] ?? "").slice(0, 110)}\n  O| ${(O[i] ?? "").slice(0, 110)}`);
      const probe = (G[k] ?? O[k] ?? "").slice(2, 30);
      const at = t.raw.indexOf(probe.slice(0, 15));
      console.log(`  RAW| ${JSON.stringify(t.raw.slice(Math.max(0, at - 250), at + 250))}`);
    }
  }
  if (!useSample) {
    writeFileSync(RESULTS, `${JSON.stringify({ ...summary, generatedAt: new Date().toISOString().slice(0, 10) }, null, 2)}\n`);
    if (process.argv.includes("--write-sample")) {
      // Deterministic sample: every k-th unchanged trial, up to 300.
      const ids = same.map((r) => r.id).sort();
      const step = Math.max(1, Math.floor(ids.length / 300));
      const sample: Record<string, OverlapTrial> = {};
      for (let i = 0; i < ids.length && Object.keys(sample).length < 300; i += step) sample[ids[i] as string] = data[ids[i] as string] as OverlapTrial;
      writeFileSync(SAMPLE, JSON.stringify(sample));
      console.log(`wrote ${SAMPLE} (${Object.keys(sample).length} trials)`);
    }
  }
}

main();
