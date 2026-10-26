import type { ApiErrorCode } from "@/lib/types/analysis";
import type { Env } from "./env";
import { isProduction } from "./env";

/** Max accepted JSON body size for AI endpoints. */
const MAX_BODY_BYTES = 16 * 1024;

const API_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export function json(body: unknown, status = 200, requestId?: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...API_HEADERS, ...(requestId ? { "X-Request-Id": requestId } : {}), ...extra } });
}

const SAFE_MESSAGES: Record<ApiErrorCode, string> = {
  bad_request: "The request was not valid.",
  payload_too_large: "The request was too large.",
  forbidden_origin: "This request is not allowed from this site.",
  turnstile_failed: "We couldn't verify the request. Please try again.",
  rate_limited: "Too many requests. Please try again later.",
  not_found: "Not found.",
  method_not_allowed: "Method not allowed.",
  internal: "Something went wrong. Please try again.",
};
const STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  payload_too_large: 413,
  forbidden_origin: 403,
  turnstile_failed: 403,
  rate_limited: 429,
  not_found: 404,
  method_not_allowed: 405,
  internal: 500,
};

/** Typed, consistent error envelope with a safe message (never internals or stack traces). */
export function apiError(code: ApiErrorCode, requestId: string, extra: Record<string, string> = {}): Response {
  return json({ error: { code, message: SAFE_MESSAGES[code], requestId } }, STATUS[code], requestId, extra);
}

/**
 * AI endpoints accept only same-origin browser requests. The Origin header must match the
 * request's own origin (or a configured dev origin outside production).
 */
export function isSameOrigin(request: Request, env: Pick<Env, "ENVIRONMENT" | "DEV_ALLOWED_ORIGINS">): boolean {
  const self = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  const site = request.headers.get("Sec-Fetch-Site");
  // Browsers set Sec-Fetch-Site and page script cannot forge it: in production a cross-site or
  // same-site signal wins over a matching Origin (defense in depth).
  if (isProduction(env) && site && site !== "same-origin") return false;
  if (origin) {
    if (origin === self) return true;
    if (!isProduction(env)) {
      const allowed = (env.DEV_ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000").split(",").map((s) => s.trim());
      return allowed.includes(origin);
    }
    return false;
  }
  // No Origin: accept only an explicit same-origin fetch-metadata signal.
  return site === "same-origin";
}

/** Read a JSON body with a hard size limit. Returns null on oversize, undefined on bad JSON. */
export async function readJsonBody(request: Request): Promise<unknown | null | undefined> {
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_BODY_BYTES) return null;
  // Only real JSON requests: "simple" cross-site content types (text/plain, form posts) are refused.
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get("Content-Type") ?? "")) return undefined;
  // Read through a limited stream reader so a chunked body without Content-Length is never fully buffered.
  let text: string;
  if (request.body) {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
    const all = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      all.set(c, off);
      off += c.byteLength;
    }
    text = new TextDecoder().decode(all);
  } else {
    text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Dev CORS for the Next dev server talking to `wrangler dev` on another port. */
export function devCorsHeaders(request: Request, env: Pick<Env, "ENVIRONMENT" | "DEV_ALLOWED_ORIGINS">): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!origin || isProduction(env) || origin === new URL(request.url).origin || !isSameOrigin(request, env)) return {};
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" };
}
