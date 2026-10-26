import { describe, expect, it } from "vitest";
import { extentConflict, trialExtent } from "@/lib/match/extent";

const t = (title: string, conditions: string[] = []) => ({ title, conditions });

describe("trialExtent", () => {
  it("reads one extent from the title and conditions", () => {
    expect(trialExtent(t("Pembrolizumab for Metastatic Triple-Negative Breast Cancer"))).toBe("advanced");
    expect(trialExtent(t("Adjuvant Abemaciclib in High-Risk Early Breast Cancer"))).toBe("early");
    expect(trialExtent(t("Study of Drug X", ["Stage II Colon Cancer"]))).toBe("early");
  });
  it("both extents, neither, or the unresectable/inoperable spellings are handled", () => {
    expect(trialExtent(t("Neoadjuvant or Metastatic Setting Study"))).toBeNull();
    expect(trialExtent(t("Exercise During Chemotherapy"))).toBeNull();
    expect(trialExtent(t("Unresectable Hepatocellular Carcinoma"))).toBe("advanced");
    expect(trialExtent(t("Inoperable Locally Advanced Pancreatic Cancer"))).toBe("advanced");
  });
});

describe("extentConflict", () => {
  it("spread far vs early-only trials, not spread or removed vs advanced-only trials", () => {
    expect(extentConflict("distant", t("Adjuvant Therapy After Resection of Stage III Melanoma"))).toBe(1);
    expect(extentConflict("distant", t("Metastatic Melanoma Study"))).toBe(0);
    expect(extentConflict("not_spread", t("Metastatic Melanoma Study"))).toBe(1);
    expect(extentConflict("removed", t("Advanced Solid Tumors"))).toBe(1);
    expect(extentConflict("removed", t("Adjuvant Study After Surgery"))).toBe(0);
  });
  it("unknown, skipped and in-between answers never lower a trial", () => {
    for (const a of ["unknown", "nearby", undefined, "skip"]) expect(extentConflict(a, t("Metastatic Melanoma Study"))).toBe(0);
  });
});
