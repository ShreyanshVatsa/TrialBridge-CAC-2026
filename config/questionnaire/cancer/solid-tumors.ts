/** Group-specific questions for solid-tumors (QUESTIONNAIRE_SPEC §0.2, §1.3). Evidence: national data, 2026-10-07. */
import { biomarkerQuestion, priorDrugsQuestion, type GroupCatalog } from "./shared";

export const solidTumors: GroupCatalog = {
  group: "solid-tumors",
  priorDrugs: priorDrugsQuestion("solid-tumors", ["checkpoint", "platinum"], "solid tumors: exhausted standard therapy 17%"),
  biomarkers: biomarkerQuestion("solid-tumors", "solid tumors: HER2 12%, fusions 7%, KRAS 6%, BRAF 6%, MSI/TMB 5%"),
};
