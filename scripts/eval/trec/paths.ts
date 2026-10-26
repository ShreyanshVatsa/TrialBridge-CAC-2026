/** Shared locations for the TREC CT benchmark (all relative to the repo root). */
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
/** Downloaded topics/qrels and fetched studies (gitignored). */
export const TREC_CACHE_DIR = path.join(REPO_ROOT, "data/cache/trec");
export const TREC_STUDIES_DIR = path.join(TREC_CACHE_DIR, "studies");
/** Committed benchmark files: cancer topics, structured answers, README. */
export const TREC_EVAL_DIR = path.join(REPO_ROOT, "eval/trec");
