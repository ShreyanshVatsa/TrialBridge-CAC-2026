/**
 * Adaptive-vs-fixed questionnaire simulation (QUESTIONNAIRE_SPEC §7.2) on the committed seed trials.
 * SYNTHETIC patients: hidden "true" answers are sampled from catalog priors, and each patient says
 * "don't know" with a per-question probability. The oracle ranking uses every true answer. Seeded and
 * deterministic: the same seed and data always give the same numbers.
 * Also checks the non-response gate: unknown/skip answers never lower any trial's rank or score.
 * Run alone: `npx tsx scripts/eval/simulate.ts`; `npm run eval` calls runSimulation().
 */
import { CANCER_GROUP_IDS, type CancerGroupId } from "../../config/cancer-groups";
import { FACT_POLICY, getCatalog } from "../../config/questionnaire";
import { applyAnswer, createState, eligibleQuestions, rankPool, type CandidatePool } from "../../lib/questionnaire/engine";
import { runAdaptive, runAdaptiveCurve, runFixedCurve, samplePatient, simContext, type FlowResult } from "../../lib/questionnaire/simulate";
import type { QuestionnaireState } from "../../lib/types/questionnaire";
import type { TrialCard } from "../../lib/types/trial";
import { loadSeedCards } from "./common";
import { loadNational, type National } from "./national";

export const SIM_SEED = 20261007;
export const SIM_GROUPS: readonly CancerGroupId[] = CANCER_GROUP_IDS.slice(0, 12);
export const PATIENTS_PER_GROUP = 34; // 12 x 34 = 408
export const SIM_KS = [1, 3, 5, 7] as const;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimSummary {
  /** "seed" (committed, CI-reproducible) or "national" (public/data shards). */
  source: "seed" | "national";
  seed: number;
  patients: number;
  groups: number;
  trials: number;
  ks: readonly number[];
  adaptive: number[];
  fixed: number[];
  adaptiveConflict: number[];
  fixedConflict: number[];
  fullFixedNdcg: number;
  fullFixedQuestions: number;
  adaptiveBeatsFixedAtAllK: boolean;
  /** Smallest k (scanned over 1..CURVE_K) at which adaptive reaches 95% of the full fixed flow's nDCG, or null. */
  kFor95: number | null;
  /** kFor95 as a share of the full fixed flow's mean question count (target: <= 0.6). */
  shareFor95: number | null;
  /** Mean adaptive / fixed nDCG@10 for k = 1..CURVE_K. */
  adaptiveCurve: number[];
  fixedCurve: number[];
  quick: { medianQuestions: number; meanNdcg: number };
  nonResponse: { checks: number; rankDrops: number; scoreDrops: number };
}

/** How many questions the per-k curves cover (the full fixed flow asks about 13). */
export const CURVE_K = 14;

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const at = <T,>(curve: T[], k: number): T => curve[Math.min(k, curve.length - 1)] as T;

export function runSimulation(opts: { national?: National | null; seed?: number; groups?: readonly CancerGroupId[]; patientsPerGroup?: number } = {}): SimSummary {
  const nat = opts.national ?? null;
  const seedCards = nat ? null : loadSeedCards(new Map()).cards;
  const seed = opts.seed ?? SIM_SEED;
  const groups = opts.groups ?? SIM_GROUPS;
  const perGroup = opts.patientsPerGroup ?? PATIENTS_PER_GROUP;
  const r = mulberry32(seed);
  const rows: Array<{ a: number[]; f: number[]; ac: number[]; fc: number[]; full: number; fullLen: number; quickLen: number; quick: number }> = [];
  const nr = { checks: 0, rankDrops: 0, scoreDrops: 0 };
  let trialCount = 0;
  const kMax = Math.max(...SIM_KS);

  for (const g of groups) {
    const catalog = getCatalog("cancer", g);
    const cards = nat ? nat.entries(g).map((e) => e.card) : (seedCards as TrialCard[]);
    const sorted = cards.filter((c) => c.groups.includes(g)).sort((a, b) => a.id.localeCompare(b.id));
    trialCount += sorted.length;
    // Prior: fixed deterministic order (no query text exists for a synthetic patient), decaying from 1.
    const pool: CandidatePool = { group: g, trials: sorted.map((c, i, all) => ({ id: c.id, prior: 1 - i / all.length, facts: c.facts, sex: c.sex })) };
    const base: QuestionnaireState = { ...createState("quick", 1), answers: { cancer_type: g, age: 55, zip: "02115", travel: null }, history: ["cancer_type", "age", "zip", "travel"] };
    for (let i = 0; i < perGroup; i++) {
      const patient = samplePatient(r, base, catalog, g);
      const ctx = simContext(pool, catalog, base, patient, FACT_POLICY);
      const fixedCurve = runFixedCurve(ctx, 99);
      const full = fixedCurve[fixedCurve.length - 1] as FlowResult;
      const quick = runAdaptive(ctx, 99, "quick");
      const adCurve = runAdaptiveCurve(ctx, CURVE_K);
      const fxK = (k: number) => at(fixedCurve, k);
      const adK = (k: number) => at(adCurve, k);
      const ks = Array.from({ length: CURVE_K }, (_, j) => j + 1);
      rows.push({
        a: ks.map((k) => adK(k).ndcg),
        f: ks.map((k) => fxK(k).ndcg),
        ac: ks.map((k) => adK(k).conflictShare),
        fc: ks.map((k) => fxK(k).conflictShare),
        full: full.ndcg,
        fullLen: full.asked.length,
        quickLen: quick.asked.length,
        quick: quick.ndcg,
      });

      // Non-response gate: on a state where the patient has really answered two questions, answering
      // "don't know" or skipping any other eligible question must not lower any trial's score or rank.
      let withTruth = base;
      for (const q of eligibleQuestions(base, pool, catalog).slice(0, 2)) {
        const t = patient.truth[q.id];
        if (t !== undefined) withTruth = applyAnswer(withTruth, q.id, t, catalog, { now: 1 }).state;
      }
      const before = rankPool(withTruth, pool, catalog, { policy: FACT_POLICY });
      const rankBefore = new Map(before.map((x, idx) => [x.id, idx]));
      const scoreBefore = new Map(before.map((x) => [x.id, x.score]));
      for (const q of eligibleQuestions(withTruth, pool, catalog).slice(0, kMax)) {
        for (const v of ["unknown", "__skip"] as const) {
          const s = applyAnswer(withTruth, q.id, q.type === "multi" ? [v] : v, catalog, { now: 1 }).state;
          const after = rankPool(s, pool, catalog, { policy: FACT_POLICY });
          nr.checks++;
          after.forEach((x, idx) => {
            if (idx > (rankBefore.get(x.id) as number)) nr.rankDrops++;
            if (x.score < (scoreBefore.get(x.id) as number) - 1e-9) nr.scoreDrops++;
          });
        }
      }
    }
  }
  const col = (pick: (x: (typeof rows)[number]) => number[], k: number) => mean(rows.map((x) => pick(x)[k - 1] as number));
  const adaptiveCurve = Array.from({ length: CURVE_K }, (_, j) => col((x) => x.a, j + 1));
  const fixedCurve = Array.from({ length: CURVE_K }, (_, j) => col((x) => x.f, j + 1));
  const adaptive = SIM_KS.map((k) => adaptiveCurve[k - 1] as number);
  const fixed = SIM_KS.map((k) => fixedCurve[k - 1] as number);
  const fullFixedNdcg = mean(rows.map((x) => x.full));
  const fullFixedQuestions = mean(rows.map((x) => x.fullLen));
  const lens = rows.map((x) => x.quickLen).sort((a, b) => a - b);
  const kFor95 = adaptiveCurve.findIndex((v) => v >= 0.95 * fullFixedNdcg);
  return {
    source: nat ? "national" : "seed",
    seed,
    patients: rows.length,
    groups: groups.length,
    trials: trialCount,
    ks: SIM_KS,
    adaptive,
    fixed,
    adaptiveConflict: SIM_KS.map((k) => col((x) => x.ac, k)),
    fixedConflict: SIM_KS.map((k) => col((x) => x.fc, k)),
    fullFixedNdcg,
    fullFixedQuestions,
    adaptiveBeatsFixedAtAllK: adaptive.every((v, j) => v >= (fixed[j] as number) - 1e-9),
    kFor95: kFor95 < 0 ? null : kFor95 + 1,
    shareFor95: kFor95 < 0 ? null : (kFor95 + 1) / fullFixedQuestions,
    adaptiveCurve,
    fixedCurve,
    quick: { medianQuestions: lens[Math.floor(lens.length / 2)] as number, meanNdcg: mean(rows.map((x) => x.quick)) },
    nonResponse: nr,
  };
}

const f3 = (n: number) => n.toFixed(3);

export function simulationMarkdown(s: SimSummary, nat?: SimSummary | null): string {
  const table = (x: SimSummary) =>
    x.ks.map((k, j) => `| ${k} | ${f3(x.adaptive[j] as number)} | ${f3(x.fixed[j] as number)} | ${((x.adaptive[j] as number) - (x.fixed[j] as number) >= 0 ? "+" : "") + ((x.adaptive[j] as number) - (x.fixed[j] as number)).toFixed(3)} | ${f3(x.adaptiveConflict[j] as number)} | ${f3(x.fixedConflict[j] as number)} |`).join("\n");
  const head = "| Questions asked (k) | Adaptive nDCG@10 | Fixed-order nDCG@10 | Adaptive - fixed | Adaptive conflict share | Fixed conflict share |\n|---|---|---|---|---|---|";
  const verdict = (x: SimSummary) => {
    const behind = x.ks.filter((_, j) => (x.adaptive[j] as number) < (x.fixed[j] as number) - 1e-9);
    const curveBehind = x.adaptiveCurve.map((v, j) => (v < (x.fixedCurve[j] as number) - 1e-9 ? j + 1 : 0)).filter(Boolean);
    return `- Full fixed flow: nDCG@10 **${f3(x.fullFixedNdcg)}** with ${x.fullFixedQuestions.toFixed(1)} questions on average. Adaptive first reaches 95% of that at k = **${x.kFor95 ?? "none of the tested k"}**${x.shareFor95 === null ? "" : ` (${(100 * x.shareFor95).toFixed(0)}% of the fixed flow's questions; target <= 60%: **${x.shareFor95 <= 0.6 ? "met" : "not met"}**)`}.
- Adaptive beats or ties fixed at k = 1, 3, 5, 7: **${behind.length === 0 ? "yes" : "no"}**${behind.length ? ` (behind at k = ${behind.join(", ")})` : ""}; at every k from 1 to ${x.adaptiveCurve.length}: **${curveBehind.length === 0 ? "yes" : "no (behind at k = " + curveBehind.join(", ") + ")"}**.
- Quick mode: median **${x.quick.medianQuestions}** adaptive questions, mean nDCG@10 ${f3(x.quick.meanNdcg)}.
- Non-response gate: ${x.nonResponse.checks} unknown/skip answers (two per eligible question, per simulated patient) changed no trial's rank for the worse (**${x.nonResponse.rankDrops}** rank drops) or score (**${x.nonResponse.scoreDrops}** score drops).`;
  };
  return `## Questionnaire: adaptive vs fixed (simulated patients)
> **Synthetic, provisional.** ${s.patients} simulated patients (${s.patients / s.groups} per group x ${s.groups} cancer groups; seed ${s.seed}). Hidden "true" answers are sampled from the catalog's own priors, patients say "don't know" at 40% (biomarkers), 20% (ECOG), 25% (lines), 30% (subtype) and 10% (others), and the oracle ranking is the same engine with every true answer. This measures how fast each question order approaches the engine's own full-information ranking. It is **not** a measure of clinical accuracy, it shares the fact layer (66% precision) with the system under test, and the priors are catalog estimates, not real-patient data. The seed run (${s.trials} trials) is CI-reproducible; the national run uses the shards in public/data when present. The engine picks questions by information gain plus the expected change of the top 10 (docs/dev/QUESTIONNAIRE_SPEC.md); the engine constants were tuned on a different patient draw (seed 777, six of the twelve groups), so these numbers (seed ${s.seed}, all groups) are held-out.

### Seed (${s.trials} trials)
nDCG@10 against the oracle top 10 (mean over patients) and the share of the flow's top 10 that conflicts with the patient's true answers:

${head}
${table(s)}

${verdict(s)}
${nat ? `
### National (${nat.trials} trials in the ${nat.groups} groups, ${nat.patients} patients)
${head}
${table(nat)}

${verdict(nat)}
` : "\n_National run skipped: no public/data shards on this machine._\n"}`;
}

/** One-screen summary for tuning runs. */
export function simulationBrief(s: SimSummary): string {
  const row = (name: string, xs: number[]) => `${name.padEnd(9)}${xs.map((x) => f3(x)).join(" ")}`;
  return [
    `${s.source}: ${s.patients} patients, ${s.trials} trials; full fixed ${f3(s.fullFixedNdcg)} in ${s.fullFixedQuestions.toFixed(1)} questions; adaptive reaches 95% at k=${s.kFor95} (${s.shareFor95 === null ? "n/a" : (100 * s.shareFor95).toFixed(0) + "%"} of the questions); quick median ${s.quick.medianQuestions} @ ${f3(s.quick.meanNdcg)}`,
    `k        ${s.adaptiveCurve.map((_, j) => String(j + 1).padStart(5)).join(" ")}`,
    row("adaptive", s.adaptiveCurve),
    row("fixed", s.fixedCurve),
    `adaptive - fixed at k=1,3,5,7: ${s.ks.map((k, j) => `${k}:${((s.adaptive[j] as number) - (s.fixed[j] as number)).toFixed(3)}`).join(" ")}; non-response drops ${s.nonResponse.rankDrops + s.nonResponse.scoreDrops}`,
  ].join("\n");
}

if (process.argv[1]?.endsWith("simulate.ts")) {
  const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const wantNational = process.argv.includes("--national");
  const groupIdx = arg("groups")?.split(",").map(Number);
  const national = wantNational ? loadNational() : null;
  if (wantNational && !national) throw new Error("no national data (public/data or NATIONAL_DIR)");
  const t0 = Date.now();
  const s = runSimulation({
    national,
    ...(arg("seed") ? { seed: Number(arg("seed")) } : {}),
    ...(groupIdx ? { groups: groupIdx.map((i) => SIM_GROUPS[i] as CancerGroupId) } : {}),
    ...(arg("patients") ? { patientsPerGroup: Number(arg("patients")) } : {}),
  });
  console.log(process.argv.includes("--md") ? simulationMarkdown(s) : process.argv.includes("--json") ? JSON.stringify(s) : simulationBrief(s));
  const cpu = process.cpuUsage();
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s wall, ${((cpu.user + cpu.system) / 1e6).toFixed(1)} s cpu)`);
}
