/** Group-specific questions for pancreatic (QUESTIONNAIRE_SPEC §0.2, §1.3). Evidence: national data, 2026-10-07. */
import { has, lacks } from "../build";
import { biomarkerQuestion, deepBiomarkerQuestion, groupStatusQuestion, priorDrugsQuestion, subtypeQuestion, type GroupCatalog } from "./shared";

export const pancreatic: GroupCatalog = {
  group: "pancreatic",
  subtype: subtypeQuestion("pancreatic", [
    { id: "pdac", is: ["pdac"], isNot: ["pnet"], queryTerms: ["pancreatic adenocarcinoma"], prior: 0.8 },
    { id: "pnet", is: ["pnet"], isNot: ["pdac"], queryTerms: ["pancreatic neuroendocrine tumor"], prior: 0.08 },
  ], "pancreatic: adenocarcinoma vs NET 62%"),
  groupStatus: groupStatusQuestion("pancreatic", [
    { id: "resectable", facts: [has("resectable")], queryTerms: ["resectable pancreatic cancer"], prior: 0.2 },
    { id: "borderline_resectable", facts: [], queryTerms: ["borderline resectable"], prior: 0.1 },
    { id: "unresectable", facts: [lacks("resectable", { whenExcluded: "support" })], queryTerms: ["unresectable pancreatic cancer"], prior: 0.5 },
  ], "pancreatic: resectable/borderline/locally advanced 41%", ["group_status"]),
  priorDrugs: priorDrugsQuestion("pancreatic", ["fluoropyrimidine", "platinum", "taxane"], "pancreatic: FOLFIRINOX/5-FU 19%"),
  biomarkers: biomarkerQuestion("pancreatic", "pancreatic: KRAS 14%, BRCA/PALB2 6%, MSI 3%"),
  deepBiomarkers: deepBiomarkerQuestion("pancreatic", "pancreatic: PALB2 <6%"),
};
