/**
 * Precision of COMMITTED directional facts for the LLM-verified layer vs the rules alone.
 *
 *   npx tsx scripts/ingest/llm-eval.ts --dev [--min=0.9] [--sweep] [--pending=N]
 *       Development split only (trial NCT-id hash = "dev"). Judges committed facts with the earlier labels
 *       (eval/facts-labels-v2.json, dev-partition items) plus internal dev labels of LLM outputs
 *       (eval/llm-dev-labels.json). Unjudged committed facts are listed (--pending) for labeling. Thresholds
 *       are chosen here and nowhere else.
 *   npx tsx scripts/ingest/llm-eval.ts --gold [--min=0.9]
 *       Final, one-shot measurement on the blind gold set (eval/gold/gold-v1.json, provisional labels, not
 *       clinicians'). Never tune on it. Writes eval/gold/llm-precision.json.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadCards } from "./cards";
import { readV2Cache, toTrialText } from "./llm";
import { applyLlmLayer, verifyFamilyFacts, familyCacheKey, LLM_FAMILY_IDS, type FamilyCacheEntry, type LlmFamily } from "../../lib/ingest/llm-families";
import { familyOf } from "../../lib/ingest/eligibility-facts";
import { partitionOf, type LabelFile } from "../../lib/ingest/precision";
import type { Fact, FactParam, TrialCard } from "../../lib/types/trial";
import { GOLD_FAMILY, judge, relevantGold, type GoldTrial } from "../../lib/ingest/gold";

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=") as [string, string | undefined]));
const DEV_LABELS = "eval/llm-dev-labels.json";

export interface DevLabel {
  id: string;
  key: string;
  value: "required" | "excluded";
  param?: FactParam;
  ref: string;
  quote: string;
  correct: boolean | null;
  why?: string;
}

const sig = (id: string, key: string, value: string, param: FactParam | undefined) => `${id}|${key}|${value}|${param ?? ""}`;
const refOf = (f: Fact) => `${f.ref.section === "inclusion" ? "I" : "E"}${f.ref.n}`;
const committed = (f: Fact) => f.value !== "mentioned" && !f.needsReview;

function results(card: TrialCard, cache: Map<string, FamilyCacheEntry>): Partial<Record<LlmFamily, FamilyCacheEntry>> {
  const out: Partial<Record<LlmFamily, FamilyCacheEntry>> = {};
  for (const fam of LLM_FAMILY_IDS) {
    const e = cache.get(familyCacheKey(card.id, card.lastUpdated, fam));
    if (e) out[fam] = e;
  }
  return out;
}

/** Final facts of one trial under the LLM policy (every LLM family gated). Trials never sent for a family keep an empty result => abstain. */
export function llmFinal(card: TrialCard, cache: Map<string, FamilyCacheEntry>, min: number): Fact[] {
  const res = results(card, cache);
  // A family the pre-filter skipped has no keyword in the text: an empty result is the same as "no facts".
  for (const fam of LLM_FAMILY_IDS) res[fam] ??= { model: "none", facts: [], invalid: 0, seconds: 0 };
  return applyLlmLayer(toTrialText(card), card.facts, res, new Set(LLM_FAMILY_IDS), { minConfidence: min });
}

function dev(cards: TrialCard[]): void {
  const cache = readV2Cache();
  const labels = JSON.parse(readFileSync("eval/facts-labels-v2.json", "utf8")) as LabelFile;
  const judged = new Map<string, boolean>();
  const labeledTrials = new Set<string>();
  for (const [fam, fl] of Object.entries(labels.families)) {
    if (!(LLM_FAMILY_IDS as readonly string[]).includes(fam)) continue;
    for (const it of fl.items) {
      if (it.correct === null || partitionOf(it.id) !== "dev") continue;
      judged.set(sig(it.id, it.key, it.value, it.param), it.correct);
      labeledTrials.add(it.id);
    }
  }
  const devLabels: DevLabel[] = existsSync(DEV_LABELS) ? (JSON.parse(readFileSync(DEV_LABELS, "utf8")) as { items: DevLabel[] }).items : [];
  for (const l of devLabels) if (l.correct !== null) judged.set(sig(l.id, l.key, l.value, l.param), l.correct);
  // Evaluate on dev trials that have at least one LLM result.
  const pool = cards.filter((c) => partitionOf(c.id) === "dev" && LLM_FAMILY_IDS.some((f) => cache.has(familyCacheKey(c.id, c.lastUpdated, f))));
  const sweep = args.has("sweep") ? [0, 0.5, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99, 0.995] : [Number(args.get("min") ?? 0.9)];
  console.log(`dev trials with LLM results: ${pool.length} (labeled rule trials among them: ${pool.filter((c) => labeledTrials.has(c.id)).length})`);
  const pending: DevLabel[] = [];
  for (const min of sweep) {
    const stat = new Map<string, { n: number; j: number; ok: number; rn: number; rj: number; rok: number }>();
    for (const c of pool) {
      const fin = llmFinal(c, cache, min);
      for (const fam of LLM_FAMILY_IDS) {
        const s = stat.get(fam) ?? { n: 0, j: 0, ok: 0, rn: 0, rj: 0, rok: 0 };
        for (const f of fin) {
          if (familyOf(f.key) !== fam || !committed(f)) continue;
          s.n++;
          const v = judged.get(sig(c.id, f.key, f.value, f.param));
          if (v === undefined) {
            if (min === sweep[sweep.length - 1] || sweep.length === 1) pending.push({ id: c.id, key: f.key, value: f.value as "required" | "excluded", ...(f.param !== undefined ? { param: f.param } : {}), ref: refOf(f), quote: f.quote, correct: null });
            continue;
          }
          s.j++;
          if (v) s.ok++;
          else if (args.has("wrong")) console.log(`WRONG ${c.id} ${f.key} ${f.value}${f.param !== undefined ? `(${f.param})` : ""} ${refOf(f)} :: ${f.quote.slice(0, 200)}`);
        }
        for (const f of c.facts) {
          if (familyOf(f.key) !== fam || !committed(f)) continue;
          s.rn++;
          const v = judged.get(sig(c.id, f.key, f.value, f.param));
          if (v === undefined) continue;
          s.rj++;
          if (v) s.rok++;
        }
        stat.set(fam, s);
      }
    }
    console.log(`\nmin confidence ${min}`);
    console.log("family             LLM committed  judged  precision   | rules committed  judged  precision");
    for (const [fam, s] of stat) console.log(`${fam.padEnd(18)} ${String(s.n).padStart(13)} ${String(s.j).padStart(7)} ${(s.j ? ((100 * s.ok) / s.j).toFixed(1) : "-").padStart(9)}%   | ${String(s.rn).padStart(15)} ${String(s.rj).padStart(7)} ${(s.rj ? ((100 * s.rok) / s.rj).toFixed(1) : "-").padStart(9)}%`);
  }
  if (args.has("reasons")) {
    const reasons = new Map<string, number>();
    for (const c of pool) for (const fam of LLM_FAMILY_IDS) {
      const e = cache.get(familyCacheKey(c.id, c.lastUpdated, fam));
      if (!e) continue;
      const checked = verifyFamilyFacts(fam, e.facts, toTrialText(c), { minConfidence: sweep[sweep.length - 1] as number });
      reasons.set(`${fam} dropped(unverifiable)`, (reasons.get(`${fam} dropped(unverifiable)`) ?? 0) + e.facts.length - checked.length);
      for (const x of checked) reasons.set(`${fam} ${x.reason ?? "committed"}`, (reasons.get(`${fam} ${x.reason ?? "committed"}`) ?? 0) + 1);
    }
    for (const [k, v] of [...reasons].sort()) console.log(`REASON ${k} ${v}`);
  }
  const n = Number(args.get("pending") ?? 0);
  if (n > 0) {
    const fam = args.get("family");
    for (const p of pending.filter((x) => !fam || familyOf(x.key) === fam).slice(0, n)) console.log(`PENDING ${JSON.stringify(p)}`);
  }
  console.log(`\nunjudged committed facts: ${pending.length}`);
}

/** Gold trial ids (v1 + v2) without reading any label. */
export function goldIds(): string[] {
  return ["eval/gold/gold-v1.json", "eval/gold/gold-v2.json"].filter(existsSync).flatMap((f) => (JSON.parse(readFileSync(f, "utf8")) as { trials: { trial_id: string }[] }).trials.map((t) => t.trial_id));
}

interface Tally { n: number; correct: number; incorrect: number; ambiguous: number; relevant: number; covered: number; coveredCorrect: number }
const tally = (): Tally => ({ n: 0, correct: 0, incorrect: 0, ambiguous: 0, relevant: 0, covered: 0, coveredCorrect: 0 });

function gold(cards: TrialCard[]): void {
  const min = Number(args.get("min") ?? 0.9);
  const cache = readV2Cache();
  const byId = new Map(cards.map((c) => [c.id, c]));
  const files: [string, string][] = [["v1", "eval/gold/gold-v1.json"], ["v2", "eval/gold/gold-v2.json"]];
  const fams = Object.keys(GOLD_FAMILY);
  // layer -> bucket ("all" | "v1" | "v2:keyword" | "v2:random") -> family -> tally
  const res: Record<string, Record<string, Record<string, Tally>>> = { rules: {}, llm: {} };
  const missingLlm: string[] = [];
  const errors: Record<string, string[]> = {};
  for (const [ver, file] of files) {
    for (const gt of (JSON.parse(readFileSync(file, "utf8")) as { trials: (GoldTrial & { stratum?: string })[] }).trials) {
      const card = byId.get(gt.trial_id);
      if (!card) continue;
      if (!LLM_FAMILY_IDS.some((f) => cache.has(familyCacheKey(card.id, card.lastUpdated, f)))) missingLlm.push(card.id);
      const layers: Record<string, Fact[]> = { rules: card.facts, llm: llmFinal(card, cache, min) };
      const buckets = ["all", ver === "v1" ? "v1" : `v2:${gt.stratum ?? "?"}`];
      for (const [layer, facts] of Object.entries(layers)) {
        for (const fam of fams) {
          const mine = facts.filter((f) => familyOf(f.key) === fam && committed(f));
          const verdicts = mine.map((f) => judge(fam, f, gt.labels));
          const relevant = relevantGold(fam, gt.labels);
          for (const b of buckets) {
            const t = ((res[layer] as Record<string, Record<string, Tally>>)[b] ??= {});
            const x = (t[fam] ??= tally());
            x.n += mine.length;
            for (const v of verdicts) x[v]++;
            if (relevant) {
              x.relevant++;
              if (mine.length) x.covered++;
              if (verdicts.includes("correct")) x.coveredCorrect++;
            }
          }
          if (layer === "llm") mine.forEach((f, i) => verdicts[i] === "incorrect" && (errors[fam] ??= []).push(`${card.id} ${f.key} ${f.value}${f.param !== undefined ? `(${f.param})` : ""} ${refOf(f)} :: ${f.quote.slice(0, 160)}`));
        }
      }
    }
  }
  if (missingLlm.length) console.log(`WARNING: ${missingLlm.length} gold trials without LLM results (run: npm run ingest:llm -- --ids <gold ids>)`);
  for (const b of ["all", "v1", "v2:keyword", "v2:random"]) {
    console.log(`\n== ${b} (min confidence ${min}; gold = provisional labels, not clinicians) ==`);
    console.log("family             | rules: n  prec   amb  cov        | LLM+verify: n  prec   amb  cov(any) cov(correct)");
    for (const fam of fams) {
      const r = res.rules?.[b]?.[fam] ?? tally();
      const l = res.llm?.[b]?.[fam] ?? tally();
      const p = (x: Tally) => (x.correct + x.incorrect ? `${((100 * x.correct) / (x.correct + x.incorrect)).toFixed(0)}%` : "-");
      console.log(`${fam.padEnd(18)} | ${String(r.n).padStart(8)} ${p(r).padStart(5)} ${String(r.ambiguous).padStart(5)} ${`${r.covered}/${r.relevant}`.padStart(8)}   | ${String(l.n).padStart(12)} ${p(l).padStart(5)} ${String(l.ambiguous).padStart(5)} ${`${l.covered}/${l.relevant}`.padStart(8)} ${`${l.coveredCorrect}/${l.relevant}`.padStart(8)}`);
    }
  }
  writeFileSync("eval/llm-gold-results.json", `${JSON.stringify({ note: "Gold = eval/gold/gold-v1.json + gold-v2.json, provisionally labeled (not clinicians); measured once, never tuned on. n = committed directional facts; precision excludes facts where gold says ambiguous (counted separately).", minConfidence: min, results: res, errors }, null, 1)}\n`);
  if (args.has("errors")) for (const [fam, e] of Object.entries(errors)) for (const x of e) console.log(`ERR ${fam} ${x}`);
}

const cards = loadCards();
if (args.has("dev")) dev(cards);
else if (args.has("gold")) gold(cards);
else if (args.has("gold-ids")) console.log(goldIds().join(","));
else console.log("Use --dev, --gold or --gold-ids");
