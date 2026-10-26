import type { Fact, Site, TrialCard } from "@/lib/types/trial";
import type { IntakeAnswers } from "@/lib/types/intake";

/** Minimal valid card for unit tests (synthetic test fixture, not trial data shown to users). */
export function makeCard(over: Partial<TrialCard> = {}): TrialCard {
  return {
    id: "NCT00000001",
    title: "Test trial",
    summary: "Summary",
    phases: ["PHASE2"],
    conditions: ["Breast Cancer"],
    meshTerms: ["Breast Neoplasms"],
    groups: ["breast"],
    sponsor: "Sponsor",
    minAge: 18,
    maxAge: null,
    sex: "ALL",
    inclusion: [{ n: 1, text: "Histologically confirmed breast cancer" }],
    exclusion: [{ n: 1, text: "Pregnant or breastfeeding" }],
    contacts: [],
    barriers: [],
    facts: [],
    siteCount: 1,
    states: ["MA"],
    lastUpdated: "2026-01-01",
    ...over,
  };
}

export const boston: Site = { facility: "Boston site", city: "Boston", state: "Massachusetts", zip: "02115", lat: 42.3389, lon: -71.1055 };
export const la: Site = { facility: "LA site", city: "Los Angeles", state: "California", zip: "90095", lat: 34.0689, lon: -118.4452 };

export function fact(key: Fact["key"], value: Fact["value"], section: "inclusion" | "exclusion" = "inclusion"): Fact {
  return { key, value, quote: `${key} quote`, ref: { section, n: 1 }, source: "rule" };
}

export function makeAnswers(over: Partial<IntakeAnswers> = {}): IntakeAnswers {
  return {
    cancerType: "breast",
    zip: "02115",
    travelMiles: 100,
    age: 52,
    language: "en",
    spread: "not_sure",
    treatments: ["not_sure"],
    biomarkers: {},
    pregnant: "no",
    inAnotherTrial: "no",
    ...over,
  };
}
