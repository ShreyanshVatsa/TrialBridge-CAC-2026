/** Group-specific questions for sarcoma (QUESTIONNAIRE_SPEC §0.2, §1.3). Evidence: national data, 2026-10-07. */
import { biomarkerQuestion, deepBiomarkerQuestion, subtypeQuestion, type GroupCatalog } from "./shared";

export const sarcoma: GroupCatalog = {
  group: "sarcoma",
  subtype: subtypeQuestion("sarcoma", [
    { id: "soft_tissue_sarcoma", is: [], isNot: ["gist", "osteosarcoma", "ewing"], queryTerms: ["soft tissue sarcoma"], prior: 0.6 },
    { id: "gist", is: ["gist"], isNot: ["osteosarcoma", "ewing"], queryTerms: ["gastrointestinal stromal tumor"], prior: 0.12 },
    { id: "osteosarcoma", is: ["osteosarcoma"], isNot: ["gist", "ewing"], queryTerms: ["osteosarcoma"], prior: 0.08 },
    { id: "ewing", is: ["ewing"], isNot: ["gist", "osteosarcoma"], queryTerms: ["Ewing sarcoma"], prior: 0.06 },
  ], "sarcoma: subtype 40%"),
  biomarkers: biomarkerQuestion("sarcoma", "sarcoma: NTRK fusions (basket), KIT/PDGFRA 5%"),
  deepBiomarkers: deepBiomarkerQuestion("sarcoma", "sarcoma: KIT/PDGFRA 5%"),
};
