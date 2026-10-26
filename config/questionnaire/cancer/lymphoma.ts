/** Group-specific questions for lymphoma (QUESTIONNAIRE_SPEC §0.2, §1.3). Evidence: national data, 2026-10-07. */
import { priorDrugsQuestion, subtypeQuestion, type GroupCatalog } from "./shared";

export const lymphoma: GroupCatalog = {
  group: "lymphoma",
  subtype: subtypeQuestion("lymphoma", [
    { id: "dlbcl", is: ["dlbcl"], isNot: ["follicular", "mantle_cell", "marginal_zone", "hodgkin", "t_cell_lymphoma"], queryTerms: ["diffuse large B-cell lymphoma"], prior: 0.35 },
    { id: "follicular", is: ["follicular"], isNot: ["dlbcl", "mantle_cell", "marginal_zone", "hodgkin", "t_cell_lymphoma"], queryTerms: ["follicular lymphoma"], prior: 0.15 },
    { id: "mantle_cell", is: ["mantle_cell"], isNot: ["dlbcl", "follicular", "marginal_zone", "hodgkin", "t_cell_lymphoma"], queryTerms: ["mantle cell lymphoma"], prior: 0.08 },
    { id: "marginal_zone", is: ["marginal_zone"], isNot: ["dlbcl", "follicular", "mantle_cell", "hodgkin", "t_cell_lymphoma"], queryTerms: ["marginal zone lymphoma"], prior: 0.06 },
    { id: "hodgkin", is: ["hodgkin"], isNot: ["dlbcl", "follicular", "mantle_cell", "marginal_zone", "t_cell_lymphoma"], queryTerms: ["Hodgkin lymphoma"], prior: 0.12 },
    { id: "t_cell_lymphoma", is: ["t_cell_lymphoma"], isNot: ["dlbcl", "follicular", "mantle_cell", "marginal_zone", "hodgkin"], queryTerms: ["T-cell lymphoma"], prior: 0.07 },
  ], "lymphoma: subtype 67%, CNS involvement 29%"),
  priorDrugs: priorDrugsQuestion("lymphoma", ["anti_cd20", "car_t", "btk", "bispecific", "auto_sct"], "lymphoma: SCT 48%, CAR-T 32%, anti-CD20 21%, BTK 16%, bispecific 12%"),
};
