/**
 * Merge verified judge files into the vignette gold set: `npx tsx scripts/eval/vignettes/build-gold.ts [--second=judge-b]`.
 * Writes eval/gold/vignettes-gold-v1.json (primary label per pooled pair, the second pass's label where it covered
 * the pair, `contested` where they differ) and the agreement between the two passes (raw + Cohen's kappa, stratified by
 * split). Only vignettes the primary pass covered completely are included. Labels are provisional, not clinician-reviewed.
 */
import { existsSync, writeFileSync } from "node:fs";
import { JUDGMENTS_DIR } from "./files";
import { checkJudge, MODELS_BY_JUDGE } from "./judge-check";
import { readChunkIndex } from "./judge-packets";
import { LABELS, type Judgment, type Label } from "./judge-prompt";
import { cohensKappa } from "./metrics";
import { splitOf } from "./schema";

export const GOLD_FILE = "eval/gold/vignettes-gold-v1.json";
export const PRIMARY = "judge-a";
/** Second pass's directory: an independent labeling pass ("judge-b") on a seeded 20% vignette sample (second-sample.ts). */
export const SECOND = process.argv.find((a) => a.startsWith("--second="))?.slice(9) ?? "judge-b";

export interface GoldPair {
  /** Primary judge's label. */
  l: Label;
  /** Second judge's label, when it judged this pair. */
  s?: Label;
  /** True when the two judges differ. */
  contested?: true;
}
export interface Agreement {
  pairs: number;
  raw: number;
  kappa: number;
  /** Agreement on the coarser "relevant to patient (eligible/possibly)" vs "not" split. */
  rawRelevant: number;
  confusion: Record<string, number>;
}
export interface GoldFile {
  schema: 1;
  note: string;
  primary: string;
  second: string;
  vignettes: Record<string, Record<string, GoldPair>>;
  agreement: { all: Agreement; dev: Agreement; test: Agreement };
}

function agreement(pairs: [Label, Label][]): Agreement {
  const confusion: Record<string, number> = {};
  for (const [a, b] of pairs) confusion[`${a}>${b}`] = (confusion[`${a}>${b}`] ?? 0) + 1;
  const rel = (l: Label) => l === "eligible" || l === "possibly";
  const n = pairs.length;
  return {
    pairs: n,
    raw: n ? pairs.filter(([a, b]) => a === b).length / n : Number.NaN,
    kappa: cohensKappa(pairs.map((p) => p[0]), pairs.map((p) => p[1])),
    rawRelevant: n ? pairs.filter(([a, b]) => rel(a) === rel(b)).length / n : Number.NaN,
    confusion,
  };
}

/** Per-vignette verified labels of a judge, only for vignettes whose every chunk is valid. */
function byVignette(judge: string): Map<string, Map<string, Judgment>> {
  const { checks, labels } = checkJudge(judge);
  const chunks = readChunkIndex();
  const out = new Map<string, Map<string, Judgment>>();
  const vignettes = new Set(chunks.map((c) => c.vignette));
  for (const v of vignettes) {
    const mine = chunks.filter((c) => c.vignette === v);
    if (!mine.every((c) => checks.find((x) => x.chunk === c.id)?.status === "ok")) continue;
    const m = new Map<string, Judgment>();
    for (const c of mine) for (const j of labels.get(c.id) ?? []) m.set(j.nctId, j);
    out.set(v, m);
  }
  return out;
}

function main(): void {
  const primary = byVignette(PRIMARY);
  const second = existsSync(`${JUDGMENTS_DIR}/${SECOND}`) ? byVignette(SECOND) : new Map<string, Map<string, Judgment>>();
  const vignettes: GoldFile["vignettes"] = {};
  const pairsAll: [Label, Label][] = [];
  const pairsBy: Record<"dev" | "test", [Label, Label][]> = { dev: [], test: [] };
  const rows: { v: string; id: string; a: Judgment; b?: Judgment }[] = [];
  for (const [v, m] of [...primary].sort((x, y) => x[0].localeCompare(y[0]))) {
    const sec = second.get(v);
    vignettes[v] = {};
    for (const [id, a] of [...m].sort((x, y) => x[0].localeCompare(y[0]))) {
      const b = sec?.get(id);
      const pair: GoldPair = { l: a.label };
      if (b) {
        pair.s = b.label;
        pairsAll.push([a.label, b.label]);
        pairsBy[splitOf(v)].push([a.label, b.label]);
        if (a.label !== b.label) pair.contested = true;
      }
      vignettes[v][id] = pair;
      rows.push({ v, id, a, b });
    }
  }
  const gold: GoldFile = {
    schema: 1,
    note: `Provisional gold labels, NOT clinician-reviewed. l = primary labeling pass (${PRIMARY}), s = independent second pass (${SECOND}: ${MODELS_BY_JUDGE[SECOND] ?? SECOND}) on a stratified sample of vignettes, contested = they differ. See eval/gold/README.md.`,
    primary: PRIMARY,
    second: SECOND,
    vignettes,
    agreement: { all: agreement(pairsAll), dev: agreement(pairsBy.dev), test: agreement(pairsBy.test) },
  };
  writeFileSync(GOLD_FILE, `${JSON.stringify(gold)}\n`);

  const cnt = Object.fromEntries(LABELS.map((l) => [l, rows.filter((r) => r.a.label === l).length]));
  console.log(`gold: ${Object.keys(vignettes).length} vignettes, ${rows.length} pairs`, cnt);
  const fmt = (a: Agreement) => `${a.pairs} pairs, raw ${a.raw.toFixed(3)}, kappa ${a.kappa.toFixed(3)}, relevant-vs-not ${a.rawRelevant.toFixed(3)}`;
  console.log("agreement all:", fmt(gold.agreement.all), "| dev:", fmt(gold.agreement.dev), "| test:", fmt(gold.agreement.test));
}

if (process.argv[1]?.endsWith("build-gold.ts")) main();
