import { emptyState, type AnswerValue, type QuestionnaireState } from "./contract";
import { applyAnswer, getCatalog } from "./engine";

/**
 * A made-up patient for demos and first-time visitors ("Try a sample patient", `/find/?demo=1`). Not a real
 * person: the answers were invented to show a typical flow (metastatic HR-positive, HER2-negative, PIK3CA-mutated breast cancer
 * that grew after hormone therapy plus a CDK4/6 inhibitor, living in Lowell, Massachusetts, up to 60 miles of travel).
 * Answers are applied through the engine so prerequisites and drops behave exactly as if they had been typed.
 */
export const SAMPLE_PATIENT: Readonly<Record<string, AnswerValue>> = {
  cancer_type: "breast",
  age: 58,
  zip: "01852",
  travel: 60,
  sex: "female",
  spread: "distant",
  disease_status: "recurrent",
  treatments: ["hormone_therapy", "targeted_therapy"],
  lines: "1",
  prior_drugs: ["endocrine", "cdk46"],
  daily_activity: "0-1",
  brain_mets: "none",
  measurable: "yes",
  other_cancer: "no",
  hiv: "no",
  hepatitis: "no",
  transplant: "none",
  autoimmune: "no",
  organ_problems: ["none"],
  pregnancy: "no",
  in_other_trial: "no",
  biomarkers: { HER2: "negative", HR: "positive" },
  deep_biomarkers: { PIK3CA: "positive", ESR1: "negative" },
};

export function samplePatientState(): QuestionnaireState {
  const catalog = getCatalog("cancer", "breast");
  let state = emptyState();
  for (const [id, value] of Object.entries(SAMPLE_PATIENT)) state = applyAnswer(state, id, value, catalog).state;
  return state;
}

/** The sample answers in asking order, each applied through the engine (the walkthrough plays them one at a time). */
export function applySampleAnswer(state: QuestionnaireState, index: number): QuestionnaireState {
  const entry = Object.entries(SAMPLE_PATIENT)[index];
  return entry ? applyAnswer(state, entry[0], entry[1], getCatalog("cancer", "breast")).state : state;
}

export const SAMPLE_STEPS = Object.keys(SAMPLE_PATIENT).length;

/** True when the page was opened with `?demo=walk` (the sample patient's answers played one at a time). */
export function walkRequested(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("demo") === "walk";
}

/** True when the page was opened with `?demo=1` (the shortcut straight to results). */
export function demoRequested(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("demo") === "1";
}
