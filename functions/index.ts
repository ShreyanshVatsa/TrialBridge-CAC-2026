/**
 * Cloudflare Worker entry. Serves /api/* (AI endpoints); everything else is the static export
 * served by Workers static assets (with headers from public/_headers).
 * Logs contain only request IDs, provider names, statuses, and latency; never profiles or text.
 */
import type { Env } from "./lib/env";
import { isProduction } from "./lib/env";
import { apiError, json } from "./lib/http";
import { D1KvStore } from "./lib/store";
import { D1TrialStore } from "./lib/trials";
import { handleAnalyze, type AnalyzeDeps } from "./lib/analyze";
import { handleAsk } from "./lib/ask";
import { handleMatch } from "./lib/match";
import { breakerFor } from "./lib/ai/circuit";
import { resolveProviders } from "./lib/ai/providers";
import { verifyTurnstile } from "./lib/turnstile";

/** Fallback salt when RATE_LIMIT_SALT is unset: fixed in dev, random per isolate in production. */
let isolateSalt: string | null = null;
const getIsolateSalt = () => (isolateSalt ??= crypto.randomUUID()); // random values are not allowed at global scope

export const isLoopbackHost = (h: string): boolean => h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".localhost");

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    // Fail closed: development behavior (test Turnstile secret, extra allowed origins, dev salt)
    // applies only on loopback hosts, even if ENVIRONMENT was left at its "development" default.
    if (!isLoopbackHost(url.hostname)) env = { ...env, ENVIRONMENT: "production" };

    const requestId = crypto.randomUUID();
    const log = (e: Record<string, string | number>) => console.log(JSON.stringify(e));
    const t0 = Date.now();
    try {
      let res: Response;
      if (url.pathname === "/api/analyze" || url.pathname === "/api/ask" || url.pathname === "/api/match") {
        const store = new D1KvStore(env.DB);
        const deps: AnalyzeDeps = {
          env,
          store,
          trials: new D1TrialStore(env.DB),
          providers: resolveProviders(env),
          breakerFor,
          verifyTurnstile: (token, ip) => verifyTurnstile(token, ip, env, fetch, url.hostname),
          salt: env.RATE_LIMIT_SALT || (isProduction(env) ? getIsolateSalt() : "trialbridge-dev-salt"),
          requestId,
          log,
        };
        res = url.pathname === "/api/analyze" ? await handleAnalyze(request, deps) : url.pathname === "/api/match" ? await handleMatch(request, deps) : await handleAsk(request, deps);
        if (Math.random() < 0.02) ctx.waitUntil(store.purgeExpired());
      } else if (url.pathname === "/api/health") {
        res = json({ ok: true, dataVersion: env.DATA_VERSION ?? null, ai: resolveProviders(env).every((p) => p.name === "mock") ? "mock" : "live", demo: env.DEMO_MODE === "1" }, 200, requestId);
      } else {
        res = apiError("not_found", requestId);
      }
      log({ requestId, route: url.pathname, status: res.status, latencyMs: Date.now() - t0 });
      return res;
    } catch {
      log({ requestId, route: url.pathname, status: 500, latencyMs: Date.now() - t0 });
      return apiError("internal", requestId);
    }
  },
} satisfies ExportedHandler<Env>;
