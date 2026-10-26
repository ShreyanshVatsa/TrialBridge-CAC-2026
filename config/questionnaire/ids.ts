/**
 * Closed vocabularies for the questionnaire and the fact layer (QUESTIONNAIRE_SPEC §1.4).
 * Data only. Schemas in lib/types import these lists; ingestion (lib/ingest/eligibility-facts.ts)
 * emits `histology:<HistologyId>` and `prior_drug:<DrugClassId>` facts from them.
 */

/** Trial-side histology / subtype facts (`histology:<id>`). Required = the trial is only for this histology. */
export const HISTOLOGY_IDS = [
  // lung
  "nsclc",
  "sclc",
  "lung_squamous",
  "mesothelioma",
  // leukemia / MDS
  "aml",
  "all",
  "cll",
  "cml",
  "mds",
  // lymphoma
  "dlbcl",
  "follicular",
  "mantle_cell",
  "marginal_zone",
  "hodgkin",
  "t_cell_lymphoma",
  "cns_lymphoma",
  // myeloma spectrum
  "smoldering_myeloma",
  "amyloidosis",
  // uterine / cervical
  "endometrial",
  "cervical",
  // liver
  "hcc",
  "biliary",
  // gastroesophageal
  "esophageal_squamous",
  "gastroesophageal_adeno",
  // pancreatic
  "pdac",
  "pnet",
  // brain
  "glioblastoma",
  "lower_grade_glioma",
  "meningioma",
  // melanoma / skin
  "uveal_melanoma",
  "mucosal_melanoma",
  "cutaneous_scc",
  "merkel_cell",
  // kidney
  "clear_cell_rcc",
  // sarcoma
  "gist",
  "osteosarcoma",
  "ewing",
  // thyroid
  "differentiated_thyroid",
  "medullary_thyroid",
  "anaplastic_thyroid",
  // head and neck
  "hnscc",
  "nasopharyngeal",
  "salivary",
  // colorectal
  "rectal",
  "anal",
  // ovarian
  "hgsoc",
  "ovarian_clear_cell",
  "low_grade_serous_ovarian",
  // prostate
  "prostate_neuroendocrine",
  // bladder
  "upper_tract_urothelial",
] as const;
export type HistologyId = (typeof HISTOLOGY_IDS)[number];

/** Prior drug classes (`prior_drug:<id>`). Required = must have had it; excluded = having had it rules you out. */
export const DRUG_CLASS_IDS = [
  "checkpoint",
  "platinum",
  "taxane",
  "endocrine",
  "cdk46",
  "anti_her2",
  "adc",
  "egfr_tki",
  "alk_tki",
  "parp",
  "arpi",
  "lu_psma",
  "braf_mek",
  "anti_vegf",
  "vegf_tki",
  "fluoropyrimidine",
  "hma",
  "venetoclax",
  "car_t",
  "anti_cd20",
  "btk",
  "bispecific",
  "anti_cd38",
  "imid",
  "proteasome_inhibitor",
  "bcma",
  "temozolomide",
  "bcg",
  "auto_sct",
] as const;
export type DrugClassId = (typeof DRUG_CLASS_IDS)[number];

/** Patient-side subtype answers (the `subtype` question). Coarse; may go to AI (§4.2). */
export const SUBTYPE_IDS = [
  "nsclc_adeno",
  "nsclc_squamous",
  "nsclc_other",
  "sclc",
  "mesothelioma",
  "aml",
  "all",
  "cll",
  "cml",
  "mds",
  "dlbcl",
  "follicular",
  "mantle_cell",
  "marginal_zone",
  "hodgkin",
  "t_cell_lymphoma",
  "endometrial",
  "cervical",
  "hcc",
  "biliary",
  "gastric_gej_adeno",
  "esophageal_adeno",
  "esophageal_squamous",
  "pdac",
  "pnet",
  "glioblastoma",
  "lower_grade_glioma",
  "meningioma",
  "melanoma_cutaneous",
  "melanoma_uveal",
  "melanoma_mucosal",
  "cutaneous_scc",
  "merkel_cell",
  "basal_cell",
  "rcc_clear_cell",
  "rcc_non_clear_cell",
  "soft_tissue_sarcoma",
  "gist",
  "osteosarcoma",
  "ewing",
  "thyroid_differentiated",
  "thyroid_medullary",
  "thyroid_anaplastic",
  "hnscc",
  "nasopharyngeal",
  "salivary",
  "colon",
  "rectal",
  "anal",
  "hgsoc",
  "ovarian_other",
  "not_sure",
] as const;
export type SubtypeId = (typeof SUBTYPE_IDS)[number];

/** Group-specific disease status answers (the `group_status` question). */
export const GROUP_STATUS_IDS = [
  "cspc",
  "crpc",
  "platinum_resistant",
  "platinum_sensitive",
  "nmibc",
  "mibc",
  "active_myeloma",
  "smoldering",
  "mgus",
  "amyloidosis",
  "resectable",
  "borderline_resectable",
  "unresectable",
  "rai_refractory",
  "rai_responsive",
  "not_sure",
] as const;
export type GroupStatusId = (typeof GROUP_STATUS_IDS)[number];

/** Question ids across all cancer catalogs, in catalog order. */
export const QUESTION_IDS = [
  "cancer_type",
  "age",
  "zip",
  "travel",
  "subtype",
  "spread",
  "disease_status",
  "treatments",
  "lines",
  "daily_activity",
  "biomarkers",
  "brain_mets",
  "group_status",
  "prior_drugs",
  "sex",
  "pregnancy",
  "measurable",
  "other_cancer",
  "hiv",
  "hepatitis",
  "transplant",
  "autoimmune",
  "organ_problems",
  "in_other_trial",
  "phase_pref",
  "deep_biomarkers",
] as const;
export type QuestionId = (typeof QUESTION_IDS)[number];

/** Coarse answers that may go to AI (§4.2). Everything else stays in the browser. */
export const AI_FIELD_IDS = ["subtype", "stageCategory", "diseaseStatus", "priorLines", "activityBand", "brainMets", "groupStatus", "priorDrugClasses", "treatments", "biomarkers", "pregnant", "concurrentTrial", "spread"] as const;
export type AiFieldId = (typeof AI_FIELD_IDS)[number];
