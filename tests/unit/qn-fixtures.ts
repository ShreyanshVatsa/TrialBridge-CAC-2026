/**
 * Small contract-shaped test catalog for the engine and matching tests (QUESTIONNAIRE_SPEC §1.2/§1.3).
 * It encodes the v1 pre-check semantics (spread, treatments, biomarkers, pregnancy, concurrent trial) as
 * catalog data, so evaluateAnswers can be checked against the legacy precheck, plus the new parameterized
 * rules (ECOG, lines, brain mets carve-out, histology, HIV carve-out, sex hard filter).
 */
import type { CancerGroupId } from "@/config/cancer-groups";
import type { BiomarkerId } from "@/config/biomarkers";
import type { FactRule, OptionEffect, QuestionDef } from "@/config/questionnaire/types";
import type { FactKey } from "@/lib/types/trial";
import { createState, type CandidatePool, type CompactFact, type PoolTrial } from "@/lib/questionnaire/engine";
import type { AnswerValue, QuestionnaireState } from "@/lib/types/questionnaire";

const k = (s: string) => `questionnaire.${s}` as const;
const opt = (id: string) => ({ id, labelKey: k(id) });
const NR = ["unknown", "__skip"];
const eff = (option: string, facts: FactRule[] = [], extra: Partial<OptionEffect> = {}): OptionEffect => ({ option, facts, ...extra });
const nrEffects = (ids: string[] = NR) => ids.map((id) => eff(id));

function q(def: Partial<QuestionDef> & Pick<QuestionDef, "id" | "tier" | "type">): QuestionDef {
  return {
    area: "cancer",
    labelKey: k(`${def.id}.label`),
    helpKey: k(`${def.id}.help`),
    whyKey: k(`${def.id}.why`),
    appliesTo: "all",
    cost: 1,
    effects: [],
    enabled: true,
    evidence: "test",
    families: [],
    ...def,
  } as QuestionDef;
}

const TREATMENT_FACT: Record<string, FactKey> = {
  chemotherapy: "prior_chemotherapy",
  radiation: "prior_radiation",
  surgery: "prior_surgery",
  immunotherapy: "prior_immunotherapy",
  targeted_therapy: "prior_targeted_therapy",
};

export const TEST_CATALOG: readonly QuestionDef[] = [
  q({ id: "cancer_type", tier: "essential", type: "group_picker" }),
  q({ id: "age", tier: "essential", type: "age" }),
  q({ id: "zip", tier: "essential", type: "zip" }),
  q({ id: "travel", tier: "essential", type: "travel", prerequisites: [{ question: "zip", anyOf: ["*"] }] }),
  q({
    id: "subtype",
    tier: "helpful",
    type: "single",
    appliesTo: ["lung"],
    cost: 2,
    findOutKey: "findOut.subtype.what" as never,
    options: ["nsclc_adeno", "nsclc_squamous", "sclc", ...NR].map(opt),
    effects: [
      eff("nsclc_adeno", [{ fact: "histology:sclc", whenRequired: "conflict" }, { fact: "histology:nsclc", whenRequired: "support", whenExcluded: "conflict" }], { queryTerms: ["Non-small cell lung adenocarcinoma."] }),
      eff("nsclc_squamous", [{ fact: "histology:sclc", whenRequired: "conflict" }, { fact: "histology:nsclc", whenRequired: "support", whenExcluded: "conflict" }, { fact: "histology:lung_squamous", whenRequired: "support", whenExcluded: "conflict" }]),
      eff("sclc", [{ fact: "histology:sclc", whenRequired: "support", whenExcluded: "conflict" }, { fact: "histology:nsclc", whenRequired: "conflict" }], { queryTerms: ["Small cell lung cancer."] }),
      ...nrEffects(),
    ],
    priors: { lung: { nsclc_adeno: 0.4, nsclc_squamous: 0.15, sclc: 0.15, unknown: 0.3 } },
  }),
  q({
    id: "spread",
    tier: "helpful",
    type: "single",
    excludeGroups: ["leukemia", "lymphoma", "myeloma"],
    findOutKey: "findOut.spread.what" as never,
    aiField: "stageCategory",
    options: ["early", "locally_advanced", "metastatic", "no_evidence_after_surgery", ...NR].map(opt),
    effects: [
      eff("early", [{ fact: "metastatic", whenRequired: "conflict" }], { queryTerms: ["Localized early stage disease."] }),
      eff("locally_advanced", [{ fact: "metastatic", whenRequired: "conflict" }]),
      eff("metastatic", [{ fact: "metastatic", whenRequired: "support", whenExcluded: "conflict" }], { queryTerms: ["Metastatic advanced stage IV disease."] }),
      eff("no_evidence_after_surgery", [{ fact: "metastatic", whenRequired: "conflict" }]),
      ...nrEffects(),
    ],
  }),
  q({
    id: "treatments",
    tier: "helpful",
    type: "multi",
    aiField: "treatments",
    options: [...Object.keys(TREATMENT_FACT), "none", "unknown"].map(opt),
    effects: [
      ...Object.entries(TREATMENT_FACT).map(([t, fact]) =>
        eff(t, [{ fact, whenRequired: "support", whenExcluded: "conflict" }, { fact: "previously_treated", whenRequired: "support" }, { fact: "newly_diagnosed", whenRequired: "conflict", whenExcluded: "conflict" }], { queryTerms: [`Previously treated with ${t}.`] }),
      ),
      eff("none", [{ fact: "newly_diagnosed", whenRequired: "support" }, { fact: "previously_treated", whenRequired: "conflict", whenExcluded: "conflict" }], { queryTerms: ["Newly diagnosed, previously untreated."] }),
      eff("unknown"),
    ],
  }),
  q({
    id: "lines",
    tier: "helpful",
    type: "single",
    cost: 2,
    prerequisites: [{ question: "treatments", anyOf: ["none"], negate: true }],
    aiField: "priorLines",
    options: ["1", "2", "3+", ...NR].map(opt),
    effects: [
      ...[
        ["1", 1],
        ["2", 2],
        ["3+", 3],
      ].map(([id, n]) =>
        eff(id as string, [
          { fact: "min_prior_lines", whenRequired: "support", paramCompare: { op: "gte", value: n as number, else: "conflict" } },
          { fact: "max_prior_lines", whenRequired: "support", paramCompare: { op: "lte", value: n as number, else: "conflict" } },
        ]),
      ),
      ...nrEffects(),
    ],
  }),
  q({
    id: "daily_activity",
    tier: "helpful",
    type: "single",
    aiField: "activityBand",
    findOutKey: "findOut.ecog.what" as never,
    options: ["0-1", "2", "3-4", ...NR].map(opt),
    effects: [
      ...[
        ["0-1", 1],
        ["2", 2],
        ["3-4", 4],
      ].map(([id, n]) => eff(id as string, [{ fact: "ecog_max", whenRequired: "support", paramCompare: { op: "lte", value: n as number, else: "conflict" } }])),
      ...nrEffects(),
    ],
    priors: { lung: { "0-1": 0.5, "2": 0.25, "3-4": 0.05, unknown: 0.2 } },
  }),
  q({
    id: "biomarkers",
    tier: "helpful",
    type: "biomarker_grid",
    cost: 3,
    findOutKey: "findOut.biomarkers.what" as never,
    aiField: "biomarkers",
    biomarkers: ["EGFR", "ALK", "HER2", "HR"] as BiomarkerId[],
    effects: [],
  }),
  q({
    id: "brain_mets",
    tier: "helpful",
    type: "single",
    cost: 2,
    prerequisites: [{ question: "spread", anyOf: ["metastatic", "unknown"] }],
    aiField: "brainMets",
    options: ["none", "treated_stable", "active", ...NR].map(opt),
    effects: [
      eff("none", [{ fact: "brain_mets", whenRequired: "conflict" }]),
      eff("treated_stable", [{ fact: "brain_mets", whenRequired: "support", whenExcluded: "conflict", paramIn: ["*"] }]),
      eff("active", [{ fact: "brain_mets", whenRequired: "support", whenExcluded: "conflict" }]),
      ...nrEffects(),
    ],
  }),
  q({
    id: "sex",
    tier: "helpful",
    type: "single",
    options: ["female", "male", "prefer_not", "unknown"].map(opt),
    effects: [eff("female", [], { hardFilter: { sex: "FEMALE" } }), eff("male", [], { hardFilter: { sex: "MALE" } }), eff("prefer_not"), eff("unknown")],
  }),
  q({
    id: "pregnancy",
    tier: "helpful",
    type: "single",
    sensitive: true,
    aiField: "pregnant",
    prerequisites: [{ question: "sex", anyOf: ["male"], negate: true }],
    options: ["yes", "no", "prefer_not", ...NR].map(opt),
    effects: [eff("yes", [{ fact: "pregnancy", whenRequired: "conflict", whenExcluded: "conflict" }]), eff("no"), eff("prefer_not"), ...nrEffects()],
    priors: { lung: { yes: 0.01, no: 0.9, unknown: 0.04, prefer_not: 0.05 } },
  }),
  q({
    id: "hiv",
    tier: "deep",
    type: "single",
    sensitive: true,
    options: ["no", "controlled", "other", "prefer_not", ...NR].map(opt),
    effects: [eff("no"), eff("controlled", [{ fact: "hiv", whenExcluded: "conflict", paramIn: ["*"] }]), eff("other", [{ fact: "hiv", whenExcluded: "conflict" }]), eff("prefer_not"), ...nrEffects()],
  }),
  q({
    id: "in_other_trial",
    tier: "deep",
    type: "single",
    aiField: "concurrentTrial",
    options: ["yes", "no", ...NR].map(opt),
    effects: [eff("yes", [{ fact: "concurrent_trial", whenRequired: "conflict", whenExcluded: "conflict" }]), eff("no"), ...nrEffects()],
  }),
  q({
    id: "phase_pref",
    tier: "deep",
    type: "single",
    options: ["open_phase1", "later_phase", "no_pref", ...NR].map(opt),
    effects: [eff("open_phase1"), eff("later_phase"), eff("no_pref"), ...nrEffects()],
  }),
  q({ id: "measurable", tier: "deep", type: "single", enabled: false, options: ["yes", "no", ...NR].map(opt), effects: [eff("yes"), eff("no"), ...nrEffects()] }),
];

export const FIND_OUT = {
  biomarkers: { whatKey: "findOut.biomarkers.what", whereKey: "findOut.biomarkers.where", whyKey: "findOut.biomarkers.why" },
  daily_activity: { whatKey: "findOut.ecog.what", whereKey: "findOut.ecog.where", whyKey: "findOut.ecog.why" },
} as const;

/** Seeded PRNG (mulberry32) for deterministic property tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;

/** A state with the essentials answered (lung by default). */
export function essentials(group: CancerGroupId = "lung", extra: Record<string, AnswerValue> = {}): QuestionnaireState {
  const s = createState("quick", 1_000);
  return { ...s, answers: { cancer_type: group, age: 60, zip: "10001", travel: 100, ...extra }, history: ["cancer_type", "age", "zip", "travel", ...Object.keys(extra)] };
}

const FACT_POOL: Array<() => CompactFact> = [
  () => ({ key: "metastatic", value: "required" }),
  () => ({ key: "metastatic", value: "excluded" }),
  () => ({ key: "prior_chemotherapy", value: "required" }),
  () => ({ key: "prior_immunotherapy", value: "excluded" }),
  () => ({ key: "previously_treated", value: "required" }),
  () => ({ key: "newly_diagnosed", value: "required" }),
  () => ({ key: "biomarker:EGFR", value: "required" }),
  () => ({ key: "biomarker:ALK", value: "required" }),
  () => ({ key: "biomarker:EGFR", value: "excluded" }),
  () => ({ key: "histology:sclc", value: "required" }),
  () => ({ key: "histology:nsclc", value: "required" }),
  () => ({ key: "ecog_max", value: "required", param: 1 }),
  () => ({ key: "ecog_max", value: "required", param: 2 }),
  () => ({ key: "min_prior_lines", value: "required", param: 2 }),
  () => ({ key: "max_prior_lines", value: "required", param: 1 }),
  () => ({ key: "brain_mets", value: "excluded", param: "active_only" }),
  () => ({ key: "brain_mets", value: "excluded" }),
  () => ({ key: "pregnancy", value: "excluded" }),
  () => ({ key: "hiv", value: "excluded", param: "uncontrolled_only" }),
  () => ({ key: "concurrent_trial", value: "excluded" }),
  () => ({ key: "prior_radiation", value: "mentioned" }),
];

/** A synthetic candidate pool: random priors, facts and sex restrictions (seeded). */
/**
 * Group-skewed fact mix (like §0.2: what gates trials differs by group). Index into FACT_POOL -> weight.
 * Here: ECOG, brain metastases, biomarker and HIV/concurrent-trial rules are common; histology,
 * spread and treatment rules are rare, so a fixed catalog order wastes its first questions.
 */
export const SKEWED_WEIGHTS: readonly number[] = [0.3, 0.3, 0.2, 0.2, 0.2, 0.2, 3, 2, 1, 0.3, 0.3, 4, 3, 1, 1, 3, 2, 1, 2, 2, 1];

export function makePool(seed: number, n = 120, group: CancerGroupId = "lung", weights?: readonly number[]): CandidatePool {
  const r = rng(seed);
  const trials: PoolTrial[] = [];
  const total = weights?.reduce((a, b) => a + b, 0) ?? 0;
  const draw = (): CompactFact => {
    if (!weights) return pick(r, FACT_POOL)();
    let x = r() * total;
    for (let i = 0; i < FACT_POOL.length; i++) if ((x -= weights[i] ?? 0) <= 0) return (FACT_POOL[i] as () => CompactFact)();
    return (FACT_POOL[FACT_POOL.length - 1] as () => CompactFact)();
  };
  for (let i = 0; i < n; i++) {
    const facts: CompactFact[] = [];
    const nf = Math.floor(r() * 5);
    for (let j = 0; j < nf; j++) facts.push(draw());
    const sx = r();
    trials.push({ id: `NCT${String(10000000 + i)}`, prior: r(), facts, sex: sx < 0.1 ? "FEMALE" : sx < 0.15 ? "MALE" : "ALL" });
  }
  return { group, trials };
}
