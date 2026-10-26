import { describe, expect, it } from "vitest";
import { judge, relevantGold, type GoldLabel } from "@/lib/ingest/gold";

// Synthetic label rows (shape of eval/gold/README.md), not taken from the gold files.
const row = (family: string, value: string, over: Partial<GoldLabel> = {}): GoldLabel => ({ family, value, ...over });

describe("gold scoring rules", () => {
  it("lines: min/max/range/treatment-naive, cohort rows do not count", () => {
    expect(judge("lines", { key: "min_prior_lines", value: "required", param: 2 }, [row("lines_of_therapy", "min_lines", { param: 2 })])).toBe("correct");
    expect(judge("lines", { key: "min_prior_lines", value: "required", param: 1 }, [row("lines_of_therapy", "line_range", { param: "1-3" })])).toBe("correct");
    expect(judge("lines", { key: "max_prior_lines", value: "required", param: 3 }, [row("lines_of_therapy", "line_range", { param: "1-3" })])).toBe("correct");
    expect(judge("lines", { key: "max_prior_lines", value: "required", param: 0 }, [row("lines_of_therapy", "treatment_naive")])).toBe("correct");
    expect(judge("lines", { key: "min_prior_lines", value: "required", param: 2 }, [row("lines_of_therapy", "min_lines", { param: 2, applies_to: "Cohort B" })])).toBe("incorrect");
    expect(judge("lines", { key: "min_prior_lines", value: "required", param: 2 }, [row("lines_of_therapy", "ambiguous")])).toBe("ambiguous");
    expect(judge("lines", { key: "min_prior_lines", value: "required", param: 2 }, [row("lines_of_therapy", "not_stated")])).toBe("incorrect");
    expect(judge("lines", { key: "max_prior_lines", value: "required", param: 2 }, [row("lines_of_therapy", "max_lines", { param: "2" })])).toBe("correct");
    expect(judge("lines", { key: "max_prior_lines", value: "required", param: "x" }, [row("lines_of_therapy", "max_lines", { param: 2 })])).toBe("incorrect");
  });
  it("prior drugs: class, direction, any-history scope, single agent", () => {
    const f = { key: "prior_drug:cdk46", value: "excluded" as const };
    expect(judge("prior_drug", f, [row("prior_drugs", "excluded", { param: "CDK4/6 inhibitor", scope: "any_history" })])).toBe("correct");
    expect(judge("prior_drug", f, [row("prior_drugs", "excluded", { param: "CDK4/6 inhibitor", scope: "within_4_weeks" })])).toBe("incorrect");
    expect(judge("prior_drug", f, [row("prior_drugs", "excluded", { param: "palbociclib", scope: "any_history" })])).toBe("incorrect");
    expect(judge("prior_drug", { key: "prior_drug:checkpoint", value: "required" }, [row("prior_drugs", "required", { param: "anti-PD-1 therapy" })])).toBe("correct");
    expect(judge("prior_drug", { key: "prior_drug:checkpoint", value: "required" }, [row("prior_drugs", "required", { param: "anti-PD-1", scope: "current" })])).toBe("incorrect");
    expect(judge("prior_drug", { key: "prior_drug:nope", value: "required" }, [])).toBe("incorrect");
  });
  it("stage, relapsed, other cancer, hepatitis", () => {
    expect(judge("stage", { key: "locally_advanced", value: "required" }, [row("stage", "required", { param: "locally advanced" })])).toBe("correct");
    expect(judge("stage", { key: "locally_advanced", value: "required" }, [row("stage", "required", { param: "locally advanced or metastatic" })])).toBe("incorrect");
    expect(judge("stage", { key: "adjuvant_setting", value: "required" }, [row("stage", "required", { param: "completely resected, adjuvant" })])).toBe("correct");
    expect(judge("stage", { key: "adjuvant_setting", value: "required" }, [row("stage", "required", { param: "neoadjuvant" })])).toBe("incorrect");
    expect(judge("recurrent", { key: "recurrent", value: "required" }, [row("relapsed_refractory", "required")])).toBe("correct");
    const om = (param?: number | string) => ({ key: "other_malignancy", value: "excluded" as const, ...(param !== undefined ? { param } : {}) });
    expect(judge("other_malignancy", om(), [row("other_cancer", "excluded", { scope: "any_history" })])).toBe("correct");
    expect(judge("other_malignancy", om(3), [row("other_cancer", "excluded", { scope: "within_3_years" })])).toBe("correct");
    expect(judge("other_malignancy", om(5), [row("other_cancer", "excluded", { scope: "within_3_years" })])).toBe("incorrect");
    expect(judge("other_malignancy", om("active_only"), [row("other_cancer", "excluded", { scope: "active_only" })])).toBe("correct");
    expect(judge("hepatitis", { key: "hepatitis_b", value: "excluded", param: "active_only" }, [row("hepatitis", "allowed_if_controlled", { param: "HBV" })])).toBe("correct");
    expect(judge("hepatitis", { key: "hepatitis_c", value: "excluded" }, [row("hepatitis", "excluded", { param: "hepatitis B or C" })])).toBe("correct");
    expect(judge("hepatitis", { key: "hepatitis_c", value: "excluded" }, [row("hepatitis", "excluded", { param: "HBV" })])).toBe("incorrect");
    expect(judge("hepatitis", { key: "hepatitis_b", value: "required" }, [row("hepatitis", "required", { param: "HBV" })])).toBe("correct");
    expect(judge("hepatitis", { key: "hepatitis_b", value: "mentioned" }, [row("hepatitis", "excluded", { param: "HBV" })])).toBe("incorrect");
  });
  it("biomarkers and histology with negated wording and lists", () => {
    expect(judge("biomarker_v2", { key: "biomarker:PH", value: "excluded" }, [row("biomarkers", "required", { param: "Ph-negative" })])).toBe("correct");
    expect(judge("biomarker_v2", { key: "biomarker:RET", value: "required" }, [row("biomarkers", "required", { param: "RET fusion" })])).toBe("correct");
    expect(judge("biomarker_v2", { key: "biomarker:XX", value: "required" }, [])).toBe("incorrect");
    expect(judge("histology", { key: "histology:nsclc", value: "required" }, [row("histology", "required", { param: "NSCLC" })])).toBe("correct");
    expect(judge("histology", { key: "histology:nsclc", value: "required" }, [row("histology", "required", { param: "NSCLC or SCLC" })])).toBe("incorrect");
    expect(judge("histology", { key: "histology:lung_squamous", value: "excluded" }, [row("histology", "required", { param: "non-squamous NSCLC" })])).toBe("correct");
    expect(judge("histology", { key: "histology:zzz", value: "required" }, [])).toBe("incorrect");
    expect(() => judge("autoimmune", { key: "autoimmune", value: "excluded" }, [])).toThrow();
  });
  it("relevance: gold rows our keys can express", () => {
    expect(relevantGold("lines", [row("lines_of_therapy", "min_lines", { param: 1 })])).toBe(true);
    expect(relevantGold("prior_drug", [row("prior_drugs", "excluded", { param: "PARP inhibitor" })])).toBe(true);
    expect(relevantGold("stage", [row("stage", "required", { param: "metastatic" })])).toBe(false);
    expect(relevantGold("biomarker_v2", [row("biomarkers", "required", { param: "MET amplification" })])).toBe(true);
    expect(relevantGold("histology", [row("histology", "required", { param: "glioblastoma" })])).toBe(true);
    expect(relevantGold("recurrent", [row("relapsed_refractory", "required", { applies_to: "Arm A" })])).toBe(false);
  });
});
