import type { Env } from "./env";
import { isProduction } from "./env";

/** Cloudflare's documented always-pass TEST secret (development and tests only). */
export const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verify a Turnstile token server-side. Fails closed: missing production secret, network errors,
 * or invalid tokens all return false.
 */
export async function verifyTurnstile(token: string, ip: string | null, env: Pick<Env, "TURNSTILE_SECRET_KEY" | "ENVIRONMENT">, fetchImpl: typeof fetch = fetch, expectedHostname?: string): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET_KEY || (isProduction(env) ? "" : TURNSTILE_TEST_SECRET);
  if (!secret || !token) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const res = await fetchImpl(SITEVERIFY, { method: "POST", body: form, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean; hostname?: string };
    if (data.success !== true) return false;
    // Production: the token must have been issued for this site (blocks tokens minted on another
    // site's widget). Cloudflare marks tokens single-use, so replays already fail above.
    if (isProduction(env) && expectedHostname && data.hostname && data.hostname !== expectedHostname) return false;
    return true;
  } catch {
    return false;
  }
}
