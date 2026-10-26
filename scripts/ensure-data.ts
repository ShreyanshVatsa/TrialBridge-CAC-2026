/**
 * prebuild: make sure the self-hosted model and the seed dataset exist so `npm run build`
 * always produces a working app. Uses committed data/seed; downloads the model once if missing.
 */
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

const run = (cmd: string) => execSync(cmd, { stdio: "inherit" });

if (!existsSync("public/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx") || !existsSync("public/ort/ort-wasm-simd-threaded.wasm")) {
  console.log("prebuild: fetching embedding model + ONNX Runtime files");
  run("npx tsx scripts/fetch-models.ts");
}
if (!existsSync("public/data/meta.json") || !existsSync("data/build/criteria.sql")) {
  console.log("prebuild: building seed dataset");
  run("npx tsx scripts/ingest/index.ts --source=seed");
}
