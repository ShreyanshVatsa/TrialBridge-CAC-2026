/**
 * `npm run data:verify`: prove the inputs behind the built dataset are intact.
 *  - every pinned embedding model file is present with the pinned sha256;
 *  - data/data-lock.json parses, its snapshot pages exist with the recorded hashes, and its query/field list match the code;
 *  - when public/data holds national data, its manifest's dataVersion equals the lock's;
 *  - the D1 seed (data/build/criteria.sql) carries the same dataVersion as public/data and the current
 *    CRITERIA_VERSION on every row, since /api/match silently skips trials whose criteriaVersion differs.
 * Exit 1 on any problem (prints each one). Used by CI and the refresh workflow.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { EMBEDDING_MODEL, EMBEDDING_MODEL_FILES, EMBEDDING_MODEL_REVISION, PIPELINE_VERSION } from "../config/embedding";
import { CTGOV_FIELDS } from "../lib/ingest/raw";
import { DATA_LOCK_FILE, readDataLock, sha256Hex, verifyModelFiles } from "../lib/ingest/snapshot";
import { NATIONAL_QUERY } from "./ingest/ctgov";
import { ManifestSchema } from "../lib/types/trial";
import { CRITERIA_VERSION } from "../lib/ingest/criteria-split";

const problems: string[] = [];
const notes: string[] = [];

const modelDir = path.join("public/models", EMBEDDING_MODEL);
for (const p of verifyModelFiles(modelDir, EMBEDDING_MODEL_FILES)) problems.push(`model ${p}`);
if (!problems.length) notes.push(`model ${EMBEDDING_MODEL} @ ${EMBEDDING_MODEL_REVISION.slice(0, 12)}: ${Object.keys(EMBEDDING_MODEL_FILES).length} files verified`);

let lock: ReturnType<typeof readDataLock> = null;
try {
  lock = readDataLock();
} catch (err) {
  problems.push(`${DATA_LOCK_FILE}: ${err instanceof Error ? err.message : String(err)}`);
}
if (!lock) notes.push(`${DATA_LOCK_FILE}: absent (no national build recorded)`);
else {
  if (JSON.stringify(lock.query) !== JSON.stringify(NATIONAL_QUERY)) problems.push("lock query differs from NATIONAL_QUERY in scripts/ingest/ctgov.ts");
  if (lock.fields !== CTGOV_FIELDS) problems.push("lock field list differs from CTGOV_FIELDS in lib/ingest/raw.ts (re-run `npm run ingest -- --refresh`)");
  if (lock.pipelineVersion !== PIPELINE_VERSION) problems.push(`lock pipelineVersion ${lock.pipelineVersion} differs from ${PIPELINE_VERSION}`);
  if (lock.model.revision !== EMBEDDING_MODEL_REVISION) problems.push("lock model revision differs from config/embedding.ts");
  if (!existsSync(path.join(lock.snapshot, "state.json"))) notes.push(`snapshot ${lock.snapshot} is not on this machine (pages cannot be checked here)`);
  else {
    let ok = 0;
    for (const p of lock.pages) {
      const f = path.join(lock.snapshot, p.file);
      if (!existsSync(f)) problems.push(`snapshot page ${p.file} missing`);
      else if (sha256Hex(readFileSync(f)) !== p.sha256) problems.push(`snapshot page ${p.file} hash mismatch`);
      else ok++;
    }
    notes.push(`snapshot ${lock.snapshot}: ${ok}/${lock.pages.length} pages verified (fetched ${lock.fetchedAt}${lock.fetchedAtApproximate ? ", approximate" : ""})`);
  }
  const manifestFile = "public/data/manifest.json";
  if (existsSync(manifestFile)) {
    const manifest = ManifestSchema.parse(JSON.parse(readFileSync(manifestFile, "utf8")));
    if (manifest.dataVersion.startsWith("national-")) {
      if (manifest.dataVersion !== lock.dataVersion) problems.push(`public/data is ${manifest.dataVersion} but the lock records ${lock.dataVersion}`);
      else notes.push(`public/data ${manifest.dataVersion} matches the lock (${lock.totalTrials} trials)`);
    } else notes.push(`public/data holds ${manifest.dataVersion} (seed); lock not compared`);
  }
}

const seedFile = "data/build/criteria.sql";
if (existsSync(seedFile) && existsSync("public/data/manifest.json")) {
  const manifest = ManifestSchema.parse(JSON.parse(readFileSync("public/data/manifest.json", "utf8")));
  const sql = readFileSync(seedFile, "utf8");
  const versions = new Set([...sql.matchAll(/VALUES \('NCT\d{8}', '([^']+)'/g)].map((m) => m[1]));
  const rows = (sql.match(/^INSERT INTO trials/gm) ?? []).length;
  const stale = (sql.match(/"criteriaVersion":(\d+)/g) ?? []).filter((x) => x !== `"criteriaVersion":${CRITERIA_VERSION}`).length;
  if (versions.size !== 1 || !versions.has(manifest.dataVersion)) problems.push(`${seedFile} data versions [${[...versions].join(", ")}] differ from public/data ${manifest.dataVersion} (re-run \`npm run ingest\`)`);
  else if (stale > 0) problems.push(`${seedFile}: ${stale} rows have a criteriaVersion other than ${CRITERIA_VERSION}`);
  else notes.push(`${seedFile}: ${rows} rows, ${manifest.dataVersion}, criteriaVersion ${CRITERIA_VERSION}`);
}

for (const n of notes) console.log(`ok   ${n}`);
for (const p of problems) console.error(`FAIL ${p}`);
if (problems.length) process.exit(1);
console.log("data:verify passed");
