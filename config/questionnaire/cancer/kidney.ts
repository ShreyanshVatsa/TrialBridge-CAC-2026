/** Group-specific questions for kidney (QUESTIONNAIRE_SPEC §0.2, §1.3). Evidence: national data, 2026-10-07. */
import { priorDrugsQuestion, subtypeQuestion, type GroupCatalog } from "./shared";

export const kidney: GroupCatalog = {
  group: "kidney",
  subtype: subtypeQuestion("kidney", [
    { id: "rcc_clear_cell", is: ["clear_cell_rcc"], isNot: [], queryTerms: ["clear cell renal cell carcinoma"], prior: 0.7 },
    { id: "rcc_non_clear_cell", is: [], isNot: ["clear_cell_rcc"], queryTerms: ["non-clear cell renal cell carcinoma"], prior: 0.15 },
  ], "kidney: clear cell vs other 39%"),
  priorDrugs: priorDrugsQuestion("kidney", ["checkpoint", "vegf_tki"], "kidney: checkpoint 44%, TKI/VEGF 20%"),
};
