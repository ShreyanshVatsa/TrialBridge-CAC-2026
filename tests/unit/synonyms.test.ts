import { describe, expect, it } from "vitest";
import { cancerSynonyms, canonicalDrug, canonicalGene, canonicalVariant, drugClass, expandQueryTerms, geneNames } from "@/lib/ingest/synonyms";

describe("synonym lookups", () => {
  it("maps gene aliases to HGNC symbols", () => {
    expect(canonicalGene("HER2")).toBe("ERBB2");
    expect(canonicalGene("her-2")).toBe("ERBB2");
    expect(canonicalGene("PD-L1")).toBe("CD274");
    expect(canonicalGene("PDL1")).toBe("CD274");
    expect(canonicalGene("ERBB2")).toBe("ERBB2");
    expect(canonicalGene("notagene")).toBeNull();
    expect(geneNames("HER2")).toContain("HER2");
  });
  it("maps drugs to NCIt classes and brand names to generics", () => {
    expect(drugClass("pembrolizumab")).toContain("anti-PD-1");
    expect(drugClass("Keytruda")).toContain("anti-PD-1");
    expect(canonicalDrug("Keytruda")).toBe("pembrolizumab");
    expect(drugClass("trastuzumab")).toContain("anti-HER2");
    expect(drugClass("zzz")).toEqual([]);
  });
  it("returns cancer-type synonyms without the term itself", () => {
    const s = cancerSynonyms("NSCLC");
    expect(s).toContain("non-small cell lung cancer");
    expect(s).not.toContain("nsclc");
    expect(cancerSynonyms("not a cancer")).toEqual([]);
  });
  it("finds CIViC variants", () => {
    expect(canonicalVariant("t790m")).toContainEqual({ gene: "EGFR", name: "T790M" });
  });
  it("expands queries conservatively", () => {
    expect(expandQueryTerms("HER2 positive breast cancer")).toContain("ERBB2");
    expect(expandQueryTerms("keytruda lung")).toContain("pembrolizumab");
    expect(expandQueryTerms("breast cancer stage 2")).toEqual([]);
    expect(expandQueryTerms("HER2 ERBB2").filter((t) => t === "ERBB2")).toEqual([]);
  });
});
