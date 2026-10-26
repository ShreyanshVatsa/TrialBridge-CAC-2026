/**
 * Cross-cancer questions (QUESTIONNAIRE_SPEC §1.3). Group-specific questions (subtype, group status,
 * prior drug classes, biomarker lists) live in ./cancer/<group>.ts. Order here = catalog order.
 * Evidence lines quote the national analysis of 2026-10-07 (5,726 trials).
 */
import { CANCER_GROUP_IDS, HEMATOLOGIC_GROUPS, type CancerGroupId } from "@/config/cancer-groups";
import { findOutKey, has, lacks, nonResponseEffects, options, priors, question } from "./build";
import { DEFERRED, PREFER_NOT, SKIP, UNKNOWN, type QuestionDef } from "./types";

/** Solid-tumor groups (spread, brain metastases). "other" = not sure, so it is included. */
const SOLID_GROUPS: readonly CancerGroupId[] = CANCER_GROUP_IDS.filter((g) => !HEMATOLOGIC_GROUPS.includes(g));
/** Groups where "measurable disease" rules are common (solid, myeloma, lymphoma). */
const MEASURABLE_GROUPS: readonly CancerGroupId[] = CANCER_GROUP_IDS.filter((g) => g !== "leukemia");

export const ESSENTIALS: readonly QuestionDef[] = [
  question({ id: "cancer_type", tier: "essential", type: "group_picker", appliesTo: "all", cost: 1, effects: [], enabled: true, evidence: "hard filter: cancer group and shard choice", families: [] }),
  question({ id: "age", tier: "essential", type: "age", appliesTo: "all", cost: 1, effects: [], enabled: true, evidence: "hard filter: structured minimum/maximum age", families: [] }),
  question({ id: "zip", tier: "essential", type: "zip", appliesTo: "all", cost: 1, effects: [], enabled: true, evidence: "hard filter: distance origin; 50% of trials have a single U.S. site", families: [] }),
  question({ id: "travel", tier: "essential", type: "travel", appliesTo: "all", prerequisites: [{ question: "zip", anyOf: [], negate: true }], cost: 1, effects: [], enabled: true, evidence: "hard filter: travel distance", families: [] }),
];

const spread = question({
  id: "spread",
  tier: "helpful",
  type: "single",
  options: options("spread", ["not_spread", "nearby", "distant", "removed"]),
  appliesTo: SOLID_GROUPS,
  cost: 1,
  effects: [
    { option: "not_spread", facts: [lacks("metastatic"), lacks("locally_advanced")], queryTerms: ["early stage", "localized"] },
    { option: "nearby", facts: [lacks("metastatic"), has("locally_advanced")], queryTerms: ["locally advanced"] },
    { option: "distant", facts: [has("metastatic"), lacks("locally_advanced"), lacks("adjuvant_setting"), lacks("resectable")], queryTerms: ["metastatic", "advanced"] },
    { option: "removed", facts: [has("adjuvant_setting"), lacks("metastatic"), lacks("measurable_disease")], queryTerms: ["completely resected", "adjuvant"] },
    ...nonResponseEffects(),
  ],
  findOutKey: findOutKey("spread"),
  aiField: "stageCategory",
  priors: Object.fromEntries(SOLID_GROUPS.map((g) => [g, priors({ not_spread: 0.15, nearby: 0.2, distant: 0.4, removed: 0.1, unknown: 0.15 })])),
  enabled: true,
  evidence: "metastatic/advanced/unresectable mentioned in 68-83% of solid-tumor trials",
  families: ["stage"],
  legacyFacts: true,
});

const diseaseStatus = question({
  id: "disease_status",
  tier: "helpful",
  type: "single",
  options: options("disease_status", ["new", "recurrent", "on_treatment"]),
  appliesTo: "all",
  cost: 1,
  effects: [
    {
      option: "new",
      facts: [has("newly_diagnosed"), lacks("previously_treated"), lacks("recurrent"), { fact: "min_prior_lines", paramCompare: { op: "gte", value: 0, else: "conflict" } }],
      queryTerms: ["newly diagnosed", "previously untreated"],
    },
    { option: "recurrent", facts: [has("recurrent"), has("previously_treated"), lacks("newly_diagnosed")], queryTerms: ["relapsed", "refractory", "recurrent"] },
    { option: "on_treatment", facts: [has("previously_treated"), lacks("newly_diagnosed")], queryTerms: [] },
    ...nonResponseEffects(),
  ],
  aiField: "diseaseStatus",
  priors: Object.fromEntries(CANCER_GROUP_IDS.map((g) => [g, priors({ new: 0.3, recurrent: 0.35, on_treatment: 0.25, unknown: 0.1 })])),
  enabled: true,
  evidence: "newly diagnosed 23%, relapsed/refractory/recurrent 42% of trials (54-58% in leukemia, lymphoma, ovarian, sarcoma)",
  families: ["recurrent"],
  legacyFacts: true,
});

const TREATMENTS = ["chemotherapy", "radiation", "surgery", "immunotherapy", "targeted_therapy", "hormone_therapy", "stem_cell_transplant", "none"] as const;
const treatments = question({
  id: "treatments",
  tier: "helpful",
  type: "multi",
  options: options("treatments", TREATMENTS, { exclusive: ["none"] }),
  appliesTo: "all",
  cost: 1,
  effects: [
    { option: "chemotherapy", facts: [has("prior_chemotherapy")], queryTerms: ["previously treated with chemotherapy"] },
    { option: "radiation", facts: [has("prior_radiation")], queryTerms: ["prior radiation"] },
    { option: "surgery", facts: [has("prior_surgery")], queryTerms: ["prior surgery"] },
    { option: "immunotherapy", facts: [has("prior_immunotherapy")], queryTerms: ["prior immunotherapy"] },
    { option: "targeted_therapy", facts: [has("prior_targeted_therapy")], queryTerms: ["prior targeted therapy"] },
    // Hormone therapy is broad (breast endocrine therapy, prostate ADT): only the breast class can conflict.
    { option: "hormone_therapy", facts: [has("prior_drug:endocrine"), { fact: "prior_drug:arpi", whenRequired: "support", whenExcluded: "neutral" }], queryTerms: ["prior hormone therapy"] },
    { option: "stem_cell_transplant", facts: [{ fact: "prior_drug:auto_sct", whenRequired: "support", whenExcluded: "neutral" }, { fact: "allo_sct", whenRequired: "support", whenExcluded: "neutral" }], queryTerms: ["prior stem cell transplant"] },
    {
      option: "none",
      facts: [lacks("prior_chemotherapy"), lacks("prior_radiation"), lacks("prior_surgery"), lacks("prior_immunotherapy"), lacks("prior_targeted_therapy"), lacks("previously_treated"), has("newly_diagnosed")],
      queryTerms: ["treatment naive"],
    },
    ...nonResponseEffects(),
  ],
  aiField: "treatments",
  enabled: true,
  evidence: "prior-therapy rules in 46-51% of trials",
  families: ["prior_drug", "transplant"],
  legacyFacts: true,
});

/** Patient line count vs trial minimum/maximum lines. */
const lineRules = (n: number) => [
  { fact: "min_prior_lines" as const, whenRequired: "support" as const, paramCompare: { op: "gte" as const, value: n, else: "conflict" as const } },
  { fact: "max_prior_lines" as const, whenRequired: "support" as const, paramCompare: { op: "lte" as const, value: n, else: "conflict" as const } },
];
const lines = question({
  id: "lines",
  tier: "helpful",
  type: "single",
  options: [...options("lines", ["1", "2", "3plus"]), { id: DEFERRED, labelKey: "questionnaire.common.deferred" }],
  appliesTo: "all",
  prerequisites: [{ question: "disease_status", anyOf: ["new"], negate: true }],
  cost: 2,
  effects: [
    { option: "1", facts: lineRules(1), queryTerms: ["one prior line of therapy"] },
    { option: "2", facts: lineRules(2), queryTerms: ["two prior lines of therapy"] },
    { option: "3plus", facts: lineRules(3), queryTerms: ["three or more prior lines of therapy", "heavily pretreated"] },
    ...nonResponseEffects(),
    { option: DEFERRED, facts: [] },
  ],
  findOutKey: findOutKey("lines"),
  aiField: "priorLines",
  priors: Object.fromEntries(CANCER_GROUP_IDS.map((g) => [g, priors({ "1": 0.3, "2": 0.2, "3plus": 0.2, unknown: 0.3 })])),
  enabled: true,
  evidence: "counted prior lines in 20% of trials (29-39% in lung, ovarian, lymphoma, myeloma, gastroesophageal)",
  families: ["lines"],
});

const ecog = (n: number) => [{ fact: "ecog_max" as const, whenRequired: "support" as const, paramCompare: { op: "lte" as const, value: n, else: "conflict" as const } }];
const dailyActivity = question({
  id: "daily_activity",
  tier: "helpful",
  type: "single",
  options: options("daily_activity", ["0-1", "2", "3-4"]),
  appliesTo: "all",
  cost: 1,
  effects: [
    { option: "0-1", facts: ecog(1), queryTerms: [] },
    { option: "2", facts: ecog(2), queryTerms: ["ECOG 2"] },
    { option: "3-4", facts: ecog(3), queryTerms: [] },
    ...nonResponseEffects(),
  ],
  findOutKey: findOutKey("daily_activity"),
  aiField: "activityBand",
  priors: Object.fromEntries(CANCER_GROUP_IDS.map((g) => [g, priors({ "0-1": 0.6, "2": 0.18, "3-4": 0.07, unknown: 0.15 })])),
  enabled: true,
  evidence: "performance status rules in 67% of trials; ECOG <=1 in 1,478 vs <=2 in 1,309",
  families: ["performance"],
});

const brainMets = question({
  id: "brain_mets",
  tier: "helpful",
  type: "single",
  options: options("brain_mets", ["none", "treated_stable", "active"]),
  appliesTo: SOLID_GROUPS,
  excludeGroups: ["brain"],
  prerequisites: [{ question: "spread", anyOf: ["distant", UNKNOWN, SKIP] }],
  cost: 2,
  effects: [
    { option: "none", facts: [lacks("brain_mets")], queryTerms: [] },
    // Treated, stable metastases conflict only with blanket exclusions (no "active_only" carve-out).
    { option: "treated_stable", facts: [{ fact: "brain_mets", whenRequired: "support", whenExcluded: "conflict", paramIn: ["*"] }, { fact: "brain_mets", whenExcluded: "neutral", paramIn: ["active_only"] }], queryTerms: ["treated stable brain metastases"] },
    { option: "active", facts: [has("brain_mets")], queryTerms: ["brain metastases"] },
    ...nonResponseEffects(),
  ],
  findOutKey: findOutKey("brain_mets"),
  aiField: "brainMets",
  priors: Object.fromEntries(SOLID_GROUPS.map((g) => [g, priors({ none: 0.65, treated_stable: 0.1, active: 0.07, unknown: 0.18 })])),
  enabled: true,
  evidence: "brain/CNS metastases in 31% of trials (52-56% in lung, melanoma, kidney, liver, gastroesophageal); 579 of 1,469 exclusions carve out treated/stable",
  families: ["brain_mets"],
});

const sex = question({
  id: "sex",
  tier: "helpful",
  type: "single",
  options: options("sex", ["female", "male"], { sensitive: true }),
  appliesTo: "all",
  cost: 1,
  sensitive: true,
  effects: [
    { option: "female", facts: [], hardFilter: { sex: "FEMALE" } },
    { option: "male", facts: [], hardFilter: { sex: "MALE" } },
    ...nonResponseEffects(true),
  ],
  enabled: true,
  evidence: "structured sex field: 517 female-only, 383 male-only trials; breast 34% female-only. Asked only when >= 5% of candidates are sex-restricted",
  families: [],
});

const pregnancy = question({
  id: "pregnancy",
  tier: "helpful",
  type: "single",
  options: options("pregnancy", ["yes", "no"], { sensitive: true }),
  appliesTo: "all",
  prerequisites: [{ question: "sex", anyOf: ["male"], negate: true }],
  maxAge: 59,
  cost: 1,
  sensitive: true,
  effects: [{ option: "yes", facts: [has("pregnancy")], queryTerms: [] }, { option: "no", facts: [], queryTerms: [] }, ...nonResponseEffects(true)],
  aiField: "pregnant",
  enabled: true,
  evidence: "pregnancy/breastfeeding in 62% of trials (directional exclusion in 3,411)",
  families: [],
  legacyFacts: true,
});

const measurable = question({
  id: "measurable",
  tier: "deep",
  type: "single",
  options: [...options("measurable", ["yes", "no"]), { id: DEFERRED, labelKey: "questionnaire.common.deferred" }],
  appliesTo: MEASURABLE_GROUPS,
  prerequisites: [{ question: "spread", anyOf: ["removed"], negate: true }],
  cost: 3,
  effects: [{ option: "yes", facts: [has("measurable_disease")], queryTerms: ["measurable disease"] }, { option: "no", facts: [lacks("measurable_disease")], queryTerms: [] }, ...nonResponseEffects(), { option: DEFERRED, facts: [] }],
  findOutKey: findOutKey("measurable"),
  priors: Object.fromEntries(MEASURABLE_GROUPS.map((g) => [g, priors({ yes: 0.4, no: 0.1, unknown: 0.5 })])),
  enabled: true,
  evidence: "measurable disease (RECIST/RANO/Lugano/IMWG) required in 39% of trials (55-61% in lung, melanoma, kidney, liver, myeloma)",
  families: ["measurable"],
});

const otherCancer = question({
  id: "other_cancer",
  tier: "deep",
  type: "single",
  options: options("other_cancer", ["no", "over_2y", "recent"]),
  appliesTo: "all",
  cost: 1,
  effects: [
    { option: "no", facts: [], queryTerms: [] },
    // Treated over 2 years ago: blanket exclusions conflict; "within N years" conflicts only when N > 2; "active only" does not.
    {
      option: "over_2y",
      facts: [
        { fact: "other_malignancy", whenExcluded: "conflict", paramIn: ["*"] },
        { fact: "other_malignancy", whenExcluded: "neutral", paramCompare: { op: "gte", value: 2, else: "conflict" } },
        { fact: "other_malignancy", whenExcluded: "neutral", paramIn: ["active_only"] },
      ],
      queryTerms: [],
    },
    { option: "recent", facts: [{ fact: "other_malignancy", whenExcluded: "conflict" }], queryTerms: [] },
    ...nonResponseEffects(),
  ],
  priors: Object.fromEntries(CANCER_GROUP_IDS.map((g) => [g, priors({ no: 0.82, over_2y: 0.08, recent: 0.04, unknown: 0.06 })])),
  enabled: true,
  evidence: "other active or prior cancer in 49% of trials, mostly exclusions with 'unless treated more than N years ago' carve-outs",
  families: ["other_malignancy"],
});

const hiv = question({
  id: "hiv",
  tier: "deep",
  type: "single",
  options: options("hiv", ["no", "controlled", "other"], { sensitive: true }),
  appliesTo: "all",
  cost: 1,
  sensitive: true,
  effects: [
    { option: "no", facts: [{ fact: "hiv", whenRequired: "conflict", whenExcluded: "neutral" }], queryTerms: [] },
    { option: "controlled", facts: [{ fact: "hiv", whenRequired: "support", whenExcluded: "conflict", paramIn: ["*"] }, { fact: "hiv", whenExcluded: "neutral", paramIn: ["uncontrolled_only"] }], queryTerms: [] },
    { option: "other", facts: [has("hiv")], queryTerms: [] },
    ...nonResponseEffects(true),
  ],
  priors: Object.fromEntries(CANCER_GROUP_IDS.map((g) => [g, priors({ no: 0.93, controlled: 0.01, other: 0.003, unknown: 0.057 })])),
  enabled: true,
  evidence: "HIV in 39% of trials (57-59% in leukemia and lymphoma), mostly exclusions",
  families: ["hiv"],
});

const hepatitis = question({
  id: "hepatitis",
  tier: "deep",
  type: "single",
  options: options("hepatitis", ["no", "hep_b", "hep_c"], { sensitive: true }),
  appliesTo: "all",
  cost: 1,
  sensitive: true,
  effects: [
    { option: "no", facts: [{ fact: "hepatitis_b", whenRequired: "conflict", whenExcluded: "neutral" }, { fact: "hepatitis_c", whenRequired: "conflict", whenExcluded: "neutral" }], queryTerms: [] },
    // The answer does not say whether the infection is active, so "active only" exclusions do not conflict.
    { option: "hep_b", facts: [{ fact: "hepatitis_b", whenRequired: "support", whenExcluded: "conflict", paramIn: ["*"] }, { fact: "hepatitis_b", whenExcluded: "neutral", paramIn: ["active_only"] }], queryTerms: [] },
    { option: "hep_c", facts: [{ fact: "hepatitis_c", whenRequired: "support", whenExcluded: "conflict", paramIn: ["*"] }, { fact: "hepatitis_c", whenExcluded: "neutral", paramIn: ["active_only"] }], queryTerms: [] },
    ...nonResponseEffects(true),
  ],
  priors: Object.fromEntries(CANCER_GROUP_IDS.map((g) => [g, priors({ no: 0.9, hep_b: 0.02, hep_c: 0.02, unknown: 0.06 })])),
  enabled: true,
  evidence: "hepatitis B/C in 35% of trials (44% in liver cancer, both directions)",
  families: ["hepatitis"],
});

const transplant = question({
  id: "transplant",
  tier: "deep",
  type: "single",
  options: options("transplant", ["none", "organ", "allo", "auto"]),
  appliesTo: "all",
  cost: 1,
  effects: [
    { option: "none", facts: [lacks("allo_sct"), lacks("prior_drug:auto_sct")], queryTerms: [] },
    { option: "organ", facts: [has("organ_transplant")], queryTerms: [] },
    { option: "allo", facts: [has("allo_sct")], queryTerms: ["after allogeneic stem cell transplant"] },
    { option: "auto", facts: [has("prior_drug:auto_sct")], queryTerms: ["after autologous stem cell transplant"] },
    ...nonResponseEffects(),
  ],
  priors: {
    ...Object.fromEntries(SOLID_GROUPS.map((g) => [g, priors({ none: 0.95, organ: 0.01, allo: 0.005, auto: 0.005, unknown: 0.03 })])),
    ...Object.fromEntries(HEMATOLOGIC_GROUPS.map((g) => [g, priors({ none: 0.6, organ: 0.01, allo: 0.12, auto: 0.17, unknown: 0.1 })])),
  },
  enabled: true,
  evidence: "transplant in 26% of trials (52-56% in blood cancers)",
  families: ["transplant", "prior_drug"],
});

const autoimmune = question({
  id: "autoimmune",
  tier: "deep",
  type: "single",
  options: options("autoimmune", ["no", "yes_inactive", "yes_active"]),
  appliesTo: "all",
  cost: 1,
  effects: [
    { option: "no", facts: [], queryTerms: [] },
    { option: "yes_inactive", facts: [{ fact: "autoimmune", whenExcluded: "conflict", paramIn: ["*"] }, { fact: "autoimmune", whenExcluded: "neutral", paramIn: ["active_only"] }], queryTerms: [] },
    { option: "yes_active", facts: [{ fact: "autoimmune", whenExcluded: "conflict" }], queryTerms: [] },
    ...nonResponseEffects(),
  ],
  priors: Object.fromEntries(CANCER_GROUP_IDS.map((g) => [g, priors({ no: 0.85, yes_inactive: 0.04, yes_active: 0.04, unknown: 0.07 })])),
  enabled: true,
  evidence: "autoimmune disease in 23% of trials (37-45% in checkpoint-heavy bladder, kidney, liver, melanoma)",
  families: ["autoimmune"],
});

const organProblems = question({
  id: "organ_problems",
  tier: "deep",
  type: "multi",
  options: options("organ_problems", ["kidney", "liver", "heart", "none"], { exclusive: ["none"] }),
  appliesTo: "all",
  cost: 2,
  effects: [
    { option: "kidney", facts: [{ fact: "kidney_disease", whenExcluded: "conflict" }], queryTerms: [] },
    { option: "liver", facts: [{ fact: "liver_disease", whenExcluded: "conflict" }], queryTerms: [] },
    { option: "heart", facts: [{ fact: "heart_disease", whenExcluded: "conflict" }], queryTerms: [] },
    { option: "none", facts: [], queryTerms: [] },
    ...nonResponseEffects(),
  ],
  priors: Object.fromEntries(CANCER_GROUP_IDS.map((g) => [g, priors({ kidney: 0.04, liver: 0.04, heart: 0.06, none: 0.76, unknown: 0.1 })])),
  enabled: true,
  evidence: "heart/kidney/liver function in 42-46% of trials, mostly lab thresholds; only disease-named exclusions are used",
  families: ["organ_disease"],
});

const inOtherTrial = question({
  id: "in_other_trial",
  tier: "deep",
  type: "single",
  options: options("in_other_trial", ["yes", "no"]),
  appliesTo: "all",
  cost: 1,
  effects: [{ option: "yes", facts: [has("concurrent_trial")], queryTerms: [] }, { option: "no", facts: [], queryTerms: [] }, ...nonResponseEffects()],
  aiField: "concurrentTrial",
  priors: Object.fromEntries(CANCER_GROUP_IDS.map((g) => [g, priors({ yes: 0.05, no: 0.9, unknown: 0.05 })])),
  enabled: true,
  evidence: "concurrent other trial in 22% of trials",
  families: [],
  legacyFacts: true,
});

const phasePref = question({
  id: "phase_pref",
  tier: "deep",
  type: "single",
  options: options("phase_pref", ["open_phase1", "later_phase", "no_pref"]),
  appliesTo: "all",
  cost: 1,
  effects: [{ option: "open_phase1", facts: [] }, { option: "later_phase", facts: [] }, { option: "no_pref", facts: [] }, ...nonResponseEffects()],
  enabled: true,
  evidence: "soft preference only (no facts): phase 1 2,007, phase 2 2,457, phase 3 512 trials",
  families: [],
});

/** Cross-cancer questions in catalog order, split around the group-specific ones (see index.ts). */
export const COMMON_BEFORE_GROUP: readonly QuestionDef[] = [spread, diseaseStatus, treatments, lines, dailyActivity];
export const COMMON_AFTER_GROUP: readonly QuestionDef[] = [brainMets];
export const COMMON_TAIL: readonly QuestionDef[] = [sex, pregnancy, measurable, otherCancer, hiv, hepatitis, transplant, autoimmune, organProblems, inOtherTrial, phasePref];

export { PREFER_NOT };
