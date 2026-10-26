/** Group-specific questions for breast (QUESTIONNAIRE_SPEC §0.2, §1.3). Evidence: national data, 2026-10-07. */
import { lacks } from "../build";
import { biomarkerQuestion, deepBiomarkerQuestion, priorDrugsQuestion, type GroupCatalog } from "./shared";

export const breast: GroupCatalog = {
  group: "breast",
  priorDrugs: priorDrugsQuestion("breast", ["endocrine", "cdk46", "anti_her2", "adc", "checkpoint"], "breast: endocrine 28%, CDK4/6 15%, anti-HER2 13%, ADC 13% of trials"),
  // "Triple-negative" shortcut: HER2-negative and HR-negative in one tap.
  biomarkers: biomarkerQuestion("breast", "breast: HER2 46%, HR 38%, TNBC 21%, PD-L1 8%, BRCA 6%", [{ option: "tnbc", facts: [lacks("biomarker:HER2", { whenExcluded: "support" }), lacks("biomarker:HR", { whenExcluded: "support" })], queryTerms: ["triple-negative breast cancer"] }]),
  deepBiomarkers: deepBiomarkerQuestion("breast", "breast: PIK3CA/AKT 5%, ESR1 <5%"),
};
