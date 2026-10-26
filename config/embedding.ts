/** Embedding model shared by ingestion and the browser. Changing it requires re-running ingestion. */
export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMS = 384;
/** Model weights precision used in Node and the browser (8-bit quantized ONNX). */
export const EMBEDDING_DTYPE = "q8" as const;
/** Stored vectors are L2-normalized then scaled to int8: q = round(v * INT8_SCALE). */
export const INT8_SCALE = 127;
/**
 * Pinned Hugging Face revision (commit) and sha256 of every self-hosted model file. `npm run models:fetch` downloads
 * exactly this revision and refuses files whose hash differs; `npm run data:verify` re-checks the local copies.
 */
export const EMBEDDING_MODEL_REVISION = "751bff37182d3f1213fa05d7196b954e230abad9";
export const EMBEDDING_MODEL_FILES: Readonly<Record<string, string>> = {
  "config.json": "7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7",
  "tokenizer.json": "da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0",
  "tokenizer_config.json": "9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3",
  "special_tokens_map.json": "b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3",
  "onnx/model_quantized.onnx": "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1",
};
/** Pipeline/prompt versions recorded in meta.json and used in cache keys. */
export const PIPELINE_VERSION = "1.1.0";
export const PROMPT_VERSION = "analyze-v2";
/** On-disk layout of /data (manifest, shards, buckets). Part of the data-version hash; bump on any layout change. */
export const DATA_FORMAT_VERSION = 1;
