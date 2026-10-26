/** Group-specific questions for gastroesophageal (QUESTIONNAIRE_SPEC §0.2, §1.3). Evidence: national data, 2026-10-07. */
import { biomarkerQuestion, priorDrugsQuestion, subtypeQuestion, type GroupCatalog } from "./shared";

export const gastroesophageal: GroupCatalog = {
  group: "gastroesophageal",
  subtype: subtypeQuestion("gastroesophageal", [
    { id: "gastric_gej_adeno", is: ["gastroesophageal_adeno"], isNot: ["esophageal_squamous"], queryTerms: ["gastric or gastroesophageal junction adenocarcinoma"], prior: 0.55 },
    { id: "esophageal_adeno", is: ["gastroesophageal_adeno"], isNot: ["esophageal_squamous"], queryTerms: ["esophageal adenocarcinoma"], prior: 0.15 },
    { id: "esophageal_squamous", is: ["esophageal_squamous"], isNot: ["gastroesophageal_adeno"], queryTerms: ["esophageal squamous cell carcinoma"], prior: 0.15 },
  ], "gastroesophageal: gastric/GEJ/esophageal 62%, adeno vs squamous 58%"),
  priorDrugs: priorDrugsQuestion("gastroesophageal", ["platinum", "fluoropyrimidine", "checkpoint", "anti_her2"], "gastroesophageal: platinum 26%, 5-FU 18%"),
  biomarkers: biomarkerQuestion("gastroesophageal", "gastroesophageal: HER2 31%, PD-L1/CPS 23%, MSI 9%, Claudin 18.2 6%"),
};
