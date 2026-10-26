/** Group-specific questions for uterine-cervical (QUESTIONNAIRE_SPEC §0.2, §1.3). Evidence: national data, 2026-10-07. */
import { biomarkerQuestion, priorDrugsQuestion, subtypeQuestion, type GroupCatalog } from "./shared";

export const uterineCervical: GroupCatalog = {
  group: "uterine-cervical",
  subtype: subtypeQuestion("uterine-cervical", [
    { id: "endometrial", is: ["endometrial"], isNot: ["cervical"], queryTerms: ["endometrial cancer"], prior: 0.55 },
    { id: "cervical", is: ["cervical"], isNot: ["endometrial"], queryTerms: ["cervical cancer"], prior: 0.4 },
  ], "uterine-cervical: endometrial vs cervical 80%"),
  priorDrugs: priorDrugsQuestion("uterine-cervical", ["platinum", "checkpoint", "anti_vegf"], "uterine-cervical: platinum 24%, checkpoint 24%"),
  biomarkers: biomarkerQuestion("uterine-cervical", "uterine-cervical: PD-L1 16%, HER2 11%, MSI 11%, HPV 6%, p53/POLE 4%"),
};
