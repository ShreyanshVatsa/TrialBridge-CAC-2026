/**
 * Seeded sample of vignettes for the independent second judge ("judge-b"):
 * `npx tsx scripts/eval/vignettes/second-sample.ts` writes eval/gold/judgments/second-sample.json.
 * Whole vignettes (build-gold only pairs vignettes a judge covered completely), stratified by split: dev and test
 * vignettes are shuffled separately and taken in turn until the sample holds at least 20% of the chunks.
 * Vignettes with no pooled trials are skipped. Drawn once; an existing file is never overwritten.
 */
import { existsSync, writeFileSync } from "node:fs";
import { JUDGMENTS_DIR } from "./files";
import { readChunkIndex } from "./judge-packets";
import { rng } from "./metrics";
import { splitOf } from "./schema";

export const SECOND_SAMPLE_FILE = `${JUDGMENTS_DIR}/second-sample.json`;
const SEED = 20261020;
const SHARE = 0.2;

function main(): void {
  if (existsSync(SECOND_SAMPLE_FILE)) throw new Error(`${SECOND_SAMPLE_FILE} exists: the sample is drawn once`);
  const chunks = readChunkIndex();
  const byVignette = new Map<string, typeof chunks>();
  for (const c of chunks) byVignette.set(c.vignette, [...(byVignette.get(c.vignette) ?? []), c]);
  const rand = rng(SEED);
  const shuffled = (ids: string[]) => ids.map((id) => ({ id, r: rand() })).sort((a, b) => a.r - b.r).map((x) => x.id);
  const pools = (["dev", "test"] as const).map((s) =>
    shuffled([...byVignette.keys()].filter((v) => splitOf(v) === s && byVignette.get(v)!.some((c) => c.trialIds.length)).sort()),
  );
  const target = Math.ceil(SHARE * chunks.length);
  const picked: string[] = [];
  let n = 0;
  for (let i = 0; n < target && (pools[0]!.length || pools[1]!.length); i++) {
    const v = pools[i % 2]!.shift();
    if (!v) continue;
    picked.push(v);
    n += byVignette.get(v)!.length;
  }
  picked.sort();
  const out = {
    note: `Seeded (${SEED}) sample for the independent second judge: whole vignettes, alternating dev/test, until >= ${SHARE * 100}% of chunks.`,
    seed: SEED,
    vignettes: picked,
    chunks: picked.flatMap((v) => byVignette.get(v)!.map((c) => c.id)),
  };
  writeFileSync(SECOND_SAMPLE_FILE, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`${picked.length} vignettes (${picked.filter((v) => splitOf(v) === "dev").length} dev), ${n} of ${chunks.length} chunks`);
}

if (process.argv[1]?.endsWith("second-sample.ts")) main();
