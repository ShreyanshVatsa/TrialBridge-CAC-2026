/** Group-specific questions for prostate (QUESTIONNAIRE_SPEC §0.2, §1.3). Evidence: national data, 2026-10-07. */
import { has, lacks } from "../build";
import { biomarkerQuestion, deepBiomarkerQuestion, groupStatusQuestion, priorDrugsQuestion, type GroupCatalog } from "./shared";

export const prostate: GroupCatalog = {
  group: "prostate",
  groupStatus: groupStatusQuestion("prostate", [
    { id: "cspc", facts: [lacks("castration_resistant", { whenExcluded: "support" })], queryTerms: ["hormone-sensitive prostate cancer"], prior: 0.35 },
    { id: "crpc", facts: [has("castration_resistant")], queryTerms: ["castration-resistant prostate cancer"], prior: 0.4 },
  ], "prostate: castration status 36%", ["group_status"]),
  priorDrugs: priorDrugsQuestion("prostate", ["arpi", "taxane", "lu_psma", "parp"], "prostate: ARPI/ADT 58%, taxane 19%, Lu-PSMA 15%, PARP 9%"),
  biomarkers: biomarkerQuestion("prostate", "prostate: BRCA/HRR 5%"),
  deepBiomarkers: deepBiomarkerQuestion("prostate", "prostate: MSI 1%"),
};
