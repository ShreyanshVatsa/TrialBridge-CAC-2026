/**
 * LLM criterion judge settings. The judge runs on the top N trials after retrieval and sees only
 * the criterion items the deterministic resolver left "unknown".
 */
export const MATCH_JUDGE = {
  /**
   * Trials judged per request: the top N of the `TOP_N` (20) resolver-ranked results (lib/match/rank.ts). Five, not ten: one patient cost about 20k tokens at 10
   * (eval/matching/RESULTS.md), against Groq's free tier of 8000 tokens/minute and 200k/day.
   */
  topN: 5,
  /** Unknown criterion items accepted per trial (a long trial is chunked across requests, never truncated silently). */
  maxItemsPerTrial: 120,
  /** Plain-language reason length cap, in words. */
  reasonMaxWords: 25,
  /** Characters of the trial summary shown to the model for context (TrialGPT also shows the summary). */
  summaryChars: 300,
  /** Whole-request budget for the model calls of one /api/match request (the browser gives up at 60 s; the Worker must stop first). */
  deadlineMs: 45_000,
  /** Re-asks of one batch after malformed / empty output before failing over (each re-ask reserves budget). */
  invalidOutputRetries: 1,
  /**
   * Request settings proven on the TREC dev eval (gpt-oss-120b on Groq): batches of at most 16000 chars (also caps a
   * provider whose maxInputChars is larger), 3500 completion tokens, low reasoning effort. With the model-default
   * (medium) reasoning a 16k batch spent 3077 of 3500 tokens on reasoning and the JSON was truncated; 60k batches also
   * exceed Groq's free-tier 8000 tokens/minute per request.
   */
  maxBatchChars: 16_000,
  maxTokens: 3500,
  reasoningEffort: "low",
} as const;
