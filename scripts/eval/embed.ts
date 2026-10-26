/** Shared embedding helpers for the eval scripts: local model download, cached batch embedding, int8 quantization. */
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pipeline, env } from "@huggingface/transformers";
import { INT8_SCALE } from "../../config/embedding";

export const MODEL_DIR = path.resolve("data/cache/models");
export const MODELS = {
  minilm: { id: "Xenova/all-MiniLM-L6-v2", queryPrefix: "" },
  bge: { id: "Xenova/bge-small-en-v1.5", queryPrefix: "Represent this sentence for searching relevant passages: " },
} as const;
export type ModelKey = keyof typeof MODELS;
export type Dtype = "q8" | "fp32";
async function ensureModel(id: string): Promise<void> {
  const files = ["config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "onnx/model_quantized.onnx", "onnx/model.onnx"];
  const local = path.join("public/models", id);
  for (const f of files) {
    const dest = path.join(MODEL_DIR, id, f);
    if (existsSync(dest)) continue;
    mkdirSync(path.dirname(dest), { recursive: true });
    if (existsSync(path.join(local, f))) {
      cpSync(path.join(local, f), dest);
      continue;
    }
    const res = await fetch(`https://huggingface.co/${id}/resolve/main/${f}`, { signal: AbortSignal.timeout(600_000) });
    if (!res.ok) throw new Error(`download ${id}/${f}: ${res.status}`);
    writeFileSync(dest, new Uint8Array(await res.arrayBuffer()));
    console.log(`  downloaded ${id}/${f}`);
  }
}

export async function embedAll(model: ModelKey, dtype: Dtype, texts: string[]): Promise<Float32Array[]> {
  const cacheFile = path.join("data/cache", `eval-emb-${model}-${dtype}.json`);
  let cache: Record<string, number[]> = {};
  if (existsSync(cacheFile)) cache = JSON.parse(readFileSync(cacheFile, "utf8")) as Record<string, number[]>;
  const todo = [...new Set(texts.filter((t) => !cache[t]))];
  if (todo.length) {
    await ensureModel(MODELS[model].id);
    env.localModelPath = MODEL_DIR + "/";
    env.allowRemoteModels = false;
    const fe = await pipeline("feature-extraction", MODELS[model].id, { dtype });
    for (let i = 0; i < todo.length; i += 32) {
      const batch = todo.slice(i, i + 32);
      const out = await fe(batch, { pooling: model === "bge" ? "cls" : "mean", normalize: true });
      const data = out.data as Float32Array;
      const dims = data.length / batch.length;
      batch.forEach((t, j) => (cache[t] = Array.from(data.subarray(j * dims, (j + 1) * dims))));
    }
    writeFileSync(cacheFile, JSON.stringify(cache));
  }
  return texts.map((t) => Float32Array.from(cache[t] as number[]));
}

export const quantize = (v: Float32Array) => Int8Array.from(v, (x) => Math.max(-127, Math.min(127, Math.round(x * INT8_SCALE))));
