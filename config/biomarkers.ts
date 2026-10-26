import type { CancerGroupId } from "./cancer-groups";

/** Biomarkers recognized by the rule layer and offered in intake. */
export const BIOMARKER_IDS = ["HER2", "HR", "BRCA", "EGFR", "ALK", "ROS1", "KRAS", "BRAF", "PD-L1", "MSI-H", "NTRK", "FLT3", "IDH", "MET", "RET", "HPV", "CLDN18", "PH", "NPM1", "TP53", "MGMT", "PIK3CA", "ESR1", "PALB2", "KIT"] as const;
export type BiomarkerId = (typeof BIOMARKER_IDS)[number];

export interface Biomarker {
  id: BiomarkerId;
  label: string;
  /** Regex matched against criterion text to detect a mention (word-boundary aware). */
  pattern: RegExp;
}

export const BIOMARKERS: readonly Biomarker[] = [
  { id: "HER2", label: "HER2", pattern: /\b(HER-?2|ERBB2)\b/i },
  { id: "HR", label: "Hormone receptor (ER/PR)", pattern: /\b(hormone receptor|HR[+-]|estrogen receptor|progesterone receptor|ER[+-]|ER\/PR)/i },
  { id: "BRCA", label: "BRCA1/2", pattern: /\bBRCA ?[12]?\b/i },
  { id: "EGFR", label: "EGFR", pattern: /\bEGFR\b/i },
  { id: "ALK", label: "ALK", pattern: /\bALK\b/ },
  { id: "ROS1", label: "ROS1", pattern: /\bROS-?1\b/i },
  { id: "KRAS", label: "KRAS", pattern: /\bKRAS\b/i },
  { id: "BRAF", label: "BRAF", pattern: /\bBRAF\b/i },
  { id: "PD-L1", label: "PD-L1", pattern: /\bPD-?L1\b/i },
  { id: "MSI-H", label: "MSI-high / dMMR", pattern: /\b(MSI-?H(igh)?|microsatellite instability|dMMR|mismatch repair)\b/i },
  { id: "NTRK", label: "NTRK fusion", pattern: /\bNTRK\b/i },
  { id: "FLT3", label: "FLT3", pattern: /\bFLT-?3\b/i },
  { id: "IDH", label: "IDH1/2", pattern: /\bIDH-?[12]?\b/i },
  // Questionnaire markers (QUESTIONNAIRE_SPEC §1.4). Case-sensitive where the symbol is also an English word (MET, RET, KIT).
  { id: "MET", label: "MET", pattern: /\b(c-MET|MET)(ex14)?\b/ },
  { id: "RET", label: "RET fusion", pattern: /\bRET\b/ },
  { id: "HPV", label: "HPV / p16", pattern: /\b(HPV|human papilloma ?virus|p16)\b/i },
  { id: "CLDN18", label: "Claudin 18.2", pattern: /\b(claudin[- ]?18(\.2)?|CLDN ?18(\.2)?)/i },
  { id: "PH", label: "Philadelphia chromosome (BCR-ABL)", pattern: /\b(Philadelphia[- ]chromosome|BCR[-:: ]{0,2}ABL1?|Ph\+|Ph-(?=negative|positive|\s|,|\))|Ph(?= ?(positive|negative)))/ },
  { id: "NPM1", label: "NPM1", pattern: /\bNPM-?1\b/i },
  { id: "TP53", label: "TP53", pattern: /\b(TP53|p53)\b/ },
  { id: "MGMT", label: "MGMT methylation", pattern: /\bMGMT\b/i },
  { id: "PIK3CA", label: "PIK3CA", pattern: /\bPIK3CA\b/i },
  { id: "ESR1", label: "ESR1", pattern: /\bESR-?1\b/i },
  { id: "PALB2", label: "PALB2", pattern: /\bPALB-?2\b/i },
  { id: "KIT", label: "KIT", pattern: /\b(c-KIT|KIT|CD117)\b/ },
];

/**
 * Which biomarkers intake asks about for each cancer group (empty = question is skipped), ordered by
 * how often national trials in the group mention them (QUESTIONNAIRE_SPEC §0.2, §0.4.2).
 */
export const BIOMARKERS_BY_GROUP: Record<CancerGroupId, BiomarkerId[]> = {
  breast: ["HER2", "HR", "PD-L1", "BRCA"],
  lung: ["EGFR", "PD-L1", "ALK", "ROS1", "KRAS", "HER2", "BRAF", "MET", "RET"],
  colorectal: ["MSI-H", "KRAS", "HER2", "BRAF"],
  prostate: ["BRCA"],
  leukemia: ["FLT3", "PH", "IDH", "NPM1", "TP53"],
  lymphoma: [],
  myeloma: [],
  melanoma: ["PD-L1", "BRAF"],
  pancreatic: ["KRAS", "BRCA", "MSI-H"],
  ovarian: ["BRCA", "MSI-H"],
  brain: ["IDH", "MGMT"],
  bladder: ["PD-L1", "MSI-H"],
  kidney: [],
  liver: ["IDH"],
  "head-neck": ["HPV", "PD-L1"],
  gastroesophageal: ["HER2", "PD-L1", "MSI-H", "CLDN18"],
  "uterine-cervical": ["PD-L1", "HER2", "MSI-H", "HPV", "TP53"],
  sarcoma: ["NTRK"],
  thyroid: ["BRAF", "RET", "NTRK"],
  "solid-tumors": ["HER2", "BRCA", "KRAS", "BRAF", "MSI-H", "NTRK", "PD-L1"],
  other: [],
};

/** Rarer markers asked only in Deep-dive (`deep_biomarkers`, 1-9% of trials in the group). */
export const DEEP_BIOMARKERS_BY_GROUP: Partial<Record<CancerGroupId, BiomarkerId[]>> = {
  breast: ["PIK3CA", "ESR1"],
  prostate: ["MSI-H"],
  pancreatic: ["PALB2"],
  sarcoma: ["KIT"],
  lung: ["NTRK"],
};
