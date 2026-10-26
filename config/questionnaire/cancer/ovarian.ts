/** Group-specific questions for ovarian (QUESTIONNAIRE_SPEC §0.2, §1.3). Evidence: national data, 2026-10-07. */
import { has, lacks } from "../build";
import { biomarkerQuestion, groupStatusQuestion, priorDrugsQuestion, subtypeQuestion, type GroupCatalog } from "./shared";

export const ovarian: GroupCatalog = {
  group: "ovarian",
  subtype: subtypeQuestion("ovarian", [
    { id: "hgsoc", is: ["hgsoc"], isNot: ["ovarian_clear_cell", "low_grade_serous_ovarian"], queryTerms: ["high-grade serous ovarian cancer"], prior: 0.65 },
    { id: "ovarian_other", is: [], isNot: ["hgsoc"], queryTerms: ["ovarian cancer"], prior: 0.2 },
  ], "ovarian: high-grade serous 31%, other histology 26%"),
  groupStatus: groupStatusQuestion("ovarian", [
    { id: "platinum_resistant", facts: [has("platinum_resistant"), lacks("platinum_sensitive")], queryTerms: ["platinum-resistant ovarian cancer"], prior: 0.35 },
    { id: "platinum_sensitive", facts: [has("platinum_sensitive"), lacks("platinum_resistant")], queryTerms: ["platinum-sensitive ovarian cancer"], prior: 0.35 },
  ], "ovarian: platinum-sensitive/resistant 27%", ["group_status"]),
  priorDrugs: priorDrugsQuestion("ovarian", ["platinum", "parp", "anti_vegf"], "ovarian: platinum 44%, bevacizumab 18%, PARP 16%"),
  biomarkers: biomarkerQuestion("ovarian", "ovarian: BRCA/HRD 18%"),
};
