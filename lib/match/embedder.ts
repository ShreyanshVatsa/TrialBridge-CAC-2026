import type { EmbedRequest, EmbedResponse, EmbedTiming } from "./embed.worker";

/** First call downloads the model (~23 MB) + runtime; later calls are fast. */
const EMBED_TIMEOUT_MS = 60_000;

let worker: Worker | null = null;
let nextId = 1;
/** Timing of the last embedding the worker reported (profiling; read by tests and the perf script). */
export let lastEmbedTiming: EmbedTiming | null = null;

function getWorker(): Worker {
  if (!worker) {
    // Exact `new Worker(new URL(...), ...)` form so the bundler compiles the worker as its own entry.
    worker = new Worker(new URL("./embed.worker.ts", import.meta.url), { type: "module" });
  }
  return worker;
}

/**
 * Embed text in the Web Worker. Resolves null (never rejects) on error, timeout, or when
 * workers are unavailable, so callers can fall back to keyword-only ranking.
 */
export function embedProfile(text: string, opts: { signal?: AbortSignal; onProgress?: (fraction: number) => void; timeoutMs?: number } = {}): Promise<Float32Array | null> {
  if (typeof Worker === "undefined") return Promise.resolve(null);
  let w: Worker;
  try {
    w = getWorker();
  } catch {
    return Promise.resolve(null);
  }
  const id = nextId++;
  return new Promise((resolve) => {
    const finish = (v: Float32Array | null) => {
      clearTimeout(timer);
      w.removeEventListener("message", onMessage);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve(v);
    };
    const onMessage = (e: MessageEvent<EmbedResponse>) => {
      const m = e.data;
      if (m.type === "progress") opts.onProgress?.(m.fraction);
      else if (m.id === id) {
        if (m.type === "result") {
          lastEmbedTiming = m.timing;
          if (typeof performance !== "undefined" && typeof performance.mark === "function") performance.mark("tb:embed:result", { detail: m.timing });
        }
        finish(m.type === "result" ? m.vector : null);
      }
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), opts.timeoutMs ?? EMBED_TIMEOUT_MS);
    w.addEventListener("message", onMessage);
    opts.signal?.addEventListener("abort", onAbort);
    w.postMessage({ type: "embed", id, text } satisfies EmbedRequest);
  });
}
