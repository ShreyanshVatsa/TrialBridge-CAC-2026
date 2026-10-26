import type { Fact } from "@/lib/types/trial";

/**
 * Local LLM eligibility-fact layer: merging cached LLM facts with the rule layer, and the cache key.
 * The prompt, output parsing and quote checks live in scripts/ingest/llm.ts.
 */
const LLM_PROMPT_VERSION = "facts-v1";

/**
 * Merge rule and LLM layers. Same key + same value: keep the rule fact (adds LLM confidence).
 * Different values: keep BOTH, each marked needsReview (the pre-check ignores needsReview facts).
 * LLM-only keys are added. "mentioned" LLM facts never override anything.
 */
export function mergeFacts(rule: readonly Fact[], llm: readonly Fact[]): Fact[] {
  const out: Fact[] = rule.map((f) => ({ ...f }));
  for (const l of llm) {
    const r = out.find((f) => f.key === l.key && f.source === "rule");
    if (!r) {
      out.push(l);
      continue;
    }
    if (r.value === l.value) {
      if (l.confidence !== undefined) r.confidence = l.confidence;
    } else if (l.value !== "mentioned" && r.value !== "mentioned") {
      r.needsReview = true;
      out.push({ ...l, needsReview: true });
    } else if (r.value === "mentioned") {
      out[out.indexOf(r)] = l; // LLM gives a direction where the rule layer could not
    }
  }
  return out;
}

export const llmCacheKey = (id: string, lastUpdated: string) => `${id}|${lastUpdated}|${LLM_PROMPT_VERSION}`;
