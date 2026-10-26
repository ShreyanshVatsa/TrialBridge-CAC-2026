import type { AiProviderConfig } from "@/config/ai-providers";
import { ProviderError, type AiProvider, type CompletionRequest } from "./types";

const TIMEOUT_MS = 30_000;
/**
 * Longest `retry-after` worth waiting for on a 429 before failing over. Groq's free tier caps tokens per minute
 * (8000) and one judged patient costs about 7k, so a second patient within the same minute gets a 429 that clears in
 * under a minute (measured live); the caller's deadline signal still ends the wait. A daily-cap 429 asks for minutes
 * or hours and fails over at once.
 */
const MAX_RETRY_AFTER_MS = 40_000;
/** Rate-limit retries per request when the caller passes a deadline signal. */
const MAX_RATE_RETRIES = 6;

/** `retry-after` in ms (seconds or an HTTP date); null when absent or unreadable. */
function retryAfterMs(headers: Headers, now = Date.now()): number | null {
  const v = headers.get("retry-after");
  if (!v) return null;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** Wait `ms`, or less if `signal` aborts first. Returns false when aborted. */
function wait(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve(false);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** One OpenAI-compatible chat-completions client used for every real provider. */
export function createOpenAiCompatibleProvider(config: AiProviderConfig, apiKey: string, fetchImpl: typeof fetch = fetch): AiProvider {
  const body = (req: CompletionRequest) =>
    JSON.stringify({
      model: config.model,
      messages: req.messages,
      temperature: 0.1,
      max_tokens: req.maxTokens ?? 6000,
      response_format: { type: "json_object" },
      ...(req.reasoningEffort ? { reasoning_effort: req.reasoningEffort } : {}),
    });
  return {
    name: config.name,
    isMock: false,
    maxInputChars: config.maxInputChars,
    async complete(req: CompletionRequest): Promise<string> {
      for (let attempt = 0; ; attempt++) {
        const timeout = AbortSignal.timeout(config.timeoutMs ?? TIMEOUT_MS);
        const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
        let res: Response;
        try {
          res = await fetchImpl(`${config.baseUrl}/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: body(req),
            signal,
          });
        } catch {
          throw new ProviderError(timeout.aborted ? "timeout" : "network", `${config.name}: request failed`);
        }
        if (res.status === 429) {
          // Wait and retry a short (per-minute) limit while the caller's deadline allows: the token bucket refills
          // gradually, so a large request can need several waits (measured live). Without a deadline, retry once.
          const ms = retryAfterMs(res.headers);
          const again = req.signal ? attempt < MAX_RATE_RETRIES : attempt === 0;
          if (again && ms !== null && ms <= MAX_RETRY_AFTER_MS && (await wait(Math.max(ms, 1000), req.signal))) continue;
          throw new ProviderError("rate_limited", `${config.name}: 429`);
        }
        if (res.status >= 500) throw new ProviderError("server", `${config.name}: ${res.status}`);
        if (!res.ok) throw new ProviderError("client", `${config.name}: ${res.status}`);
        let data: { choices?: { message?: { content?: string } }[] };
        try {
          data = (await res.json()) as typeof data;
        } catch {
          throw new ProviderError("invalid_output", `${config.name}: non-JSON response`);
        }
        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new ProviderError("invalid_output", `${config.name}: empty completion`);
        return content;
      }
    },
  };
}
