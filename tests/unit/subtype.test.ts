import { describe, expect, it } from "vitest";
import { subtypeMatch, subtypeProfile, type SubtypeProfile } from "@/lib/match/subtype";

const card = (title: string, conditions: string[] = []) => ({ title, conditions });
const profile = (is: string[], isNot: string[], conflictTags: string[] = [], ownTags: string[] = []): SubtypeProfile => ({
  is: new Set(is),
  isNot: new Set(isNot),
  ...(conflictTags.length ? { conflictTags: new Set(conflictTags) } : {}),
  ...(ownTags.length ? { ownTags: new Set(ownTags) } : {}),
});

describe("subtypeMatch", () => {
  const hodgkin = profile(["hodgkin"], ["dlbcl", "follicular", "mantle_cell", "marginal_zone", "t_cell_lymphoma"], ["nhl", "lbcl", "cll"]);
  it("a registered histology the patient has is a match", () => {
    expect(subtypeMatch(hodgkin, card("Brentuximab in Classical Hodgkin Lymphoma"), "lymphoma")).toBe(1);
  });
  it("family-level sibling tags make a conflict for the patient who lists them", () => {
    expect(subtypeMatch(hodgkin, card("TLN-121 in Relapsed or Refractory Non-Hodgkin Lymphomas"), "lymphoma")).toBe(-1);
    expect(subtypeMatch(hodgkin, card("Epcoritamab in Relapsed Large B-cell Lymphoma"), "lymphoma")).toBe(-1);
  });
  it("a trial naming the patient's disease and a sibling is never a conflict", () => {
    expect(subtypeMatch(hodgkin, card("CAR T cells for Hodgkin Lymphoma and Non-Hodgkin Lymphoma"), "lymphoma")).toBe(1);
  });
  it("specific histologies decide alone: own tags never cancel a specific conflict", () => {
    const mzl = profile(["marginal_zone"], ["dlbcl", "follicular"], ["cll"], ["nhl"]);
    expect(subtypeMatch(mzl, card("Study in Follicular Lymphoma and Other B-cell NHL", ["Follicular Lymphoma"]), "lymphoma")).toBe(-1);
    expect(subtypeMatch(mzl, card("A Study in Relapsed B-cell Non-Hodgkin Lymphoma"), "lymphoma")).toBe(0);
    expect(subtypeMatch(mzl, card("Pirtobrutinib in CLL/SLL"), "lymphoma")).toBe(-1);
  });
  it("primary brain tumors: metastasis trials conflict; a glioma tag protects glioma patients", () => {
    const gbm = profile(["glioblastoma"], ["lower_grade_glioma", "meningioma"], ["brain_metastases"], ["glioma"]);
    expect(subtypeMatch(gbm, card("Radiosurgery for Brain Metastases"), "brain")).toBe(-1);
    expect(subtypeMatch(gbm, card("Proton Therapy for High-grade Glioma or Brain Metastases"), "brain")).toBe(0);
    const meningioma = profile(["meningioma"], ["glioblastoma", "lower_grade_glioma"], ["brain_metastases", "glioma"]);
    expect(subtypeMatch(meningioma, card("Preoperative Radiosurgery for High Grade Glioma"), "brain")).toBe(-1);
  });
  it("sibling tags are ignored for a patient who does not list them, so earlier conflicts stay", () => {
    const cutaneous = profile([], ["uveal_melanoma", "mucosal_melanoma", "cutaneous_scc", "merkel_cell"]);
    expect(subtypeMatch(cutaneous, card("Tebentafusp in Uveal Melanoma"), "melanoma")).toBe(-1);
    expect(subtypeMatch(cutaneous, card("Nivolumab in Advanced Melanoma"), "melanoma")).toBe(0);
  });
  it("no profile or no tags is neutral", () => {
    expect(subtypeMatch(null, card("Non-Hodgkin Lymphoma"), "lymphoma")).toBe(0);
    expect(subtypeMatch(hodgkin, card("Exercise During Chemotherapy"), "lymphoma")).toBe(0);
  });
});

describe("subtypeProfile", () => {
  it("adds the chosen option's sibling tags; unknown answers add nothing", () => {
    expect(subtypeProfile([], { subtype: "anal" })?.conflictTags?.has("colorectal")).toBe(true);
    expect(subtypeProfile([], { subtype: "unknown" })).toBeNull();
    expect(subtypeProfile([], {})).toBeNull();
  });
});
