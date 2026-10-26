/**
 * Cancer-type groups used for sharding, intake, and filtering.
 * Each group is matched against a trial's MeSH condition terms + ancestors
 * (ClinicalTrials.gov derivedSection.conditionBrowseModule) and, as a fallback,
 * its free-text conditions. Order matters only for display.
 */
export const CANCER_GROUP_IDS = [
  "breast",
  "lung",
  "colorectal",
  "prostate",
  "leukemia",
  "lymphoma",
  "myeloma",
  "melanoma",
  "pancreatic",
  "ovarian",
  "brain",
  "bladder",
  "kidney",
  "liver",
  "head-neck",
  "gastroesophageal",
  "uterine-cervical",
  "sarcoma",
  "thyroid",
  "solid-tumors",
  "other",
] as const;

export type CancerGroupId = (typeof CANCER_GROUP_IDS)[number];

interface CancerGroup {
  id: CancerGroupId;
  /** English display label (UI translations key off the id). */
  label: string;
  /** Extra search words for the intake's searchable picker. */
  synonyms: string[];
  /** Case-insensitive regexes matched against MeSH terms (conditions + ancestors). */
  mesh: RegExp[];
  /** Case-insensitive regexes matched against free-text conditions when MeSH is missing. */
  text: RegExp[];
}

export const CANCER_GROUPS: readonly CancerGroup[] = [
  { id: "breast", label: "Breast cancer", synonyms: ["breast", "ductal", "lobular", "TNBC", "triple negative"], mesh: [/^breast neoplasms/i, /breast carcinoma/i], text: [/breast/i] },
  { id: "lung", label: "Lung cancer", synonyms: ["NSCLC", "SCLC", "non-small cell", "small cell", "mesothelioma"], mesh: [/^lung neoplasms/i, /carcinoma, non-small-cell lung/i, /small cell lung carcinoma/i, /mesothelioma/i], text: [/lung|nsclc|sclc|mesothelioma|pleura(l|e)? (effusion|disease|cancer|tumou?r|malignan)/i] },
  { id: "colorectal", label: "Colorectal cancer", synonyms: ["colon", "rectal", "bowel", "anal"], mesh: [/^colorectal neoplasms/i, /^colonic neoplasms/i, /^rectal neoplasms/i, /^anus neoplasms/i], text: [/colorectal|colon|rectal|rectum|anal (cancer|carcinoma)/i] },
  { id: "prostate", label: "Prostate cancer", synonyms: ["prostate", "mCRPC", "castration"], mesh: [/^prostatic neoplasms/i], text: [/prostat/i] },
  { id: "leukemia", label: "Leukemia", synonyms: ["AML", "ALL", "CLL", "CML", "myelodysplastic", "MDS"], mesh: [/^leukemia/i, /myelodysplastic/i], text: [/leuk(a)?emia|\bAML\b|\bCLL\b|\bCML\b|myelodysplastic|\bMDS\b|hematologic(al)? malignanc|myeloid malignanc/i] },
  { id: "lymphoma", label: "Lymphoma", synonyms: ["Hodgkin", "non-Hodgkin", "DLBCL", "follicular", "mantle cell"], mesh: [/^lymphoma/i, /hodgkin disease/i], text: [/lymphoma|hodgkin|dlbcl|hematologic(al)? malignanc|lymphoproliferative (neoplasm|disorder|disease)|t-cell neoplasm|mycosis fungoides|s[eé]zary/i] },
  { id: "myeloma", label: "Multiple myeloma", synonyms: ["myeloma", "plasma cell"], mesh: [/^multiple myeloma/i, /plasma cell/i], text: [/myeloma|plasma cell|hematologic(al)? malignanc/i] },
  { id: "melanoma", label: "Melanoma and skin cancer", synonyms: ["melanoma", "skin", "merkel", "squamous skin", "basal cell"], mesh: [/^melanoma/i, /^skin neoplasms/i, /merkel cell/i], text: [/melanoma|skin cancer|merkel|cutaneous|basal cell carcinoma|actinic keratos/i] },
  { id: "pancreatic", label: "Pancreatic cancer", synonyms: ["pancreas", "PDAC"], mesh: [/^pancreatic neoplasms/i], text: [/pancrea/i] },
  { id: "ovarian", label: "Ovarian cancer", synonyms: ["ovary", "fallopian", "peritoneal"], mesh: [/^ovarian neoplasms/i, /fallopian tube neoplasms/i], text: [/ovar|fallopian|primary peritoneal/i] },
  { id: "brain", label: "Brain and spinal cord tumors", synonyms: ["glioma", "glioblastoma", "GBM", "astrocytoma", "CNS"], mesh: [/^brain neoplasms/i, /^glioma/i, /^glioblastoma/i, /central nervous system neoplasms/i], text: [/brain|glioma|glioblastoma|astrocytoma|\bCNS\b/i] },
  { id: "bladder", label: "Bladder and urothelial cancer", synonyms: ["bladder", "urothelial", "ureter"], mesh: [/^urinary bladder neoplasms/i, /urothelial/i, /^urologic neoplasms/i], text: [/(?<!gall ?)bladder|urothelial/i] },
  { id: "kidney", label: "Kidney cancer", synonyms: ["renal cell", "RCC", "kidney"], mesh: [/^kidney neoplasms/i, /carcinoma, renal cell/i], text: [/kidney|renal cell/i] },
  { id: "liver", label: "Liver and bile duct cancer", synonyms: ["hepatocellular", "HCC", "cholangiocarcinoma", "biliary"], mesh: [/^liver neoplasms/i, /carcinoma, hepatocellular/i, /cholangiocarcinoma/i, /biliary tract neoplasms/i, /^gallbladder neoplasms/i], text: [/liver|hepatocellular|cholangio|biliary|gall ?bladder|\bHCC\b/i] },
  { id: "head-neck", label: "Head and neck cancer", synonyms: ["oral", "throat", "larynx", "oropharyngeal", "nasopharyngeal"], mesh: [/^head and neck neoplasms/i, /squamous cell carcinoma of head and neck/i, /^mouth neoplasms/i, /^laryngeal neoplasms/i, /^pharyngeal neoplasms/i], text: [/head and neck|head & neck|\bHNSCC\b|\bSCCHN\b|oral cavity|oropharyn|laryn|nasopharyn|hypopharyn|salivary/i] },
  { id: "gastroesophageal", label: "Stomach and esophageal cancer", synonyms: ["stomach", "gastric", "esophagus", "GEJ"], mesh: [/^stomach neoplasms/i, /^esophageal neoplasms/i], text: [/gastric|stomach|esophag|gastroesophageal/i] },
  { id: "uterine-cervical", label: "Uterine and cervical cancer", synonyms: ["endometrial", "uterus", "cervix", "cervical"], mesh: [/^uterine neoplasms/i, /^endometrial neoplasms/i, /^uterine cervical neoplasms/i], text: [/endometri|uterine|uterus|cervical cancer|cervix/i] },
  { id: "sarcoma", label: "Sarcoma", synonyms: ["soft tissue", "bone", "osteosarcoma", "GIST"], mesh: [/^sarcoma/i, /osteosarcoma/i, /gastrointestinal stromal/i], text: [/sarcoma|\bGIST\b/i] },
  { id: "thyroid", label: "Thyroid cancer", synonyms: ["thyroid"], mesh: [/^thyroid neoplasms/i], text: [/thyroid/i] },
  { id: "solid-tumors", label: "Solid tumors / multiple cancers", synonyms: ["advanced solid tumor", "basket", "any cancer"], mesh: [], text: [/solid tumou?r|advanced (malignan|cancer)|neoplasms?$|metastatic cancer|multiple (cancer|tumor)/i] },
  { id: "other", label: "Other / not sure", synonyms: [], mesh: [], text: [] },
];

/** Groups a user can pick in intake (all except "other", which maps to the cross-group index). */
export const PICKABLE_GROUPS = CANCER_GROUPS.filter((g) => g.id !== "other");

export function getCancerGroup(id: CancerGroupId): CancerGroup {
  const g = CANCER_GROUPS.find((x) => x.id === id);
  if (!g) throw new Error(`Unknown cancer group ${id}`);
  return g;
}

/** Blood cancers: basket trials for "solid tumors" never apply to these. */
export const HEMATOLOGIC_GROUPS: readonly CancerGroupId[] = ["leukemia", "lymphoma", "myeloma"];

/** Specific cancer types whose patients can also join "any solid tumor" basket trials. */
export function basketAppliesTo(group: CancerGroupId): boolean {
  return group !== "other" && group !== "solid-tumors" && !HEMATOLOGIC_GROUPS.includes(group);
}

/** Shard id of the basket-only shard (solid-tumor trials that name no specific cancer type). */
export const BASKET_SHARD_ID = "solid-basket";

/** A solid-tumor basket trial that is not tied to any specific cancer group. */
export function isBasketOnly(groups: readonly CancerGroupId[]): boolean {
  return groups.includes("solid-tumors") && groups.every((g) => g === "solid-tumors");
}
