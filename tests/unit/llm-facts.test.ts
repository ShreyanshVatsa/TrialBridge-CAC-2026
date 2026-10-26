import { describe, expect, it } from "vitest";
import { llmCacheKey, mergeFacts } from "@/lib/ingest/llm-facts";
import { precheck } from "@/lib/match/precheck";
import { fact, makeAnswers } from "./fixtures";

describe("LLM fact layer", () => {
  it("merges layers: agreement, disagreement (needs review), LLM-only, and direction for 'mentioned'", () => {
    const llm = (k: Parameters<typeof fact>[0], v: Parameters<typeof fact>[1]) => ({ ...fact(k, v), source: "llm" as const, confidence: 0.8 });
    const merged = mergeFacts(
      [fact("metastatic", "required"), fact("pregnancy", "excluded"), fact("prior_chemotherapy", "mentioned")],
      [llm("metastatic", "required"), llm("pregnancy", "required"), llm("concurrent_trial", "excluded"), llm("prior_chemotherapy", "excluded")],
    );
    expect(merged.find((f) => f.key === "metastatic")?.confidence).toBe(0.8);
    expect(merged.filter((f) => f.key === "pregnancy").every((f) => f.needsReview)).toBe(true);
    expect(merged.filter((f) => f.key === "pregnancy")).toHaveLength(2);
    expect(merged.find((f) => f.key === "concurrent_trial")?.source).toBe("llm");
    expect(merged.find((f) => f.key === "prior_chemotherapy")?.value).toBe("excluded");
    // needs-review facts never penalize in the pre-check
    expect(precheck(makeAnswers({ pregnant: "yes" }), merged.filter((f) => f.key === "pregnancy"))).toEqual([]);
  });
  it("builds stable cache keys", () => {
    expect(llmCacheKey("NCT1", "2026-01-01")).toBe("NCT1|2026-01-01|facts-v1");
  });
});
