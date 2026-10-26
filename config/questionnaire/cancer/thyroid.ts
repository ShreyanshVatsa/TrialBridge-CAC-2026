/** Group-specific questions for thyroid (QUESTIONNAIRE_SPEC §0.2, §1.3). Evidence: national data, 2026-10-07. */
import { has, lacks } from "../build";
import { biomarkerQuestion, groupStatusQuestion, priorDrugsQuestion, subtypeQuestion, type GroupCatalog } from "./shared";

export const thyroid: GroupCatalog = {
  group: "thyroid",
  subtype: subtypeQuestion("thyroid", [
    { id: "thyroid_differentiated", is: ["differentiated_thyroid"], isNot: ["medullary_thyroid", "anaplastic_thyroid"], queryTerms: ["differentiated thyroid cancer"], prior: 0.75 },
    { id: "thyroid_medullary", is: ["medullary_thyroid"], isNot: ["differentiated_thyroid", "anaplastic_thyroid"], queryTerms: ["medullary thyroid cancer"], prior: 0.08 },
    { id: "thyroid_anaplastic", is: ["anaplastic_thyroid"], isNot: ["differentiated_thyroid", "medullary_thyroid"], queryTerms: ["anaplastic thyroid cancer"], prior: 0.05 },
  ], "thyroid: subtype 38%"),
  groupStatus: groupStatusQuestion("thyroid", [
    { id: "rai_refractory", facts: [has("rai_refractory")], queryTerms: ["radioactive iodine refractory"], prior: 0.3 },
    { id: "rai_responsive", facts: [lacks("rai_refractory")], queryTerms: [], prior: 0.3 },
  ], "thyroid: RAI-refractory 36%", ["group_status"]),
  priorDrugs: priorDrugsQuestion("thyroid", ["vegf_tki"], "thyroid: kinase inhibitors (lenvatinib, sorafenib)"),
  biomarkers: biomarkerQuestion("thyroid", "thyroid: BRAF 22%, RET 11%, NTRK 9%"),
};
