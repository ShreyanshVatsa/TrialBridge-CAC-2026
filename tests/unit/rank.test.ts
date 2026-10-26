import { describe, expect, it } from "vitest";
import { rankTrials, type RankEntry } from "@/lib/match/rank";
import { applyAnalysis } from "@/lib/match/apply";
import { buildProfileText } from "@/lib/match/query";
import type { AnalyzeResponse } from "@/lib/types/analysis";
import { boston, fact, la, makeAnswers, makeCard } from "./fixtures";

const origin = { lat: 42.36, lon: -71.06 };
const entry = (id: string, over: Parameters<typeof makeCard>[0] = {}, sites = [boston], vector = [1, 0]): RankEntry => ({
  card: makeCard({ id, ...over }),
  sites,
  vector,
});

describe("rankTrials", () => {
  const entries = [
    entry("NCT00000001", {}, [boston], [1, 0]),
    entry("NCT00000002", {}, [boston], [0, 1]),
    entry("NCT00000003", { maxAge: 40 }, [boston]), // too old -> filtered
    entry("NCT00000004", {}, [la]), // too far -> filtered
    entry("NCT00000005", { groups: ["lung"] }), // wrong group -> filtered
    entry("NCT00000006", { facts: [fact("pregnancy", "excluded")] }, [boston], [0.5, 0.5]),
  ];

  it("applies hard filters with zero violations", () => {
    const out = rankTrials({ entries, answers: makeAnswers(), origin, keywordSearch: () => [], queryVector: [1, 0] });
    expect(out.results.map((r) => r.card.id).sort()).toEqual(["NCT00000001", "NCT00000002", "NCT00000006"]);
    expect(out.candidateCount).toBe(3);
    expect(out.searchedCount).toBe(6);
    for (const r of out.results) expect(r.nearest?.miles ?? Infinity).toBeLessThanOrEqual(100);
  });

  it("fuses keyword and vector rankings", () => {
    const out = rankTrials({ entries, answers: makeAnswers(), origin, keywordSearch: () => ["NCT00000002", "NCT00000001"], queryVector: [1, 0] });
    // 1 is vector #1 & keyword #2; 2 is keyword #1 & vector #3 -> 1 wins.
    expect(out.results[0]?.card.id).toBe("NCT00000001");
    expect(out.results[0]?.scores.keywordRank).toBe(2);
    expect(out.results[0]?.scores.vectorRank).toBe(1);
    expect(out.keywordOnly).toBe(false);
  });

  it("falls back to keyword-only ranking without a query vector", () => {
    const out = rankTrials({ entries, answers: makeAnswers(), origin, keywordSearch: () => ["NCT00000002"], queryVector: null });
    expect(out.keywordOnly).toBe(true);
    expect(out.results[0]?.card.id).toBe("NCT00000002");
    expect(out.results).toHaveLength(3); // unmatched candidates still listed
  });

  it("pre-check conflicts lower the score", () => {
    const out = rankTrials({ entries, answers: makeAnswers({ pregnant: "yes" }), origin, keywordSearch: () => ["NCT00000006", "NCT00000001"], queryVector: null });
    const six = out.results.find((r) => r.card.id === "NCT00000006");
    expect(six?.scores.precheckPenalty).toBeGreaterThan(0);
    expect(out.results[0]?.card.id).toBe("NCT00000001");
  });

  it("skips the distance filter when location is unknown, and respects 'anywhere'", () => {
    expect(rankTrials({ entries, answers: makeAnswers(), origin: null, keywordSearch: () => [], queryVector: null }).candidateCount).toBe(4);
    expect(rankTrials({ entries, answers: makeAnswers({ travelMiles: null }), origin, keywordSearch: () => [], queryVector: null }).candidateCount).toBe(4);
  });

  it("flags a language barrier for non-English speakers and dedupes entries", () => {
    const e = entry("NCT00000007", { barriers: [{ type: "english_required", quote: "Must speak English" }] });
    const out = rankTrials({ entries: [e, e], answers: makeAnswers({ language: "es" }), origin, keywordSearch: () => [], queryVector: null, limit: 5 });
    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.languageWarning).toBe(true);
  });

  it("applyAnalysis re-ranks by AI fit", () => {
    const out = rankTrials({ entries, answers: makeAnswers(), origin, keywordSearch: () => ["NCT00000001", "NCT00000002"], queryVector: null });
    const resp: AnalyzeResponse = {
      status: "ok",
      provider: "mock",
      experimental: false,
      cached: false,
      results: [
        { nctId: "NCT00000001", fitLevel: "unlikely", criteria: [], doctorQuestions: [], summary: "s" },
        { nctId: "NCT00000002", fitLevel: "strong", criteria: [], doctorQuestions: [], summary: "s" },
      ],
    };
    const re = applyAnalysis(out.results, resp);
    expect(re[0]?.card.id).toBe("NCT00000002");
    expect(re[0]?.analysis?.fitLevel).toBe("strong");
    expect(re.find((r) => r.card.id === "NCT00000006")?.analysis).toBeNull();
    expect(out.results[0]?.analysis).toBeNull(); // input not mutated
  });
});

describe("buildProfileText", () => {
  it("builds standardized text without location or age", () => {
    const t = buildProfileText(makeAnswers({ spread: "yes", treatments: ["chemotherapy"], biomarkers: { HER2: "positive", BRCA: "negative" } }));
    expect(t).toContain("Breast cancer");
    expect(t).toContain("Metastatic");
    expect(t).toContain("chemotherapy");
    expect(t).toContain("HER2 positive");
    // a negative result adds nothing to the query (it would match trials that require the marker).
    expect(t).not.toContain("BRCA1/2");
    expect(t).not.toContain("02115");
  });
  it("handles not sure, none, and localized", () => {
    expect(buildProfileText(makeAnswers({ cancerType: "other" }))).toContain("Cancer.");
    expect(buildProfileText(makeAnswers({ treatments: ["none"], spread: "no" }))).toMatch(/untreated.*|Localized/);
  });
});
