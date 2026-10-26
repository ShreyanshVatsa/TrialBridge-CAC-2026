import { ProviderError, type AiProvider, type ProviderErrorKind } from "./types";
import type { CircuitBreaker } from "./circuit";

export type FailoverResult<T> =
  | { ok: true; provider: string; value: T }
  | { ok: false; reason: "budget_exhausted" | "rate_limited" | "ai_unavailable" | "invalid_output"; lastError: ProviderErrorKind | null };

/** Thrown by `reserve()` when the provider's daily budget is used up; never counts as a provider failure. */
export class BudgetExhaustedError extends Error {
  constructor() {
    super("budget_exhausted");
  }
}

/**
 * Reserve one request (and, when given, the estimated tokens) of the provider's daily budget; call it before EVERY
 * provider request (repair retries included).
 */
export type Reserve = (tokens?: number) => Promise<void>;

export interface FailoverDeps {
  breakerFor(name: string): CircuitBreaker;
  /** Reserve one request (plus `tokens`, when the caller estimates them) from the provider's daily budget; false = exhausted. Called once per provider request via `reserve`. */
  consumeBudget(provider: AiProvider, tokens?: number): Promise<boolean>;
  log?: (event: { provider: string; status: string; latencyMs: number }) => void;
}

/**
 * Try providers in priority order. On 429, 5xx, timeout, network, or invalid output, move to the
 * next provider. Open circuits and exhausted budgets are skipped.
 */
export async function runWithFailover<T>(providers: readonly AiProvider[], attempt: (p: AiProvider, reserve: Reserve) => Promise<T>, deps: FailoverDeps): Promise<FailoverResult<T>> {
  let lastError: ProviderErrorKind | null = null;
  let budgetSkips = 0;
  for (const p of providers) {
    const breaker = deps.breakerFor(p.name);
    if (!breaker.canRequest()) continue;
    const reserve: Reserve = async (tokens) => {
      if (!p.isMock && !(await deps.consumeBudget(p, tokens))) throw new BudgetExhaustedError();
    };
    const t0 = Date.now();
    try {
      const value = await attempt(p, reserve);
      breaker.recordSuccess();
      deps.log?.({ provider: p.name, status: "ok", latencyMs: Date.now() - t0 });
      return { ok: true, provider: p.name, value };
    } catch (err) {
      if (err instanceof BudgetExhaustedError) {
        budgetSkips++;
        continue;
      }
      lastError = err instanceof ProviderError ? err.kind : "server";
      // A free-tier rate limit (8000 tokens/minute on Groq) is expected under load, not a broken provider: it
      // does not count toward opening the circuit.
      if (lastError === "rate_limited") breaker.releaseProbe();
      else breaker.recordFailure();
      deps.log?.({ provider: p.name, status: lastError, latencyMs: Date.now() - t0 });
    }
  }
  if (lastError === null && budgetSkips > 0) return { ok: false, reason: "budget_exhausted", lastError };
  return { ok: false, reason: lastError === "invalid_output" ? "invalid_output" : lastError === "rate_limited" ? "rate_limited" : "ai_unavailable", lastError };
}
