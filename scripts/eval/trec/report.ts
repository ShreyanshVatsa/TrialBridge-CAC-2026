/**
 * Print benchmark statistics and the BM25 (MiniSearch) baseline for the TREC CT cancer topics.
 * `npx tsx scripts/eval/trec/report.ts`
 */
import { loadTrec, ndcgGraded, trecBm25Baseline } from "./load";

const bench = loadTrec();
const judgedPairs = bench.topics.reduce((n, t) => n + Object.keys(t.qrels).length, 0);
const allJudged = new Set(bench.topics.flatMap((t) => Object.keys(t.qrels)));
console.log(`topics: ${bench.topics.length} (2021: ${bench.topics.filter((t) => t.year === 2021).length}, 2022: ${bench.topics.filter((t) => t.year === 2022).length})`);
console.log(`judged pairs: ${judgedPairs}; unique judged NCT ids: ${allJudged.size}`);
console.log(`fetched at ${bench.fetchedAt}: found ${allJudged.size - bench.missing.length}, missing ${bench.missing.length}`);
const reasons = new Map<string, number>();
for (const r of Object.values(bench.dropped)) {
  const key = r.startsWith("schema:") ? "schema (incomplete record, usually no eligibility text)" : r;
  reasons.set(key, (reasons.get(key) ?? 0) + 1);
}
console.log(`dropped by schema/buildRecord: ${Object.keys(bench.dropped).length}`);
for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${r}`);
console.log(`cards with the synthetic placeholder site: ${bench.syntheticSites}`);

console.log("\ntopic      judged  cards  synth  elig  excl  elig-cards  BM25 nDCG@10  nDCG@20");
let sum10 = 0;
for (const t of bench.topics) {
  const grades = Object.values(t.qrels);
  const elig = grades.filter((g) => g === 2).length;
  const excl = grades.filter((g) => g === 1).length;
  const eligCards = t.trials.filter((x) => t.qrels[x.card.id] === 2).length;
  const synth = t.trials.filter((x) => x.syntheticSite).length;
  const ranked = trecBm25Baseline(t.text, t.trials.map((x) => x.card));
  // Evaluate against the judgments restricted to trials we could load, so missing/dropped trials don't count as misses.
  const loadable: Record<string, number> = {};
  for (const x of t.trials) loadable[x.card.id] = t.qrels[x.card.id] ?? 0;
  const n10 = ndcgGraded(ranked, loadable, 10);
  const n20 = ndcgGraded(ranked, loadable, 20);
  sum10 += n10;
  console.log(
    `${t.key.padEnd(10)} ${String(grades.length).padStart(6)}  ${String(t.trials.length).padStart(5)}  ${String(synth).padStart(5)}  ${String(elig).padStart(4)}  ${String(excl).padStart(4)}  ${String(eligCards).padStart(10)}  ${n10.toFixed(3).padStart(12)}  ${n20.toFixed(3).padStart(7)}`,
  );
}
console.log(`mean BM25 nDCG@10 over ${bench.topics.length} topics: ${(sum10 / bench.topics.length).toFixed(3)}`);
