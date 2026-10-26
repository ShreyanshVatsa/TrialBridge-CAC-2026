import type { IntakeAnswers } from "@/lib/types/intake";
import {
  ACTIVITY_BANDS,
  AI_TREATMENTS,
  AUTOIMMUNE_STATUS,
  BRAIN_METS,
  HEPATITIS_STATUS,
  HIV_STATUS,
  ORGAN_PROBLEMS,
  OTHER_CANCER,
  SEX_LISTED,
  TRANSPLANT_TYPE,
  DISEASE_STATUSES,
  MinimizedProfileSchema,
  PRIOR_LINES,
  STAGE_CATEGORIES,
  type AgeBracket,
  type MinimizedProfile,
} from "@/lib/types/analysis";
import { DRUG_CLASS_IDS, GROUP_STATUS_IDS, SUBTYPE_IDS } from "@/config/questionnaire/ids";
import type { AnswerValue, QuestionnaireState } from "@/lib/types/questionnaire";

/** Map an exact age to its decade bracket so the exact age never leaves the browser. */
export function ageToBracket(age: number): AgeBracket {
  if (age < 30) return "18-29";
  if (age < 40) return "30-39";
  if (age < 50) return "40-49";
  if (age < 60) return "50-59";
  if (age < 70) return "60-69";
  if (age < 80) return "70-79";
  if (age < 90) return "80-89";
  return "90+";
}

/** Catalog option ids that differ from the AI enum values (config/questionnaire/common.ts). Others map 1:1. */
const OPTION_TO_AI: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  spread: { not_spread: "early", nearby: "locally_advanced", distant: "metastatic", removed: "no_evidence_after_surgery" },
  disease_status: { recurrent: "recurrent_or_progressing" },
  lines: { "3plus": "3+" },
};
const toAi = (q: string, v: AnswerValue | undefined): AnswerValue | undefined => (typeof v === "string" ? (OPTION_TO_AI[q]?.[v] ?? v) : v);

/**
 * A definite answer that is a member of the closed list, else undefined. "not_sure", unknown, skip,
 * prefer not and deferred answers are all omitted: an omitted field and "not sure" mean the same to the
 * model, and omission keeps the analysis cache hit rate up.
 */
function oneOf<T extends string>(v: AnswerValue | undefined, allowed: readonly T[]): T | undefined {
  return typeof v === "string" && v !== "not_sure" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

/**
 * The coarse fields (QUESTIONNAIRE_SPEC §4.2) and the health-history categories, copied one by one from the
 * questionnaire state. Nothing else in the state (phase preference, deferred and find-out lists) is ever read here.
 */
function v2Fields(state: QuestionnaireState): Partial<MinimizedProfile> {
  const a = state.answers;
  const out: Partial<MinimizedProfile> = { v: 2 };
  const subtype = oneOf(toAi("subtype", a["subtype"]), SUBTYPE_IDS);
  if (subtype) out.subtype = subtype;
  const stage = oneOf(toAi("spread", a["spread"]), STAGE_CATEGORIES);
  if (stage) out.stageCategory = stage;
  const status = oneOf(toAi("disease_status", a["disease_status"]), DISEASE_STATUSES);
  if (status) out.diseaseStatus = status;
  const treatments = a["treatments"];
  const lines = Array.isArray(treatments) && treatments.length === 1 && treatments[0] === "none" ? "0" : oneOf(toAi("lines", a["lines"]), PRIOR_LINES);
  if (lines) out.priorLines = lines;
  const activity = oneOf(toAi("daily_activity", a["daily_activity"]), ACTIVITY_BANDS);
  if (activity) out.activityBand = activity;
  const brain = oneOf(toAi("brain_mets", a["brain_mets"]), BRAIN_METS);
  if (brain) out.brainMets = brain;
  const groupStatus = oneOf(toAi("group_status", a["group_status"]), GROUP_STATUS_IDS);
  if (groupStatus) out.groupStatus = groupStatus;
  const drugs = a["prior_drugs"];
  if (Array.isArray(drugs)) {
    const classes = [...new Set(drugs.filter((d): d is (typeof DRUG_CLASS_IDS)[number] => (DRUG_CLASS_IDS as readonly string[]).includes(d)))].sort();
    if (classes.length > 0) out.priorDrugClasses = classes;
  }
  return { ...out, ...historyFields(state) };
}

/** Health-history categories: closed option ids only, unanswered ones omitted. */
function historyFields(state: QuestionnaireState): Partial<MinimizedProfile> {
  // A question left for the doctor is never sent, even if an earlier answer is still stored.
  const a = Object.fromEntries(Object.entries(state.answers).filter(([k]) => !state.deferred.includes(k as (typeof state.deferred)[number])));
  const out: Partial<MinimizedProfile> = {};
  const sex = oneOf(a["sex"], SEX_LISTED);
  if (sex) out.sexListed = sex;
  const measurable = oneOf(a["measurable"], ["yes", "no"] as const);
  if (measurable) out.measurableDisease = measurable;
  const other = oneOf(a["other_cancer"], OTHER_CANCER);
  if (other) out.otherCancer = other;
  const hiv = oneOf(a["hiv"], HIV_STATUS);
  if (hiv) out.hivStatus = hiv;
  const hep = oneOf(a["hepatitis"], HEPATITIS_STATUS);
  if (hep) out.hepatitisStatus = hep;
  const tx = oneOf(a["transplant"], TRANSPLANT_TYPE);
  if (tx) out.transplantType = tx;
  const auto = oneOf(a["autoimmune"], AUTOIMMUNE_STATUS);
  if (auto) out.autoimmuneStatus = auto;
  const organs = a["organ_problems"];
  if (Array.isArray(organs)) {
    const known = [...new Set(organs.filter((o): o is (typeof ORGAN_PROBLEMS)[number] => (ORGAN_PROBLEMS as readonly string[]).includes(o)))].sort();
    // "none" is exclusive in the catalog; a mixed answer keeps only the named problems.
    const named = known.filter((o) => o !== "none");
    if (named.length > 0) out.organProblems = named;
    else if (known.includes("none")) out.organProblems = ["none"];
  }
  return out;
}

/** Treatments for AI: the questionnaire's multi-select (incl. hormone therapy, stem cell transplant) when present. */
function aiTreatments(answers: IntakeAnswers): MinimizedProfile["treatments"] {
  const t = answers.questionnaire?.answers["treatments"];
  if (Array.isArray(t)) {
    const known = t.filter((x): x is (typeof AI_TREATMENTS)[number] => (AI_TREATMENTS as readonly string[]).includes(x));
    if (known.length > 0 && known.length === t.length) return [...new Set(known)];
    return ["not_sure"];
  }
  return [...answers.treatments];
}

function concurrentTrial(answers: IntakeAnswers): MinimizedProfile["concurrentTrial"] {
  if (!answers.questionnaire) return answers.inAnotherTrial;
  const v = answers.questionnaire.answers["in_other_trial"];
  return v === "yes" || v === "no" ? v : "not_sure";
}

/**
 * Build the only profile shape allowed to reach the backend / AI providers.
 * Explicitly copies allowed fields (never spreads the input) and validates with the strict schema.
 * ZIP, travel distance and exact age are dropped here; health history is reduced to the closed categories of historyFields.
 */
export function minimizeProfile(answers: IntakeAnswers): MinimizedProfile {
  return MinimizedProfileSchema.parse({
    cancerType: answers.cancerType,
    ageBracket: ageToBracket(answers.age),
    spread: answers.spread,
    treatments: aiTreatments(answers),
    biomarkers: { ...answers.biomarkers },
    pregnant: answers.pregnant,
    concurrentTrial: concurrentTrial(answers),
    language: answers.language,
    ...(answers.questionnaire ? v2Fields(answers.questionnaire) : {}),
  });
}
