/**
 * Self-host the embedding model and ONNX Runtime WASM files (no third-party CDN at runtime).
 * - Downloads the quantized MiniLM model at the PINNED revision (config/embedding.ts) from Hugging Face into
 *   public/models/<model>/ and verifies every file's sha256 against the pinned value (used by both ingestion in
 *   Node and the browser Web Worker). A file whose hash differs is deleted and the run fails.
 * - Copies the ONNX Runtime WASM build from node_modules into public/ort/.
 * Idempotent: existing, verified files are skipped. Run: `npm run models:fetch`.
 */
import { mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { EMBEDDING_MODEL, EMBEDDING_MODEL_FILES, EMBEDDING_MODEL_REVISION } from "../config/embedding";
import { sha256Hex, verifyModelFiles } from "../lib/ingest/snapshot";

const ORT_FILES = ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"];

async function main(): Promise<void> {
  const dir = path.join("public/models", EMBEDDING_MODEL);
  const missing = new Set(verifyModelFiles(dir, EMBEDDING_MODEL_FILES).map((p) => p.split(":")[0] as string));
  for (const [f, sha] of Object.entries(EMBEDDING_MODEL_FILES)) {
    if (!missing.has(f)) continue;
    const dest = path.join(dir, f);
    const url = `https://huggingface.co/${EMBEDDING_MODEL}/resolve/${EMBEDDING_MODEL_REVISION}/${f}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok) throw new Error(`Model download failed (${res.status}): ${url}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const got = sha256Hex(bytes);
    if (got !== sha) {
      await rm(dest, { force: true });
      throw new Error(`Model file ${f} sha256 ${got} does not match the pinned ${sha} (revision ${EMBEDDING_MODEL_REVISION})`);
    }
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
    console.log(`Downloaded and verified ${f}`);
  }
  const left = verifyModelFiles(dir, EMBEDDING_MODEL_FILES);
  if (left.length) throw new Error(`Model files failed verification: ${left.join(", ")}`);
  await mkdir("public/ort", { recursive: true });
  for (const f of ORT_FILES) await copyFile(path.join("node_modules/onnxruntime-web/dist", f), path.join("public/ort", f));
  console.log(`Model ready in ${dir} (revision ${EMBEDDING_MODEL_REVISION.slice(0, 12)}, ${Object.keys(EMBEDDING_MODEL_FILES).length} files verified); ONNX Runtime WASM in public/ort`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
