/** Group-specific questions for liver (QUESTIONNAIRE_SPEC §0.2, §1.3). Evidence: national data, 2026-10-07. */
import { biomarkerQuestion, priorDrugsQuestion, subtypeQuestion, type GroupCatalog } from "./shared";

export const liver: GroupCatalog = {
  group: "liver",
  subtype: subtypeQuestion("liver", [
    { id: "hcc", is: ["hcc"], isNot: ["biliary"], queryTerms: ["hepatocellular carcinoma"], prior: 0.6 },
    { id: "biliary", is: ["biliary"], isNot: ["hcc"], queryTerms: ["cholangiocarcinoma", "biliary tract cancer"], prior: 0.3 },
  ], "liver: HCC vs biliary 68%"),
  priorDrugs: priorDrugsQuestion("liver", ["checkpoint", "vegf_tki", "anti_vegf"], "liver: checkpoint 35%"),
  biomarkers: biomarkerQuestion("liver", "liver: FGFR2/IDH1 3%"),
};
