/** Group-specific questions for colorectal (QUESTIONNAIRE_SPEC §0.2, §1.3). Evidence: national data, 2026-10-07. */
import { biomarkerQuestion, priorDrugsQuestion, subtypeQuestion, type GroupCatalog } from "./shared";

export const colorectal: GroupCatalog = {
  group: "colorectal",
  subtype: subtypeQuestion("colorectal", [
    { id: "colon", is: [], isNot: ["rectal", "anal"], queryTerms: ["colon cancer"], prior: 0.6 },
    { id: "rectal", is: ["rectal"], isNot: ["anal"], queryTerms: ["rectal cancer"], prior: 0.3 },
    { id: "anal", is: ["anal"], isNot: ["rectal"], queryTerms: ["anal cancer"], prior: 0.04 },
  ], "colorectal: rectal vs colon 25%, anal 8%"),
  priorDrugs: priorDrugsQuestion("colorectal", ["fluoropyrimidine", "platinum", "anti_vegf", "checkpoint"], "colorectal: fluoropyrimidine/irinotecan 22%, anti-VEGF 11%"),
  biomarkers: biomarkerQuestion("colorectal", "colorectal: MSI/dMMR 26%, RAS 17%, HER2 9%, BRAF 8%"),
};
