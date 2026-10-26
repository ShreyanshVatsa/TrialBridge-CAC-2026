/**
 * Prompt: trial analysis, version analyze-v2 (QUESTIONNAIRE_SPEC §4.2). Same rules as v1; the minimized
 * profile is rendered as fixed English labels from this server-side map instead of raw JSON, and the v2
 * coarse fields (subtype, stage, disease status, prior lines, daily activity, brain metastases, group status,
 * prior drug classes) are included when the patient answered them. Every value has been validated against a
 * closed enum (MinimizedProfileSchema) before it gets here, so nothing user-typed can reach the prompt.
 * Changing this text requires bumping ANALYZE_PROMPT_VERSION (part of the analysis cache key).
 */
import { getCancerGroup } from "@/config/cancer-groups";
import { BIOMARKERS } from "@/config/biomarkers";
import type { MinimizedProfile } from "@/lib/types/analysis";
import { promptLanguageName } from "@/lib/i18n/ai-language";
import { ANALYZE_SYSTEM_PROMPT as V1_SYSTEM, buildRepairPrompt, type PromptTrial } from "./analyze-v1";

export { buildRepairPrompt, type PromptTrial };

export const ANALYZE_PROMPT_VERSION = "analyze-v2";

export const ANALYZE_SYSTEM_PROMPT = `${V1_SYSTEM}
8. The profile lists only what the patient answered. Anything not listed is unknown: treat it as "needs_doctor", never as a yes or a no.`;

export const SPREAD = { yes: "yes, to distant organs", no: "no", not_sure: "not sure" } as const;
export const PREGNANT = { yes: "yes", no: "no", not_sure: "not sure", prefer_not: "prefers not to say" } as const;
export const YES_NO = { yes: "yes", no: "no", not_sure: "not sure" } as const;
export const BIOMARKER_STATUS = { positive: "positive", negative: "negative", dont_know: "does not know" } as const;
export const STAGE = {
  early: "early stage, not spread",
  locally_advanced: "spread nearby only (locally advanced)",
  metastatic: "spread to distant organs (metastatic)",
  no_evidence_after_surgery: "removed by surgery, no cancer seen now",
  not_sure: "not sure",
} as const;
export const STATUS = { new: "newly diagnosed, not treated yet", recurrent_or_progressing: "treated, and it came back or grew", on_treatment: "currently being treated", not_sure: "not sure" } as const;
export const LINES = { "0": "none", "1": "1", "2": "2", "3+": "3 or more", not_sure: "not sure" } as const;
export const ACTIVITY = {
  "0-1": "usual activities with little or no limits (ECOG 0-1)",
  "2": "can take care of self but rests during the day (ECOG 2)",
  "3-4": "needs help with self-care, mostly in bed or chair (ECOG 3-4)",
  not_sure: "not sure",
} as const;
export const BRAIN = { none: "no brain metastases", treated_stable: "brain metastases, treated and stable", active: "brain metastases, active or not yet treated", not_sure: "not sure" } as const;
export const TREATMENT: Record<string, string> = {
  chemotherapy: "chemotherapy",
  radiation: "radiation",
  surgery: "surgery",
  immunotherapy: "immunotherapy",
  targeted_therapy: "targeted therapy",
  hormone_therapy: "hormone therapy",
  stem_cell_transplant: "stem cell transplant",
  none: "none",
  not_sure: "not sure",
};
/** Closed-list ids (already zod-validated) rendered as words; explicit labels where the id is cryptic. */
const ID_LABELS: Record<string, string> = {
  nsclc_adeno: "non-small cell lung cancer, adenocarcinoma",
  nsclc_squamous: "non-small cell lung cancer, squamous",
  nsclc_other: "non-small cell lung cancer, other type",
  sclc: "small cell lung cancer",
  hgsoc: "high-grade serous ovarian cancer",
  hcc: "hepatocellular carcinoma",
  pdac: "pancreatic ductal adenocarcinoma",
  pnet: "pancreatic neuroendocrine tumor",
  hnscc: "head and neck squamous cell carcinoma",
  gist: "gastrointestinal stromal tumor",
  dlbcl: "diffuse large B-cell lymphoma",
  aml: "acute myeloid leukemia",
  all: "acute lymphoblastic leukemia",
  cll: "chronic lymphocytic leukemia",
  cml: "chronic myeloid leukemia",
  mds: "myelodysplastic syndrome",
  rcc_clear_cell: "clear cell kidney cancer",
  rcc_non_clear_cell: "non-clear cell kidney cancer",
  cspc: "prostate cancer still responding to hormone therapy (castration-sensitive)",
  crpc: "prostate cancer growing despite hormone therapy (castration-resistant)",
  platinum_resistant: "came back within 6 months of platinum chemotherapy (platinum-resistant)",
  platinum_sensitive: "came back 6 or more months after platinum chemotherapy (platinum-sensitive)",
  nmibc: "non-muscle-invasive bladder cancer",
  mibc: "muscle-invasive bladder cancer",
  mgus: "MGUS",
  rai_refractory: "radioactive iodine stopped working",
  rai_responsive: "radioactive iodine still works",
  cdk46: "CDK4/6 inhibitor",
  anti_her2: "anti-HER2 therapy",
  adc: "antibody-drug conjugate",
  egfr_tki: "EGFR inhibitor",
  alk_tki: "ALK inhibitor",
  parp: "PARP inhibitor",
  arpi: "androgen receptor pathway inhibitor",
  lu_psma: "Lu-177 PSMA therapy",
  braf_mek: "BRAF/MEK inhibitor",
  anti_vegf: "anti-VEGF antibody",
  vegf_tki: "VEGF tyrosine kinase inhibitor",
  hma: "hypomethylating agent",
  car_t: "CAR-T cell therapy",
  anti_cd20: "anti-CD20 antibody",
  btk: "BTK inhibitor",
  bispecific: "bispecific antibody",
  anti_cd38: "anti-CD38 antibody",
  imid: "immunomodulatory drug (IMiD)",
  bcma: "BCMA-directed therapy",
  bcg: "BCG",
  auto_sct: "stem cell transplant from own cells",
};
export const word = (id: string) => ID_LABELS[id] ?? id.replace(/_/g, " ");
export const BIOMARKER_LABEL = new Map<string, string>(BIOMARKERS.map((b) => [b.id, b.label]));

/** The minimized profile as fixed English lines. Only fields present in the (validated) profile appear. */
export function renderProfile(p: MinimizedProfile): string {
  const lines = [
    `Cancer type: ${p.cancerType === "other" ? "other or not sure" : getCancerGroup(p.cancerType).label}`,
    `Age range: ${p.ageBracket}`,
    `Spread to distant organs: ${SPREAD[p.spread]}`,
    `Treatments received: ${p.treatments.map((t) => TREATMENT[t] ?? t).join(", ")}`,
  ];
  const markers = Object.entries(p.biomarkers).map(([id, s]) => `${BIOMARKER_LABEL.get(id) ?? id} ${BIOMARKER_STATUS[s]}`);
  if (markers.length) lines.push(`Biomarkers: ${markers.join("; ")}`);
  lines.push(`Pregnant: ${PREGNANT[p.pregnant]}`, `In another clinical trial now: ${YES_NO[p.concurrentTrial]}`);
  if (p.subtype) lines.push(`Subtype: ${word(p.subtype)}`);
  if (p.stageCategory) lines.push(`Stage: ${STAGE[p.stageCategory]}`);
  if (p.diseaseStatus) lines.push(`Disease status: ${STATUS[p.diseaseStatus]}`);
  if (p.priorLines) lines.push(`Prior treatment plans (lines): ${LINES[p.priorLines]}`);
  if (p.activityBand) lines.push(`Daily activity: ${ACTIVITY[p.activityBand]}`);
  if (p.brainMets) lines.push(`Brain metastases: ${BRAIN[p.brainMets]}`);
  if (p.groupStatus) lines.push(`Disease status detail: ${word(p.groupStatus)}`);
  if (p.priorDrugClasses?.length) lines.push(`Prior drug classes: ${p.priorDrugClasses.map(word).join(", ")}`);
  return lines.map((l) => `- ${l}`).join("\n");
}

/** Escape anything that could close or forge the data delimiter. */
const safe = (s: string) => s.replace(/<\s*\/?\s*trial_data[^>]*>?/gi, "[removed]");

export function buildAnalyzeUserPrompt(profile: MinimizedProfile, language: string, trials: readonly PromptTrial[]): string {
  const blocks = trials.map((t) => {
    const inc = t.inclusion.map((c) => `I${c.n}. ${safe(c.text)}`).join("\n");
    const exc = t.exclusion.map((c) => `E${c.n}. ${safe(c.text)}`).join("\n");
    return `<trial_data id="${t.id}">\nTitle: ${safe(t.title)}\nINCLUSION CRITERIA\n${inc}\nEXCLUSION CRITERIA\n${exc}\n</trial_data>`;
  });
  return `Response language: ${promptLanguageName(language)}\nPatient profile (minimized; anything not listed is unknown):\n${renderProfile(profile)}\n\nAnalyze each of these ${trials.length} trials:\n\n${blocks.join("\n\n")}`;
}
