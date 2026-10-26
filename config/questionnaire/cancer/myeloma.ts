/** Group-specific questions for myeloma (QUESTIONNAIRE_SPEC §0.2, §1.3). Evidence: national data, 2026-10-07. */
import { has, lacks } from "../build";
import { groupStatusQuestion, priorDrugsQuestion, type GroupCatalog } from "./shared";

export const myeloma: GroupCatalog = {
  group: "myeloma",
  groupStatus: groupStatusQuestion("myeloma", [
    { id: "active_myeloma", facts: [lacks("histology:smoldering_myeloma"), lacks("histology:amyloidosis")], queryTerms: ["multiple myeloma"], prior: 0.75 },
    { id: "smoldering", facts: [has("histology:smoldering_myeloma"), lacks("histology:amyloidosis")], queryTerms: ["smoldering myeloma"], prior: 0.08 },
    { id: "mgus", facts: [lacks("histology:smoldering_myeloma"), lacks("histology:amyloidosis")], queryTerms: ["monoclonal gammopathy"], prior: 0.04 },
    { id: "amyloidosis", facts: [has("histology:amyloidosis"), lacks("histology:smoldering_myeloma")], queryTerms: ["AL amyloidosis"], prior: 0.05 },
  ], "myeloma: smoldering/MGUS/amyloid 42%", ["histology", "group_status"]),
  priorDrugs: priorDrugsQuestion("myeloma", ["anti_cd38", "imid", "proteasome_inhibitor", "bcma", "car_t", "auto_sct"], "myeloma: CD38/IMiD/PI 48%, SCT 47%, CAR-T 28%, BCMA/bispecific 25%"),
};
