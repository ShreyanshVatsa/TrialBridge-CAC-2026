/** Worker bindings and configuration (wrangler.jsonc vars + secrets). */
export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  ENVIRONMENT?: string;
  DATA_VERSION?: string;
  /** Any value enables the local llama.cpp provider (config/ai-providers.ts); local development only. */
  LOCAL_LLM_API_KEY?: string;
  GROQ_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  RATE_LIMIT_SALT?: string;
  DAILY_BUDGET_LOCAL?: string;
  DAILY_BUDGET_GROQ?: string;
  DAILY_BUDGET_CEREBRAS?: string;
  DAILY_BUDGET_OPENROUTER?: string;
  /** Daily token budget for Groq (criterion judge), below the free tier's 200k tokens/day. */
  DAILY_TOKENS_GROQ?: string;
  /** "1" = the local demo server (`npm run demo`): the page shows the demo start screen. */
  DEMO_MODE?: string;
  /** Comma-separated extra allowed origins for local development (e.g. http://localhost:3000). */
  DEV_ALLOWED_ORIGINS?: string;
}

export const isProduction = (env: Pick<Env, "ENVIRONMENT">): boolean => env.ENVIRONMENT === "production";
