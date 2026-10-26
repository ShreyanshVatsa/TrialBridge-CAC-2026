/** Group-specific questions for melanoma (QUESTIONNAIRE_SPEC §0.2, §1.3). Evidence: national data, 2026-10-07. */
import { biomarkerQuestion, priorDrugsQuestion, subtypeQuestion, type GroupCatalog } from "./shared";

export const melanoma: GroupCatalog = {
  group: "melanoma",
  subtype: subtypeQuestion("melanoma", [
    { id: "melanoma_cutaneous", is: [], isNot: ["uveal_melanoma", "mucosal_melanoma", "cutaneous_scc", "merkel_cell"], queryTerms: ["cutaneous melanoma"], prior: 0.6 },
    { id: "melanoma_uveal", is: ["uveal_melanoma"], isNot: ["mucosal_melanoma", "cutaneous_scc", "merkel_cell"], queryTerms: ["uveal melanoma"], prior: 0.08 },
    { id: "melanoma_mucosal", is: ["mucosal_melanoma"], isNot: ["uveal_melanoma", "cutaneous_scc", "merkel_cell"], queryTerms: ["mucosal melanoma"], prior: 0.04 },
    { id: "cutaneous_scc", is: ["cutaneous_scc"], isNot: ["uveal_melanoma", "mucosal_melanoma", "merkel_cell"], queryTerms: ["cutaneous squamous cell carcinoma"], prior: 0.1 },
    { id: "merkel_cell", is: ["merkel_cell"], isNot: ["uveal_melanoma", "mucosal_melanoma", "cutaneous_scc"], queryTerms: ["Merkel cell carcinoma"], prior: 0.03 },
    { id: "basal_cell", is: [], isNot: ["uveal_melanoma", "mucosal_melanoma", "cutaneous_scc", "merkel_cell"], queryTerms: ["basal cell carcinoma"], prior: 0.05 },
  ], "melanoma: uveal/mucosal/acral 30%"),
  priorDrugs: priorDrugsQuestion("melanoma", ["checkpoint", "braf_mek"], "melanoma: checkpoint 47%, BRAF/MEK 14%"),
  biomarkers: biomarkerQuestion("melanoma", "melanoma: PD-L1 26%, BRAF 22%"),
};
