/**
 * Gold v3: trial-level labels in our fact-key space (eval/gold/gold-v3.json; guidelines eval/gold/gold-v3-guidelines.md).
 *
 *   npx tsx scripts/ingest/gold-v3.ts --sample --split=dev|held --n=150 --tag=dev1      draw trials, write labeling packets
 *   npx tsx scripts/ingest/gold-v3.ts --enrich --family=prior_chemo --n=40 --tag=enr1   held-out enrichment (current extractor fires)
 *   npx tsx scripts/ingest/gold-v3.ts --merge                                           verify quotes, write gold-v3.json
 *   npx tsx scripts/ingest/gold-v3.ts --measure [--split=dev|held] [--errors=<family>]   precision / recall per gate family
 *   npx tsx scripts/ingest/gold-v3.ts --measure --split=held --write                    + write config/questionnaire/precision.generated.ts
 *
 * Split: partitionOf(NCT id) (FNV hash, lib/ingest/precision.ts), the same dev/held split earlier rounds used. Rules are
 * tuned by reading dev errors only; --errors refuses the held split. Sampling: deterministic LCG over the sorted pool.
 * Pool: national snapshot trials minus every NCT id that appears anywhere in eval/, tests/, scripts/, config/, lib/ or
 * the LLM caches (earlier labels, fixtures, LLM-processed trials) and minus earlier v3 samples.
 *
 * Held-out precision for family F is computed on the "random" stratum plus the "enrich:F" stratum only: both are
 * uniform samples of the trials where the extractor fires F, so their union is too (other enrichment strata are not).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCards } from "./cards";
import { partitionOf } from "../../lib/ingest/precision";
import { FACT_FAMILIES } from "../../lib/ingest/eligibility-facts";
import { GATE_LB, GATE_MIN_N, GATE_POINT, LEGACY_FAMILIES, gateFamilyOf, passesGate, wilsonLower, wilsonUpper, type GateFamily } from "../../lib/ingest/gate-families";
import { goldDirectional, goldRowsFor, isWindowParam, judgeV3, type GoldV3Label, type GoldV3Trial } from "../../lib/ingest/gold-v3";
import { BIOMARKER_IDS } from "../../config/biomarkers";
import { DRUG_CLASS_IDS, HISTOLOGY_IDS } from "../../config/questionnaire/ids";
import type { Fact, TrialCard } from "../../lib/types/trial";

const GOLD = "eval/gold/gold-v3.json";
const SAMPLE = "eval/gold/gold-v3-sample.json";
const WORK = ".work/gold-v3";
const GENERATED = "config/questionnaire/precision.generated.ts";

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=") as [string, string | undefined]));

const BASE_KEYS = [
  "metastatic", "locally_advanced", "adjuvant_setting", "resectable", "recurrent", "newly_diagnosed", "previously_treated",
  "min_prior_lines", "max_prior_lines", "prior_chemotherapy", "prior_radiation", "prior_surgery", "prior_immunotherapy",
  "prior_targeted_therapy", "ecog_max", "brain_mets", "measurable_disease", "other_malignancy", "hiv", "hepatitis_b", "hepatitis_c",
  "organ_transplant", "allo_sct", "autoimmune", "heart_disease", "kidney_disease", "liver_disease", "castration_resistant",
  "platinum_resistant", "platinum_sensitive", "mibc", "pregnancy", "concurrent_trial",
];
export const V3_KEYS = new Set<string>([...BASE_KEYS, ...DRUG_CLASS_IDS.map((c) => `prior_drug:${c}`), ...HISTOLOGY_IDS.map((h) => `histology:${h}`), ...BIOMARKER_IDS.map((b) => `biomarker:${b}`)]);

interface SampleEntry { id: string; split: "dev" | "held"; stratum: string; tag: string }
interface SampleFile { note: string; seed: number; entries: SampleEntry[] }

function readSample(): SampleFile {
  if (!existsSync(SAMPLE)) return { note: "gold-v3 sampled trials (see scripts/ingest/gold-v3.ts header for the protocol)", seed: 20261012, entries: [] };
  return JSON.parse(readFileSync(SAMPLE, "utf8")) as SampleFile;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Every NCT id already used anywhere in the repo's evidence, code, fixtures or LLM caches (excluding v3's own files). */
function usedIds(): Set<string> {
  const ids = new Set<string>();
  const files = ["eval", "tests", "scripts", "config", "lib"].flatMap((d) => walk(d)).filter((f) => !f.includes("gold-v3"));
  files.push("data/cache/llm-facts-v2.jsonl", "data/cache/llm-facts.json");
  for (const f of files) {
    if (!existsSync(f)) continue;
    for (const m of readFileSync(f, "utf8").matchAll(/NCT\d{8}/g)) ids.add(m[0]);
  }
  return ids;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32;
}

function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const a = [...xs];
  const r = lcg(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

function packetText(c: TrialCard): string {
  const lines = [`## ${c.id}`, `Title: ${c.title}`, `Conditions: ${c.conditions.join("; ")}`, "Inclusion criteria:"];
  for (const x of c.inclusion) lines.push(`I${x.n}: ${x.text}`);
  lines.push("Exclusion criteria:");
  for (const x of c.exclusion) lines.push(`E${x.n}: ${x.text}`);
  return lines.join("\n");
}

function writePackets(cards: TrialCard[], tag: string, per = 25): void {
  mkdirSync(join(WORK, "packets"), { recursive: true });
  for (let k = 0; k * per < cards.length; k++) {
    const chunk = cards.slice(k * per, (k + 1) * per);
    const name = `${tag}-${String(k + 1).padStart(2, "0")}`;
    writeFileSync(join(WORK, "packets", `${name}.md`), `# Packet ${name} (${chunk.length} trials)\n\n${chunk.map(packetText).join("\n\n")}\n`);
    console.log(`packet ${name}: ${chunk.length} trials`);
  }
}

function addToSample(picked: TrialCard[], split: "dev" | "held", stratum: string, tag: string): void {
  const s = readSample();
  s.entries.push(...picked.map((c) => ({ id: c.id, split, stratum, tag })));
  writeFileSync(SAMPLE, `${JSON.stringify(s, null, 1)}\n`);
}

function sample(cards: TrialCard[]): void {
  const split = args.get("split") as "dev" | "held";
  const n = Number(args.get("n") ?? 100);
  const tag = args.get("tag") as string;
  if (!split || !tag) throw new Error("--split and --tag required");
  const s = readSample();
  if (s.entries.some((e) => e.tag === tag)) throw new Error(`tag ${tag} already sampled`);
  const used = usedIds();
  const taken = new Set(s.entries.map((e) => e.id));
  const pool = cards.filter((c) => partitionOf(c.id) === split && !used.has(c.id) && !taken.has(c.id) && c.inclusion.length + c.exclusion.length > 0);
  const seed = s.seed + [...tag].reduce((x, ch) => x + ch.charCodeAt(0), 0);
  const picked = shuffled(pool, seed).slice(0, n);
  console.log(`pool ${pool.length} (${used.size} used ids excluded); picked ${picked.length}`);
  addToSample(picked, split, "random", tag);
  writePackets(picked, tag);
}

const directional = (f: Fact) => f.value !== "mentioned" && !f.needsReview && !isWindowParam(f.param);

function enrich(cards: TrialCard[]): void {
  const fam = args.get("family") as GateFamily;
  const n = Number(args.get("n") ?? 40);
  const tag = args.get("tag") as string;
  if (!fam || !tag) throw new Error("--family and --tag required");
  const s = readSample();
  if (s.entries.some((e) => e.tag === tag)) throw new Error(`tag ${tag} already sampled`);
  const used = usedIds();
  const taken = new Set(s.entries.map((e) => e.id));
  const pool = cards.filter((c) => partitionOf(c.id) === "held" && !used.has(c.id) && !taken.has(c.id) && c.facts.some((f) => directional(f) && gateFamilyOf(f.key) === fam));
  const seed = s.seed + 7919 + [...tag].reduce((x, ch) => x + ch.charCodeAt(0), 0);
  const picked = shuffled(pool, seed).slice(0, n);
  console.log(`${fam}: firing pool ${pool.length}; picked ${picked.length}`);
  addToSample(picked, "held", `enrich:${fam}`, tag);
  writePackets(picked, tag);
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase().replace(/[.;,:\s]+$/, "");

function merge(cards: TrialCard[]): void {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const s = readSample();
  const meta = new Map(s.entries.map((e) => [e.id, e]));
  const out: GoldV3Trial[] = [];
  let rows = 0;
  let badQuote = 0;
  let badKey = 0;
  let badValue = 0;
  const labelers = new Set<string>();
  const seen = new Set<string>();
  for (const f of walk(join(WORK, "labels")).filter((x) => x.endsWith(".json")).sort()) {
    const j = JSON.parse(readFileSync(f, "utf8")) as { labeler?: string; trials: { trial_id: string; labels: GoldV3Label[] }[] };
    if (j.labeler) labelers.add(j.labeler);
    for (const t of j.trials) {
      const card = byId.get(t.trial_id);
      const m = meta.get(t.trial_id);
      if (!card || !m || seen.has(t.trial_id)) continue;
      seen.add(t.trial_id);
      const crit = [...card.inclusion.map((x) => ({ ref: `I${x.n}`, t: norm(x.text) })), ...card.exclusion.map((x) => ({ ref: `E${x.n}`, t: norm(x.text) }))];
      const labels: GoldV3Label[] = [];
      for (const l of t.labels ?? []) {
        rows++;
        if (!V3_KEYS.has(l.key)) {
          badKey++;
          continue;
        }
        if (!["required", "excluded", "conditional"].includes(l.value)) {
          badValue++;
          continue;
        }
        const q = norm(String(l.quote ?? ""));
        if (!q || !crit.some((c) => c.t.includes(q))) {
          badQuote++;
          continue;
        }
        const clean: GoldV3Label = { key: l.key, value: l.value, quote: l.quote };
        if (l.scope) clean.scope = l.scope;
        if (l.param !== undefined && l.param !== null && l.param !== "") clean.param = l.param;
        if (l.ref) clean.ref = l.ref;
        if (l.note) clean.note = l.note;
        labels.push(clean);
      }
      out.push({ trial_id: t.trial_id, split: m.split, stratum: m.stratum, labels });
    }
  }
  const missing = s.entries.filter((e) => !seen.has(e.id)).map((e) => e.id);
  out.sort((a, b) => a.trial_id.localeCompare(b.trial_id));
  const gold = {
    meta: {
      name: "TrialBridge eligibility-fact gold set v3 (fact-key schema, provisional)",
      labeler: `Blind labelers (${[...labelers].sort().join(", ") || "unknown"}), one pass per trial, blind to extractor code, generated facts and earlier labels; not clinician-reviewed`,
      guidelines: "eval/gold/gold-v3-guidelines.md",
      sampling: "scripts/ingest/gold-v3.ts (header); trial list with split/stratum in eval/gold/gold-v3-sample.json",
      quote_check: `every kept quote is a verbatim (whitespace-normalised, case-folded, trailing punctuation ignored) substring of one criterion of the trial; dropped: ${badQuote} quote mismatches, ${badKey} unknown keys, ${badValue} bad values of ${rows} rows`,
      n_trials: out.length,
    },
    trials: out,
  };
  writeFileSync(GOLD, `${JSON.stringify(gold, null, 1)}\n`);
  console.log(`merged ${out.length} trials, ${rows} rows; dropped quote ${badQuote}, key ${badKey}, value ${badValue}; missing labels for ${missing.length}: ${missing.slice(0, 10).join(" ")}`);
}

export interface FamilyStats { family: string; n: number; correct: number; precision: number; lb: number; ub: number; goldRows: number; recalled: number; passes: boolean }

const ALL_FAMILIES: GateFamily[] = [...(Object.keys(FACT_FAMILIES) as GateFamily[]), ...(Object.keys(LEGACY_FAMILIES) as GateFamily[])];

/** Per-family precision/recall on gold trials of one split. */
export function measureSplit(cards: TrialCard[], gold: GoldV3Trial[], split: "dev" | "held", onError?: (fam: GateFamily, t: GoldV3Trial, f: Fact) => void): FamilyStats[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const out: FamilyStats[] = [];
  for (const fam of ALL_FAMILIES) {
    let n = 0;
    let correct = 0;
    let goldRows = 0;
    let recalled = 0;
    for (const t of gold) {
      if (t.split !== split) continue;
      if (split === "held" && t.stratum !== "random" && t.stratum !== `enrich:${fam}`) continue;
      const card = byId.get(t.trial_id);
      if (!card) continue;
      const mine = card.facts.filter((f) => gateFamilyOf(f.key) === fam && directional(f));
      for (const f of mine) {
        n++;
        const ok = judgeV3(f, t.labels);
        if (ok) correct++;
        else onError?.(fam, t, f);
      }
      // Recall only on the random stratum (enrichment strata are conditioned on our own output).
      if (t.stratum === "random") {
        for (const g of goldDirectional(t.labels).filter((l) => gateFamilyOf(l.key) === fam)) {
          goldRows++;
          if (mine.some((f) => f.key === g.key && judgeV3(f, t.labels))) recalled++;
        }
      }
    }
    out.push({ family: fam, n, correct, precision: n ? correct / n : 0, lb: wilsonLower(correct, n), ub: wilsonUpper(correct, n), goldRows, recalled, passes: passesGate(correct, n) });
  }
  return out;
}

function printStats(title: string, stats: FamilyStats[]): void {
  console.log(`\n${title}\nfamily               n  correct  precision   95% Wilson     recall (gold rows)  gate`);
  for (const s of stats) {
    if (!s.n && !s.goldRows) continue;
    const rec = s.goldRows ? `${((s.recalled / s.goldRows) * 100).toFixed(0).padStart(3)}% (${s.recalled}/${s.goldRows})` : "   -";
    console.log(`${s.family.padEnd(18)} ${String(s.n).padStart(4)} ${String(s.correct).padStart(8)} ${s.n ? `${(s.precision * 100).toFixed(1).padStart(8)}%` : "        -"}  ${s.n ? `[${(s.lb * 100).toFixed(1)}, ${(s.ub * 100).toFixed(1)}]` : "".padEnd(12)}  ${rec.padEnd(18)}  ${s.passes ? "PASS" : "fail"}`);
  }
}

function measure(cards: TrialCard[]): void {
  const gold = (JSON.parse(readFileSync(GOLD, "utf8")) as { trials: GoldV3Trial[] }).trials;
  const errFam = args.get("errors");
  const split = (args.get("split") ?? "dev") as "dev" | "held";
  if (errFam && split === "held") throw new Error("--errors is dev-only (held-out errors are never read while tuning)");
  const byId = new Map(cards.map((c) => [c.id, c]));
  const stats = measureSplit(cards, gold, split, errFam ? (fam, t, f) => {
    if (errFam !== "all" && fam !== errFam) return;
    const quote = f.quote.replace(/\s+/g, " ").slice(0, 300);
    const rows = goldRowsFor(f.key, t.labels).map((r) => `${r.value}${r.scope ? `/${r.scope}` : ""}${r.param !== undefined ? `(${r.param})` : ""} "${r.quote.slice(0, 120)}"`).join(" | ") || "(gold silent)";
    console.log(`${t.trial_id} ${f.key}=${f.value}${f.param !== undefined ? `(${f.param})` : ""} ${f.ref.section[0]?.toUpperCase()}${f.ref.n} :: ${quote}\n    GOLD: ${rows}`);
  } : undefined);
  void byId;
  printStats(`gold-v3 ${split} (${gold.filter((t) => t.split === split).length} trials)`, stats);
  if (args.has("write")) {
    if (split !== "held") throw new Error("--write uses the held-out split only");
    writeGenerated(stats);
  }
}

function writeGenerated(stats: FamilyStats[]): void {
  const body = Object.fromEntries(stats.map((s) => [s.family, { labeled: s.n, correct: s.correct, precision: Number(s.precision.toFixed(3)), wilsonLower: Number(s.lb.toFixed(3)), passes: s.passes, layer: "rules" }]));
  writeFileSync(
    GENERATED,
    `/** GENERATED by \`npx tsx scripts/ingest/gold-v3.ts --measure --split=held --write\` from eval/gold/gold-v3.json (held-out split). Do not edit. */\nimport type { GateFamily } from "@/lib/ingest/gate-families";\n\nexport interface FamilyPrecision { labeled: number; correct: number; precision: number; wilsonLower: number; passes: boolean; layer?: "rules" | "llm" }\n\n/**\n * Conflict-safe precision of committed directional facts per gate family on the held-out gold-v3 split (AI-labeled, not\n * clinicians). passes = n >= ${GATE_MIN_N}, precision >= ${GATE_POINT} and 95% Wilson lower bound >= ${GATE_LB}. Families that fail never penalize.\n */\nexport const FAMILY_PRECISION: Readonly<Partial<Record<GateFamily, FamilyPrecision>>> = ${JSON.stringify(body, null, 2)};\n`,
  );
  console.log(`\nWrote ${GENERATED}`);
}

const cards = loadCards();
if (args.has("sample")) sample(cards);
else if (args.has("enrich")) enrich(cards);
else if (args.has("merge")) merge(cards);
else if (args.has("measure")) measure(cards);
else console.log("Use --sample, --enrich, --merge or --measure");
