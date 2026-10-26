/// <reference lib="webworker" />
/**
 * Web Worker: embeds the standardized profile text with Transformers.js, off the main thread.
 * Model and ONNX Runtime files are self-hosted (/models, /ort); no remote downloads.
 */
import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { EMBEDDING_DTYPE, EMBEDDING_MODEL } from "@/config/embedding";

export type EmbedRequest = { type: "embed"; id: number; text: string };
export type EmbedResponse =
  | { type: "result"; id: number; vector: Float32Array; timing: EmbedTiming }
  | { type: "error"; id: number; message: string }
  | { type: "progress"; fraction: number };

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "/models/";
env.useWasmCache = false; // avoids blob: script URLs, so CSP can stay script-src 'self'
env.useBrowserCache = true; // Cache Storage for model files (not AI responses or user data)
const onnx = env.backends.onnx;
if (onnx.wasm) {
  // Plain SIMD build (not asyncify/jsep): smaller, under Cloudflare's 25 MiB per-asset limit.
  onnx.wasm.wasmPaths = { mjs: "/ort/ort-wasm-simd-threaded.mjs", wasm: "/ort/ort-wasm-simd-threaded.wasm" };
  onnx.wasm.numThreads = 1; // no cross-origin isolation, so no SharedArrayBuffer threads
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let extractor: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  extractor ??= pipeline("feature-extraction", EMBEDDING_MODEL, {
    dtype: EMBEDDING_DTYPE,
    device: "wasm",
    progress_callback: (p: { status: string; progress?: number }) => {
      if (p.status === "progress" && typeof p.progress === "number") ctx.postMessage({ type: "progress", fraction: p.progress / 100 } satisfies EmbedResponse);
    },
  }) as Promise<FeatureExtractionPipeline>;
  extractor.catch(() => {
    extractor = null; // allow a later retry
  });
  return extractor;
}

/** Milliseconds spent loading the model (0 once warm) and running the embedding, reported with every result. */
export interface EmbedTiming {
  loadMs: number;
  embedMs: number;
}

ctx.onmessage = async (event: MessageEvent<EmbedRequest>) => {
  const msg = event.data;
  if (msg.type !== "embed") return;
  try {
    const t0 = performance.now();
    const fe = await getExtractor();
    const t1 = performance.now();
    const out = await fe(msg.text, { pooling: "mean", normalize: true });
    const vector = Float32Array.from(out.data as Float32Array);
    const timing: EmbedTiming = { loadMs: Math.round(t1 - t0), embedMs: Math.round(performance.now() - t1) };
    ctx.postMessage({ type: "result", id: msg.id, vector, timing } satisfies EmbedResponse, [vector.buffer]);
  } catch (err) {
    ctx.postMessage({ type: "error", id: msg.id, message: err instanceof Error ? err.message : "embedding failed" } satisfies EmbedResponse);
  }
};
