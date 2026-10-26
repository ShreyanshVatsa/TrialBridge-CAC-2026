/** Group-specific questions for lung (QUESTIONNAIRE_SPEC §0.2, §1.3). Evidence: national data, 2026-10-07. */
import { biomarkerQuestion, deepBiomarkerQuestion, priorDrugsQuestion, subtypeQuestion, type GroupCatalog } from "./shared";

export const lung: GroupCatalog = {
  group: "lung",
  subtype: subtypeQuestion("lung", [
    { id: "nsclc_adeno", is: ["nsclc"], isNot: ["sclc", "lung_squamous", "mesothelioma"], queryTerms: ["non-small cell lung cancer", "adenocarcinoma"], prior: 0.4 },
    { id: "nsclc_squamous", is: ["nsclc", "lung_squamous"], isNot: ["sclc", "mesothelioma"], queryTerms: ["non-small cell lung cancer", "squamous"], prior: 0.2 },
    { id: "nsclc_other", is: ["nsclc"], isNot: ["sclc", "mesothelioma"], queryTerms: ["non-small cell lung cancer"], prior: 0.05 },
    { id: "sclc", is: ["sclc"], isNot: ["nsclc", "lung_squamous", "mesothelioma"], queryTerms: ["small cell lung cancer"], prior: 0.12 },
    { id: "mesothelioma", is: ["mesothelioma"], isNot: ["nsclc", "sclc", "lung_squamous"], queryTerms: ["mesothelioma"], prior: 0.03 },
  ], "lung: SCLC vs NSCLC 43%, squamous 30%"),
  priorDrugs: priorDrugsQuestion("lung", ["checkpoint", "platinum", "egfr_tki", "alk_tki", "adc"], "lung: checkpoint 31%, platinum 26%, TKI 12%"),
  biomarkers: biomarkerQuestion("lung", "lung: EGFR 31%, PD-L1 27%, ALK 20%, ROS1 12%, KRAS 12%, HER2 11%, BRAF 8%, MET 7%, RET 7%"),
  deepBiomarkers: deepBiomarkerQuestion("lung", "lung: NTRK 5%"),
};
