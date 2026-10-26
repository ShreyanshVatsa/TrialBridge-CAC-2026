import { AI_PROVIDERS, type AiProviderConfig } from "@/config/ai-providers";
import type { Env } from "../env";
import { createOpenAiCompatibleProvider } from "./openai-client";
import { mockProvider } from "./mock";
import type { AiProvider } from "./types";

/** Providers that have a key AND verified data terms, in priority order. */
export function enabledProviderConfigs(env: Env, registry: readonly AiProviderConfig[] = AI_PROVIDERS): AiProviderConfig[] {
  return registry.filter((p) => p.dataTermsVerified && Boolean(env[p.keyEnv]));
}

/** Real providers when any are enabled; otherwise the deterministic mock provider. */
export function resolveProviders(env: Env, registry: readonly AiProviderConfig[] = AI_PROVIDERS, fetchImpl: typeof fetch = fetch): AiProvider[] {
  const enabled = enabledProviderConfigs(env, registry);
  if (enabled.length === 0) return [mockProvider];
  return enabled.map((c) => createOpenAiCompatibleProvider(c, env[c.keyEnv] as string, fetchImpl));
}

export function dailyBudget(env: Env, providerName: string, registry: readonly AiProviderConfig[] = AI_PROVIDERS): number {
  const cfg = registry.find((p) => p.name === providerName);
  return cfg ? Number(env[cfg.budgetEnv] ?? 0) : 0;
}

/** Daily token budget (0 = no token cap). */
export function dailyTokenBudget(env: Env, providerName: string, registry: readonly AiProviderConfig[] = AI_PROVIDERS): number {
  const cfg = registry.find((p) => p.name === providerName);
  return cfg?.tokenBudgetEnv ? Number(env[cfg.tokenBudgetEnv] ?? 0) : 0;
}
