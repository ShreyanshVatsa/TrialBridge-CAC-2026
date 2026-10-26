/**
 * Extra disease tags read from a trial's registered conditions and titles, used only by the structured subtype match
 * (lib/match/subtype.ts) at ranking time, never by the criteria fact extractor (config/criteria.ts HISTOLOGY_PATTERNS
 * stays the extractor's vocabulary). They name sibling diseases that share a cancer group but are different diseases
 * for trial purposes: non-Hodgkin vs Hodgkin lymphoma, melanoma vs other skin cancers, brain metastases vs primary
 * brain tumors, soft-tissue vs bone sarcoma, colorectal vs anal cancer.
 *
 * A tag only matters for a patient whose subtype answer lists it, as a conflict (the trial is about another disease)
 * or as `own` (the trial may be about the patient's disease, so it is never a conflict). Unknown or skipped subtype
 * answers add nothing: unknown never lowers rank.
 */
import type { CancerGroupId } from "./cancer-groups";

export interface SubtypeTag {
  id: string;
  groups: readonly CancerGroupId[];
  re: RegExp;
}

export const SUBTYPE_TAGS: readonly SubtypeTag[] = [
  { id: "nhl", groups: ["lymphoma"], re: /\bnon[- ]?hodgkin|\bB[- ]?NHL\b|\bNHL\b|\bB[- ]cell (?:lymphoma|non|malignanc)/i },
  { id: "lbcl", groups: ["lymphoma"], re: /\blarge B[- ]cell lymphoma|\bLBCL\b|\baggressive B[- ]cell|\bhigh[- ]grade B[- ]cell/i },
  { id: "melanoma", groups: ["melanoma"], re: /\bmelanomas?\b/i },
  { id: "basal_cell", groups: ["melanoma"], re: /\bbasal[- ]cell (?:carcinoma|cancer)|\bBCC\b/i },
  { id: "brain_metastases", groups: ["brain"], re: /\bbrain metasta\w*|\bleptomeningeal metasta\w*|\bintracranial metasta\w*|\bmetasta\w* (?:to|in) the brain\b/i },
  { id: "glioma", groups: ["brain"], re: /\bgliomas?\b|\bastrocytomas?\b|\boligodendrogliomas?\b|\bglioblastoma\b|\bGBM\b/i },
  { id: "soft_tissue_sarcoma", groups: ["sarcoma"], re: /\bsoft[- ]tissue sarcomas?\b|\bSTS\b|\b(?:lipo|leiomyo|rhabdomyo|angio|fibro)sarcomas?\b|\bsynovial sarcoma|\bretroperitoneal sarcoma|\bundifferentiated pleomorphic/i },
  { id: "colorectal", groups: ["colorectal"], re: /\bcolorectal\b|\bcolon (?:cancer|adenocarcinoma|carcinoma)|\bm?CRC\b/i },
];

/** Per subtype answer (option id of the `subtype` or `group_status` question): tags that mean another disease, and tags that may be the patient's. */
export const SUBTYPE_TAG_RULES: Readonly<Record<string, { conflict?: readonly string[]; own?: readonly string[] }>> = {
  // Lymphoma: CLL/SLL-only trials are for CLL; non-Hodgkin and large B-cell trials are not for Hodgkin lymphoma.
  // Indolent subtypes keep large B-cell trials (transformed disease is often eligible; TREC dev human judges agree).
  hodgkin: { conflict: ["nhl", "lbcl", "cll"] },
  dlbcl: { conflict: ["cll"], own: ["nhl", "lbcl"] },
  follicular: { conflict: ["cll"], own: ["nhl", "lbcl"] },
  mantle_cell: { conflict: ["cll"], own: ["nhl", "lbcl"] },
  marginal_zone: { conflict: ["cll"], own: ["nhl", "lbcl"] },
  t_cell_lymphoma: { conflict: ["cll"] },
  // Skin cancers in the melanoma group.
  cutaneous_scc: { conflict: ["melanoma"] },
  merkel_cell: { conflict: ["melanoma"] },
  basal_cell: { conflict: ["melanoma"], own: ["basal_cell"] },
  // Primary brain tumors vs metastases from elsewhere.
  glioblastoma: { conflict: ["brain_metastases"], own: ["glioma"] },
  lower_grade_glioma: { conflict: ["brain_metastases"], own: ["glioma"] },
  meningioma: { conflict: ["brain_metastases", "glioma"] },
  // Bone vs soft-tissue sarcoma.
  osteosarcoma: { conflict: ["soft_tissue_sarcoma"] },
  ewing: { conflict: ["soft_tissue_sarcoma"] },
  gist: { conflict: ["soft_tissue_sarcoma"] },
  soft_tissue_sarcoma: { own: ["soft_tissue_sarcoma"] },
  // Anal cancer is a different disease from colorectal adenocarcinoma.
  anal: { conflict: ["colorectal"] },
  colon: { own: ["colorectal"] },
  rectal: { own: ["colorectal"] },
};
