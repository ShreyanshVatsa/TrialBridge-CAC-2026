/** Group-specific questions for bladder (QUESTIONNAIRE_SPEC §0.2, §1.3). Evidence: national data, 2026-10-07. */
import { has, lacks } from "../build";
import { biomarkerQuestion, groupStatusQuestion, priorDrugsQuestion, type GroupCatalog } from "./shared";

export const bladder: GroupCatalog = {
  group: "bladder",
  groupStatus: groupStatusQuestion("bladder", [
    { id: "nmibc", facts: [lacks("mibc", { whenExcluded: "support" })], queryTerms: ["non-muscle invasive bladder cancer"], prior: 0.4 },
    { id: "mibc", facts: [has("mibc")], queryTerms: ["muscle-invasive bladder cancer"], prior: 0.4 },
  ], "bladder: NMIBC vs MIBC 22%", ["group_status"]),
  priorDrugs: priorDrugsQuestion("bladder", ["checkpoint", "adc", "bcg", "platinum"], "bladder: checkpoint 39%, ADC 13%, BCG 14%"),
  biomarkers: biomarkerQuestion("bladder", "bladder: PD-L1 23%"),
};
