/**
 * Cloudflare Turnstile helper (bot protection for AI endpoints).
 * Default site key is Cloudflare's documented always-pass TEST key; set
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY for production.
 */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "1x00000000000000000000AA";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TOKEN_TIMEOUT_MS = 30_000;

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  remove(widgetId: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else {
        scriptPromise = null;
        reject(new Error("Turnstile unavailable"));
      }
    };
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Turnstile failed to load"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/**
 * Render an interaction-only Turnstile widget in `container` and resolve with a single-use token.
 * Rejects on load failure, challenge error, or timeout (callers should then show degraded results).
 */
export async function getTurnstileToken(container: HTMLElement): Promise<string> {
  const ts = await loadScript();
  return new Promise<string>((resolve, reject) => {
    let widgetId = "";
    const done = (fn: () => void) => {
      clearTimeout(timer);
      try {
        if (widgetId) ts.remove(widgetId);
      } catch {
        /* widget already gone */
      }
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new Error("Turnstile timed out"))), TOKEN_TIMEOUT_MS);
    widgetId = ts.render(container, {
      sitekey: TURNSTILE_SITE_KEY,
      appearance: "interaction-only",
      callback: (token: string) => done(() => resolve(token)),
      "error-callback": () => done(() => reject(new Error("Turnstile challenge failed"))),
    });
  });
}
