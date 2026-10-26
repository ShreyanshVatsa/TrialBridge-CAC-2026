/**
 * v2 fact-family precision (QUESTIONNAIRE_SPEC §7.3): sample directional facts per family from the
 * national ClinicalTrials.gov cache for labeling, and measure precision on the labeled sample.
 *
 *   npx tsx scripts/ingest/fact-precision.ts --stats
 *   npx tsx scripts/ingest/fact-precision.ts --sample [--family=performance] [--n=50] [--round=2]
 *   npx tsx scripts/ingest/fact-precision.ts --measure        (writes config/questionnaire/precision.generated.ts)
 *   npx tsx scripts/ingest/fact-precision.ts --dump --family=lines [--n=80] [--seed=1]   (development partition only; for reading/tuning)
 *
 * Development / held-out split (round 3): trials are partitioned by a hash of their NCT id; rules are tuned only by
 * reading the "dev" partition (--dump never shows "held"), and the round-3 held-out sample is drawn once, with a fixed
 * seed, from the "held" partition minus every trial that appeared in an earlier labeling round.
 *
 * Labels live in eval/facts-labels-v2.json (provisional, not clinician-reviewed).
 * A family passes the gate at >= 85% precision on >= 30 labeled items (all items when fewer exist).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadCards } from "./cards";
import { FACT_FAMILIES, familyOf, type FactFamily } from "../../lib/ingest/eligibility-facts";
import { partitionOf, PRECISION_GATE, summarizePrecision, type LabelFile, type LabelItem } from "../../lib/ingest/precision";
import { LLM_LAYER_FAMILIES } from "../../lib/ingest/llm-families";
import { GOLD_FAMILY } from "../../lib/ingest/gold";
import type { Fact, TrialCard } from "../../lib/types/trial";

const LABELS = "eval/facts-labels-v2.json";
const GENERATED = "config/questionnaire/precision.generated.ts";
const LLM_GOLD = "eval/llm-gold-results.json";
/** Minimum judged gold facts for an LLM-layer family to switch on. */
const LLM_GOLD_MIN_N = 20;

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=") as [string, string | undefined]));

const refOf = (f: Fact) => `${f.ref.section === "inclusion" ? "I" : "E"}${f.ref.n}`;

function loadLabels(): LabelFile {
  if (!existsSync(LABELS)) {
    return {
      note: "Labeled item by item from real national trial text, following written labeling guidelines (provisional; not clinician-reviewed). correct = the fact (key, direction, param) is a reasonable reading of the quoted clause for a patient answering the matching question.",
      source: "ClinicalTrials.gov national cache (data/cache/national), rule layer v3",
      families: {},
    };
  }
  return JSON.parse(readFileSync(LABELS, "utf8")) as LabelFile;
}

function stats(cards: TrialCard[]): void {
  const counts = new Map<string, { required: number; excluded: number; mentioned: number; trials: Set<string> }>();
  for (const c of cards) {
    for (const f of c.facts) {
      const fam = familyOf(f.key);
      if (!fam) continue;
      const k = `${fam} ${f.key}`;
      const e = counts.get(k) ?? { required: 0, excluded: 0, mentioned: 0, trials: new Set() };
      e[f.value]++;
      if (f.value !== "mentioned") e.trials.add(c.id);
      counts.set(k, e);
    }
  }
  console.log(`${cards.length} trials`);
  for (const [k, e] of [...counts.entries()].sort()) console.log(`${k.padEnd(48)} req ${String(e.required).padStart(5)} exc ${String(e.excluded).padStart(5)} men ${String(e.mentioned).padStart(5)}`);
  const famTrials = new Map<FactFamily, Set<string>>();
  for (const c of cards) for (const f of c.facts) {
    const fam = familyOf(f.key);
    if (fam && f.value !== "mentioned") famTrials.set(fam, (famTrials.get(fam) ?? new Set()).add(c.id));
  }
  console.log("\nTrials with >= 1 directional fact per family:");
  for (const fam of Object.keys(FACT_FAMILIES) as FactFamily[]) console.log(`  ${fam.padEnd(18)} ${famTrials.get(fam)?.size ?? 0}`);
}

function sample(cards: TrialCard[]): void {
  const labels = loadLabels();
  const n = Number(args.get("n") ?? 50);
  const round = Number(args.get("round") ?? 1);
  const only = args.get("family");
  for (const fam of Object.keys(FACT_FAMILIES) as FactFamily[]) {
    if (only && only !== fam) continue;
    const existing = labels.families[fam]?.items.filter((i) => (i.round ?? 1) === round) ?? [];
    if (existing.length > 0 && !args.has("force")) {
      console.log(`${fam}: round ${round} already sampled (${existing.length}); use --force to resample`);
      continue;
    }
    const pool: LabelItem[] = [];
    const heldOut = round >= 3;
    const usedTrials = new Set(Object.values(labels.families).flatMap((fl) => fl.items.filter((i) => (i.round ?? 1) < round).map((i) => i.id)));
    for (const c of cards) for (const f of c.facts) {
      if (heldOut && (partitionOf(c.id) !== "held" || usedTrials.has(c.id))) continue;
      if (familyOf(f.key) !== fam || f.value === "mentioned" || f.source !== "rule") continue;
      pool.push({ id: c.id, key: f.key, value: f.value, ...(f.param !== undefined ? { param: f.param } : {}), ref: refOf(f), quote: f.quote.replace(/\s+/g, " ").slice(0, 600), correct: null, round });
    }
    // Deterministic LCG sample (seed differs per family and round).
    let seed = Number(args.get("seed") ?? 20261007) + round * 7919 + [...fam].reduce((s, ch) => s + ch.charCodeAt(0), 0);
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const picked = new Set<number>();
    const prior = new Set((labels.families[fam]?.items ?? []).map((i) => `${i.id}|${i.key}|${i.ref}`));
    const want = Math.min(n, pool.length);
    let guard = 0;
    while (picked.size < want && guard++ < want * 50) {
      const i = Math.floor(rand() * pool.length);
      const it = pool[i] as LabelItem;
      if (!prior.has(`${it.id}|${it.key}|${it.ref}`)) picked.add(i);
    }
    const items = [...picked].sort((a, b) => a - b).map((i) => pool[i] as LabelItem);
    const kept = (labels.families[fam]?.items ?? []).filter((i) => (i.round ?? 1) !== round);
    labels.families[fam] = {
      items: [...kept, ...items.map((it, k) => ({ n: kept.length + k + 1, ...it }))],
      ...(heldOut ? { measureRound: round, poolSize: pool.length } : labels.families[fam]?.measureRound !== undefined ? { measureRound: labels.families[fam]?.measureRound } : {}),
    };
    console.log(`${fam}: sampled ${items.length} of ${pool.length} directional facts (round ${round})`);
  }
  if (round >= 3) {
    labels.protocol = `Round ${round} = held-out sample: facts from trials whose NCT-id hash falls in the "held" half (partitionOf in scripts/ingest/fact-precision.ts) and that appear in no earlier labeling round; rules were tuned by reading the "dev" half only (--dump never shows held trials). Sampling: deterministic LCG, seed = ${args.get("seed") ?? 20261007} + round*7919 + sum of the family name char codes; n = ${n} directional rule facts per family (all of them when the held pool is smaller; poolSize records it). Labels are provisional: written internally from the quoted clause alone, not clinician-reviewed.`;
  }
  writeFileSync(LABELS, `${JSON.stringify(labels, null, 1)}\n`);
}

function dump(cards: TrialCard[]): void {
  const fam = args.get("family") as FactFamily;
  const n = Number(args.get("n") ?? 80);
  let seed = Number(args.get("seed") ?? 1) * 7919 + [...fam].reduce((x, ch) => x + ch.charCodeAt(0), 0);
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const want = args.get("value");
  const pool: string[] = [];
  for (const c of cards) {
    if (partitionOf(c.id) !== "dev") continue;
    for (const f of c.facts) {
      if (familyOf(f.key) !== fam || f.source !== "rule") continue;
      if (want ? f.value !== want : f.value === "mentioned") continue;
      if (args.get("key") && !f.key.includes(args.get("key") as string)) continue;
      pool.push(`${c.id} ${f.key} ${f.value}${f.param !== undefined ? `(${f.param})` : ""} ${refOf(f)} [${c.conditions.slice(0, 2).join("; ")}] :: ${f.quote.replace(/\s+/g, " ").slice(0, 420)}`);
    }
  }
  console.log(`# ${pool.length} dev facts`);
  const seen = new Set<number>();
  while (seen.size < Math.min(n, pool.length)) seen.add(Math.floor(rand() * pool.length));
  for (const i of [...seen].sort((a, b) => a - b)) console.log(pool[i]);
}

/** Print earlier labeled-incorrect items (dev partition only) with what the current rules produce. */
function wrong(cards: TrialCard[]): void {
  const fam = args.get("family") as string;
  const byId = new Map(cards.map((c) => [c.id, c]));
  for (const it of loadLabels().families[fam]?.items ?? []) {
    if (it.correct !== false || partitionOf(it.id) !== "dev") continue;
    const f = byId.get(it.id)?.facts.find((x) => x.key === it.key && refOf(x) === it.ref);
    const now = f ? `${f.value}${f.param !== undefined ? `(${f.param})` : ""}` : "none";
    console.log(`${it.id} ${it.key} was ${it.value}${it.param !== undefined ? `(${it.param})` : ""} now ${now} :: ${it.quote.slice(0, 230)} || ${it.why ?? ""}`);
  }
}

function measure(cards: TrialCard[]): void {
  const labels = loadLabels();
  const byId = new Map(cards.map((c) => [c.id, c]));
  const current = (it: LabelItem) => {
    const f = byId.get(it.id)?.facts.find((x) => x.key === it.key && refOf(x) === it.ref);
    return f ? { value: f.value, param: f.param } : null;
  };
  const summary = summarizePrecision(labels, current);
  console.log("family             labeled  correct  precision  stale  gate");
  for (const s of summary) console.log(`${s.family.padEnd(18)} ${String(s.labeled).padStart(7)} ${String(s.correct).padStart(8)} ${(s.precision * 100).toFixed(1).padStart(9)}% ${String(s.stale).padStart(6)}  ${s.passes ? "PASS" : "fail"}`);
  const body: Record<string, Record<string, unknown>> = Object.fromEntries(summary.map((s) => [s.family, { labeled: s.labeled, correct: s.correct, precision: Number(s.precision.toFixed(3)), passes: s.passes, layer: "rules" }]));
  // Families on the verified-LLM layer are gated by the one-shot gold measurement (scripts/ingest/llm-eval.ts --gold):
  // committed directional facts on gold-v1 + gold-v2 (provisional labels), pass = precision >= 85% on >= 20 judged facts.
  if (existsSync(LLM_GOLD)) {
    const g = JSON.parse(readFileSync(LLM_GOLD, "utf8")) as { results: { llm: { all: Record<string, { correct: number; incorrect: number }> } } };
    // Rule-layer families that the gold sets also cover (histology) are gated by their gold rule numbers too:
    // 240 blind trials outweigh the 50-item provisional held-out round.
    const gr = (g.results as unknown as { rules: { all: Record<string, { correct: number; incorrect: number }> } }).rules.all;
    for (const fam of Object.keys(GOLD_FAMILY)) {
      if ((LLM_LAYER_FAMILIES as readonly string[]).includes(fam) || !gr[fam] || !body[fam]) continue;
      const t = gr[fam];
      const n = t.correct + t.incorrect;
      const precision = n ? t.correct / n : 0;
      body[fam] = { labeled: n, correct: t.correct, precision: Number(precision.toFixed(3)), passes: n >= LLM_GOLD_MIN_N && precision >= PRECISION_GATE, layer: "rules" };
      console.log(`${fam.padEnd(18)} rule layer, gold ${t.correct}/${n} = ${(precision * 100).toFixed(1)}% ${body[fam].passes ? "PASS" : "fail"}`);
    }
    for (const fam of LLM_LAYER_FAMILIES) {
      const t = g.results.llm.all[fam];
      if (!t) continue; // not in the gold schema (autoimmune): keeps its rule-label numbers
      const n = t.correct + t.incorrect;
      const precision = n ? t.correct / n : 0;
      body[fam] = { labeled: n, correct: t.correct, precision: Number(precision.toFixed(3)), passes: n >= LLM_GOLD_MIN_N && precision >= PRECISION_GATE, layer: "llm" };
      console.log(`${fam.padEnd(18)} LLM layer, gold ${t.correct}/${n} = ${(precision * 100).toFixed(1)}% ${body[fam].passes ? "PASS" : "fail"}`);
    }
  }
  writeFileSync(
    GENERATED,
    `/** GENERATED by \`npx tsx scripts/ingest/fact-precision.ts --measure\` from eval/facts-labels-v2.json and eval/llm-gold-results.json. Do not edit. */\nimport type { FactFamily } from "@/lib/ingest/eligibility-facts";\n\nexport interface FamilyPrecision { labeled: number; correct: number; precision: number; passes: boolean; layer?: "rules" | "llm" }\n\n/** Precision per v2 fact family: layer "rules" = provisional held-out labels; layer "llm" = verified-LLM layer on the blind gold sets (provisional labels, not clinicians). */\nexport const FAMILY_PRECISION: Readonly<Partial<Record<FactFamily, FamilyPrecision>>> = ${JSON.stringify(body, null, 2)};\n`,
  );
  console.log(`\nWrote ${GENERATED}`);
}

const cards = loadCards();
if (args.has("stats")) stats(cards);
else if (args.has("sample")) sample(cards);
else if (args.has("dump")) dump(cards);
else if (args.has("wrong")) wrong(cards);
else if (args.has("measure")) measure(cards);
else console.log("Use --stats, --sample or --measure");
