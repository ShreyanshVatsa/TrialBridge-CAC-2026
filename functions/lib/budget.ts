import type { KvStore } from "./store";
import { utcDay } from "./crypto";

/**
 * Global daily request budget per provider, kept below each free tier's limit.
 * `tryConsume` reserves one request; when the budget is exhausted the provider is skipped.
 */
export async function tryConsumeBudget(store: KvStore, provider: string, dailyLimit: number, now: Date = new Date()): Promise<boolean> {
  if (!Number.isFinite(dailyLimit) || dailyLimit <= 0) return false;
  const used = await store.incr(`budget:${provider}:${utcDay(now)}`, 2 * 86_400);
  return used <= dailyLimit;
}

/**
 * Global daily token budget per provider. Groq's free tier caps tokens per day (200k for gpt-oss-120b), not
 * requests, and one judged patient costs thousands of tokens, so the request count alone cannot keep below it.
 * `tokens` is the caller's estimate for one request (prompt + completion cap). An unset or non-positive limit means
 * no token cap (the request budget still applies).
 */
export async function tryConsumeTokens(store: KvStore, provider: string, tokens: number, dailyTokenLimit: number, now: Date = new Date()): Promise<boolean> {
  if (!Number.isFinite(dailyTokenLimit) || dailyTokenLimit <= 0 || tokens <= 0) return true;
  const used = await store.incr(`tokens:${provider}:${utcDay(now)}`, 2 * 86_400, tokens);
  return used <= dailyTokenLimit;
}

/** Rough token count of chat text (gpt-oss tokenizer averages about 3.5 characters per token on criteria text). */
export const estimateTokens = (chars: number) => Math.ceil(chars / 3.5);
