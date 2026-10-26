/**
 * AI provider registry (OpenAI-compatible chat completions). Free tiers only.
 *
 * A provider is used ONLY if its API key env var is set AND `dataTermsVerified` is true.
 * IMPORTANT: before setting `dataTermsVerified: true`, read the provider's current data-use and
 * privacy terms yourself and confirm free-tier inputs are not used for training or human review.
 * Google Gemini's free tier is intentionally excluded (inputs may be used for product improvement).
 *
 * Order = failover priority. Free model lists change often; update `model` as needed.
 */
export interface AiProviderConfig {
  name: string;
  baseUrl: string;
  model: string;
  /** Env var (Worker secret) holding the API key. */
  keyEnv: "LOCAL_LLM_API_KEY" | "GROQ_API_KEY" | "CEREBRAS_API_KEY" | "OPENROUTER_API_KEY";
  /** Env var holding this provider's global daily request budget (kept below its free limit). */
  budgetEnv: "DAILY_BUDGET_LOCAL" | "DAILY_BUDGET_GROQ" | "DAILY_BUDGET_CEREBRAS" | "DAILY_BUDGET_OPENROUTER";
  /** Env var holding this provider's global daily token budget (criterion judge; unset = no token cap). */
  tokenBudgetEnv?: "DAILY_TOKENS_GROQ";
  /** Set to true manually after reading the provider's data terms. */
  dataTermsVerified: boolean;
  /** Approximate max input characters per request (batches are split above this). */
  maxInputChars: number;
  /** Per-request timeout; defaults to 30 s. A local model on a laptop needs much longer for a full batch. */
  timeoutMs?: number;
}

export const AI_PROVIDERS: readonly AiProviderConfig[] = [
  // A llama.cpp `llama-server` on this machine (local development only: set LOCAL_LLM_API_KEY in .dev.vars). Nothing
  // leaves the computer, so no third-party data terms apply. Start it with `npm run llm:local`.
  { name: "local", baseUrl: "http://127.0.0.1:8081/v1", model: "qwen3-14b", keyEnv: "LOCAL_LLM_API_KEY", budgetEnv: "DAILY_BUDGET_LOCAL", dataTermsVerified: true, maxInputChars: 60_000, timeoutMs: 600_000 },
  { name: "groq", baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", keyEnv: "GROQ_API_KEY", budgetEnv: "DAILY_BUDGET_GROQ", tokenBudgetEnv: "DAILY_TOKENS_GROQ", dataTermsVerified: true, maxInputChars: 60_000 },
  { name: "cerebras", baseUrl: "https://api.cerebras.ai/v1", model: "gpt-oss-120b", keyEnv: "CEREBRAS_API_KEY", budgetEnv: "DAILY_BUDGET_CEREBRAS", dataTermsVerified: false, maxInputChars: 60_000 },
  { name: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/free", keyEnv: "OPENROUTER_API_KEY", budgetEnv: "DAILY_BUDGET_OPENROUTER", dataTermsVerified: false, maxInputChars: 40_000 },
];
