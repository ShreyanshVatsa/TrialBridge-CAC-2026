/** Group-specific questions for leukemia (QUESTIONNAIRE_SPEC §0.2, §1.3). Evidence: national data, 2026-10-07. */
import { biomarkerQuestion, priorDrugsQuestion, subtypeQuestion, type GroupCatalog } from "./shared";

export const leukemia: GroupCatalog = {
  group: "leukemia",
  subtype: subtypeQuestion("leukemia", [
    { id: "aml", is: ["aml"], isNot: ["all", "cll", "cml", "mds"], queryTerms: ["acute myeloid leukemia"], prior: 0.35 },
    { id: "all", is: ["all"], isNot: ["aml", "cll", "cml", "mds"], queryTerms: ["acute lymphoblastic leukemia"], prior: 0.15 },
    { id: "cll", is: ["cll"], isNot: ["aml", "all", "cml", "mds"], queryTerms: ["chronic lymphocytic leukemia"], prior: 0.2 },
    { id: "cml", is: ["cml"], isNot: ["aml", "all", "cll", "mds"], queryTerms: ["chronic myeloid leukemia"], prior: 0.07 },
    { id: "mds", is: ["mds"], isNot: ["aml", "all", "cll", "cml"], queryTerms: ["myelodysplastic syndrome"], prior: 0.13 },
  ], "leukemia: subtype AML/ALL/CLL/CML/MDS 82%"),
  priorDrugs: priorDrugsQuestion("leukemia", ["hma", "venetoclax", "car_t", "bispecific", "btk"], "leukemia: HMA/venetoclax 32%, CAR-T 15%"),
  biomarkers: biomarkerQuestion("leukemia", "leukemia: FLT3 12%, Ph+/BCR-ABL 11%, IDH 8%, NPM1 6%, TP53 6%"),
};
