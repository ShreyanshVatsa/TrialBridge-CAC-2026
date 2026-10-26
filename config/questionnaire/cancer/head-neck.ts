/** Group-specific questions for head-neck (QUESTIONNAIRE_SPEC §0.2, §1.3). Evidence: national data, 2026-10-07. */
import { biomarkerQuestion, priorDrugsQuestion, subtypeQuestion, type GroupCatalog } from "./shared";

export const headNeck: GroupCatalog = {
  group: "head-neck",
  subtype: subtypeQuestion("head-neck", [
    { id: "hnscc", is: ["hnscc"], isNot: ["nasopharyngeal", "salivary"], queryTerms: ["head and neck squamous cell carcinoma"], prior: 0.75 },
    { id: "nasopharyngeal", is: ["nasopharyngeal"], isNot: ["hnscc", "salivary"], queryTerms: ["nasopharyngeal carcinoma"], prior: 0.08 },
    { id: "salivary", is: ["salivary"], isNot: ["hnscc", "nasopharyngeal"], queryTerms: ["salivary gland cancer"], prior: 0.05 },
  ], "head-neck: subsite 38%"),
  priorDrugs: priorDrugsQuestion("head-neck", ["checkpoint", "platinum"], "head-neck: checkpoint 25%, platinum 21%"),
  biomarkers: biomarkerQuestion("head-neck", "head-neck: HPV/p16 23%, PD-L1/CPS 19%"),
};
