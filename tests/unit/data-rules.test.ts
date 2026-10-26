import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectBarriers } from "@/lib/ingest/barriers";
import { mapGroups } from "@/lib/ingest/groups";
import { parseEligibility } from "@/lib/ingest/parse";
import { RawStudySchema, type RawStudy } from "@/lib/ingest/raw";
import { buildRecord, NOT_CANCER } from "@/lib/ingest/record";
import { BASKET_SHARD_ID, basketAppliesTo, isBasketOnly } from "@/config/cancer-groups";

const barriers = (text: string, extra: { minAge?: number | null; maxAge?: number | null } = {}) => {
  const r = parseEligibility(text);
  return detectBarriers({ ...r, maxAge: extra.maxAge ?? null, ...(extra.minAge !== undefined ? { minAge: extra.minAge } : {}) }).map((b) => b.type);
};

describe("english_required false positives (M2)", () => {
  it("does not flag sentences that list several languages or state an exception", () => {
    expect(barriers("Inclusion Criteria:\n* Participants must speak English, Spanish, Chinese, or Vietnamese.")).toEqual([]);
    expect(barriers("Exclusion Criteria:\n* Patients unable to read and write in English, Spanish, French, German, Russian or Mandarin may be registered without a translator.")).toEqual([]);
    expect(barriers("Inclusion Criteria:\n* Able to read English or Spanish")).toEqual([]);
  });
  it("still flags English-only wording", () => {
    expect(barriers("Inclusion Criteria:\n* Must be able to read and speak English")).toEqual(["english_required"]);
    expect(barriers("Exclusion Criteria:\n* Unable to speak and read English.")).toEqual(["english_required"]);
  });
});

describe("upper age limit (M3)", () => {
  it("skips pediatric/AYA trials but keeps adult trials", () => {
    expect(barriers("Inclusion Criteria:\n* x", { minAge: 0, maxAge: 17 })).toEqual([]);
    expect(barriers("Inclusion Criteria:\n* x", { minAge: null, maxAge: 21 })).toEqual([]);
    expect(barriers("Inclusion Criteria:\n* x", { minAge: 18, maxAge: 65 })).toEqual(["upper_age_limit"]);
    expect(barriers("Inclusion Criteria:\n* x", { maxAge: 65 })).toEqual(["upper_age_limit"]); // minAge not provided: legacy behavior
  });
});

describe("disability_exclusion false positives (M9)", () => {
  it("ignores 'disability' as an outcome and generic uncontrolled wording, keeps real exclusions", () => {
    expect(barriers("Exclusion Criteria:\n* Prior hypersensitivity to chemotherapy that resulted in persistent or significant disability")).toEqual([]);
    expect(barriers("Exclusion Criteria:\n* Participants with a physical disability")).toEqual(["disability_exclusion"]);
    expect(barriers("Exclusion Criteria:\n* Wheelchair users")).toEqual(["disability_exclusion"]);
    expect(barriers("Exclusion Criteria:\n* Psychiatric illness that would limit compliance with study requirements")).toEqual(["disability_exclusion"]);
    expect(barriers("Exclusion Criteria:\n* Psychiatric illness with an increased risk of harm from study drug")).toEqual([]);
  });
});

describe("grouping (M5, H3)", () => {
  it("falls back to titles and recognizes HNSCC", () => {
    expect(mapGroups(["Carcinoma, Squamous Cell"], ["Squamous Cell Carcinoma"], "Radiotherapy With Cisplatin in HNSCC")).toEqual(["head-neck"]);
    expect(mapGroups([], ["Squamous Cell Carcinoma"], "Study", "Official title of oropharyngeal cancer trial")).toEqual(["head-neck"]);
    expect(mapGroups([], ["Something"], "Nothing relevant")).toEqual(["other"]);
  });
  it("identifies basket-only trials", () => {
    expect(isBasketOnly(["solid-tumors"])).toBe(true);
    expect(isBasketOnly(["lung", "solid-tumors"])).toBe(false);
    expect(isBasketOnly(["other"])).toBe(false);
    expect(basketAppliesTo("lung")).toBe(true);
    expect(basketAppliesTo("leukemia")).toBe(false);
    expect(basketAppliesTo("other")).toBe(false);
    expect(BASKET_SHARD_ID).toBe("solid-basket");
  });
});

describe("non-cancer scope (M5)", () => {
  const seed = JSON.parse(readFileSync("data/seed/studies.json", "utf8")) as { studies: unknown[] };
  const base = RawStudySchema.parse(seed.studies[0]);
  const withIds = (title: string, conditions: string[], mesh: string[]): RawStudy => {
    const s = structuredClone(base);
    s.protocolSection.identificationModule.briefTitle = title;
    delete s.protocolSection.identificationModule.officialTitle;
    s.protocolSection.conditionsModule = { conditions };
    (s as unknown as { derivedSection: unknown }).derivedSection = { conditionBrowseModule: { meshes: mesh.map((term) => ({ term })), ancestors: [] } };
    return s;
  };
  it("drops benign neoplasm and non-cancer records that fit no cancer group", () => {
    for (const [t, c, m] of [
      ["Simple Bone Cysts in Kids", ["Bone Cyst"], ["Bone Cysts", "Neoplasms"]],
      ["Pulsed-dye Laser for Hemangioma in Newborn", ["Hemangioma"], ["Hemangioma", "Neoplasms, Vascular Tissue", "Neoplasms"]],
    ] as const) {
      const r = buildRecord(withIds(t, [...c], [...m]));
      expect(r).toMatchObject({ ok: false, reason: NOT_CANCER });
    }
  });
});

import { aggregateAccess, canonicalSite } from "@/lib/access/aggregate";
import type { Site } from "@/lib/types/trial";
import { makeCard } from "./fixtures";

describe("site merging (M4)", () => {
  const site = (facility: string, city: string, state = "TX"): Site => ({ facility, city, state, zip: "77030", status: "Recruiting" }) as Site;
  it("merges name variants of major centers within a city and drops generic names", () => {
    const keys = ["MD Anderson Cancer Center", "M D Anderson Cancer Center", "The University of Texas MD Anderson Cancer Center", "UT MD Anderson Cancer Center", "The University of Texas M. D. Anderson Cancer Center"].map((f) => canonicalSite(site(f, "Houston"))?.key);
    expect(new Set(keys).size).toBe(1);
    const msk = ["Memorial Sloan Kettering Cancer Center", "Memorial Sloan Kettering Cancer Center (All Protocol Activities)", "Memorial Sloan-Kettering Cancer Center"].map((f) => canonicalSite(site(f, "New York", "New York"))?.key);
    expect(new Set(msk).size).toBe(1);
    expect(canonicalSite(site("Memorial Sloan Kettering Bergen (Limited Protocol Activities)", "Montvale", "New Jersey"))?.key).not.toBe(msk[0]);
    expect(canonicalSite(site("Banner MD Anderson Cancer Center", "Gilbert", "Arizona"))?.facility).toBe("Banner MD Anderson Cancer Center");
    expect(canonicalSite(site("Research Site", "Houston"))).toBeNull();
    expect(canonicalSite(site("GSK Investigational Site", "Houston"))).toBeNull();
    expect(canonicalSite(site("Some Hospital (Site 0012)", "Austin"))?.key).toBe(canonicalSite(site("Some Hospital", "Austin"))?.key);
  });
  it("counts a merged institution once per trial and omits generic sites", () => {
    const cards = Array.from({ length: 5 }, (_, i) => makeCard({ id: `NCT0000000${i + 1}` }));
    const sites = new Map(cards.map((c, i) => [c.id, [site(i % 2 ? "MD Anderson Cancer Center" : "M D Anderson Cancer Center", "Houston"), site("Research Site", "Houston")]]));
    const data = aggregateAccess(cards, sites, "d", "v");
    expect(data.sites).toHaveLength(1);
    expect(data.sites[0]).toMatchObject({ facility: "MD Anderson Cancer Center", city: "Houston" });
    expect(data.sites[0]?.counts[0]).toBe(5);
  });
});

import { factsForCriterion, segments } from "@/lib/ingest/facts";
describe("rule facts: brain-only, allowed wording and numbered lists (H2)", () => {
  const v = (s: "inclusion" | "exclusion", t: string, k: string) => factsForCriterion(s, t).find((f) => f.key === k)?.value;
  it("does not require metastatic disease for CNS-only or 'allowed' wording", () => {
    expect(v("inclusion", "Patients with treated brain metastases are eligible if stable", "metastatic")).toBe("mentioned");
    expect(v("inclusion", "Patients can receive radiation therapy for symptomatic metastatic disease prior to enrollment", "metastatic")).toBe("mentioned");
    expect(v("inclusion", "Metastatic disease as evidenced by bone scan", "metastatic")).toBe("required");
  });
  it("splits numbered sub-items so one line cannot color another", () => {
    expect(segments("6.1. Hemoglobin >= 9 g/dL 6.2. Patients with metastatic disease").some((x) => /Hemoglobin/.test(x) && /metastatic/.test(x))).toBe(false);
    expect(segments("Use e.g. this. Next sentence")).toEqual(["Use e.g. this.", "Next sentence"]);
    expect(v("inclusion", "6.1. Hemoglobin >= 9 g/dL 6.2. WBC >= 2500 6.3. Prior chemotherapy for metastatic disease", "metastatic")).toBe("required");
  });
});
