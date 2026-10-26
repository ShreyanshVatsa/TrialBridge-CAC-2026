/**
 * Adapter from the questionnaire state to the legacy `IntakeAnswers` shape (QUESTIONNAIRE_SPEC §3.4), so
 * `searchTrials`, `requestAnalysis` and existing code keep working. The full state rides along in
 * `answers.questionnaire`; matching uses it (catalog-driven pre-check) whenever it is present, and the
 * legacy fields below are only coarse summaries of it.
 */
import { BIOMARKER_IDS } from "@/config/biomarkers";
import type { IntakeAnswers, Language, Treatment } from "@/lib/types/intake";
import { TREATMENTS } from "@/lib/types/intake";
import type { AnswerValue, QuestionnaireState } from "@/lib/types/questionnaire";
import { Q_AGE, Q_TRAVEL, Q_ZIP } from "./constants";
import { groupOf, isNonResponse } from "./rules";

const str = (v: AnswerValue | undefined): string | null => (typeof v === "string" && !isNonResponse(v) ? v : null);

/** Travel answer: miles as a number (or numeric string); "anywhere" / null / unknown = no limit. */
export function travelMiles(v: AnswerValue | undefined): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** spread option -> legacy spread ("yes" only for distant spread: catalog id "distant"). */
export function legacySpread(v: AnswerValue | undefined): IntakeAnswers["spread"] {
  const s = str(v);
  if (s === null) return "not_sure";
  return s === "distant" || s === "metastatic" ? "yes" : "no";
}

const LEGACY_TREATMENTS: readonly string[] = TREATMENTS;
export function legacyTreatments(v: AnswerValue | undefined): Treatment[] {
  if (!Array.isArray(v) || isNonResponse(v) || v.some((x) => isNonResponse(x))) return ["not_sure"];
  const kept = v.filter((t): t is Treatment => LEGACY_TREATMENTS.includes(t) && t !== "not_sure");
  // Only new classes (e.g. hormone therapy): they were treated, but the legacy list cannot say how.
  return kept.length > 0 ? kept : ["not_sure"];
}

/** Both biomarker grids, merged; "not tested" / unknown -> dont_know. Only marker ids the legacy shape knows. */
export function legacyBiomarkers(state: QuestionnaireState): IntakeAnswers["biomarkers"] {
  const out: IntakeAnswers["biomarkers"] = {};
  for (const qid of ["biomarkers", "deep_biomarkers"]) {
    const grid = state.answers[qid];
    if (!grid || typeof grid !== "object" || Array.isArray(grid)) continue;
    for (const [id, status] of Object.entries(grid)) {
      if (!(BIOMARKER_IDS as readonly string[]).includes(id)) continue;
      out[id as keyof typeof out] = status === "positive" || status === "negative" ? status : "dont_know";
    }
  }
  return out;
}

function legacyPregnant(v: AnswerValue | undefined): IntakeAnswers["pregnant"] {
  if (v === "yes" || v === "no" || v === "prefer_not") return v;
  return "not_sure";
}

/**
 * Legacy answers derived from the questionnaire state. Throws when an essential is missing or invalid
 * (the UI only offers "Show my matches" after the essentials). `inAnotherTrial` is "yes" only on a definite
 * yes: legacy matching treats "no" as no signal, which is exactly what unknown must be.
 */
export function toIntakeAnswers(state: QuestionnaireState, language: Language = "en"): IntakeAnswers {
  const cancerType = groupOf(state);
  const age = state.answers[Q_AGE];
  const zip = state.answers[Q_ZIP];
  if (!cancerType || typeof age !== "number" || typeof zip !== "string") throw new Error("Questionnaire essentials are incomplete");
  return {
    cancerType,
    zip,
    travelMiles: travelMiles(state.answers[Q_TRAVEL]),
    age,
    language,
    spread: legacySpread(state.answers["spread"]),
    treatments: legacyTreatments(state.answers["treatments"]),
    biomarkers: legacyBiomarkers(state),
    pregnant: legacyPregnant(state.answers["pregnancy"]),
    inAnotherTrial: state.answers["in_other_trial"] === "yes" ? "yes" : "no",
    questionnaire: state,
  };
}
