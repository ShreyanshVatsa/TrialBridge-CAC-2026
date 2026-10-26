/** Group-specific questions for brain (QUESTIONNAIRE_SPEC §0.2, §1.3). Evidence: national data, 2026-10-07. */
import { biomarkerQuestion, priorDrugsQuestion, subtypeQuestion, type GroupCatalog } from "./shared";

export const brain: GroupCatalog = {
  group: "brain",
  subtype: subtypeQuestion("brain", [
    { id: "glioblastoma", is: ["glioblastoma"], isNot: ["lower_grade_glioma", "meningioma"], queryTerms: ["glioblastoma"], prior: 0.55 },
    { id: "lower_grade_glioma", is: ["lower_grade_glioma"], isNot: ["glioblastoma", "meningioma"], queryTerms: ["lower grade glioma"], prior: 0.2 },
    { id: "meningioma", is: ["meningioma"], isNot: ["glioblastoma", "lower_grade_glioma"], queryTerms: ["meningioma"], prior: 0.08 },
  ], "brain: GBM vs lower grade 59%"),
  priorDrugs: priorDrugsQuestion("brain", ["temozolomide", "anti_vegf"], "brain: bevacizumab 20%, temozolomide 17% (prior radiation 72%)"),
  biomarkers: biomarkerQuestion("brain", "brain: IDH 18%, MGMT 7%"),
};
