/**
 * Build the committed seed dataset (data/seed/studies.json) from REAL ClinicalTrials.gov records:
 * ~300 recruiting, interventional cancer trials with a U.S. site, across 12 cancer types.
 * Only U.S. locations are kept to keep the file small. Run: `npm run seed:fetch`.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { fetchPage, SCOPE_PARAMS } from "./ingest/ctgov";
import { RawStudySchema, type RawStudy } from "../lib/ingest/raw";

const PER_QUERY = 32;
const QUERIES = [
  "breast cancer",
  "lung cancer",
  "colorectal cancer",
  "prostate cancer",
  "leukemia",
  "lymphoma",
  "multiple myeloma",
  "melanoma",
  "pancreatic cancer",
  "ovarian cancer",
  "glioma OR glioblastoma",
  "bladder cancer OR urothelial carcinoma",
];

async function main(): Promise<void> {
  const byId = new Map<string, RawStudy>();
  for (const cond of QUERIES) {
    const page = await fetchPage({ ...SCOPE_PARAMS, "query.cond": cond, pageSize: String(PER_QUERY) });
    let added = 0;
    for (const s of page.studies) {
      const parsed = RawStudySchema.safeParse(s);
      if (!parsed.success) continue;
      const study = parsed.data;
      const locs = study.protocolSection.contactsLocationsModule?.locations;
      if (locs && study.protocolSection.contactsLocationsModule) {
        study.protocolSection.contactsLocationsModule.locations = locs.filter((l) => l.country === "United States");
      }
      const id = study.protocolSection.identificationModule.nctId;
      if (!byId.has(id)) {
        byId.set(id, study);
        added++;
      }
    }
    console.log(`${cond}: +${added} (total ${byId.size}, ${page.totalCount ?? "?"} available)`);
  }
  await mkdir("data/seed", { recursive: true });
  const out = { source: "ClinicalTrials.gov API v2", fetchedAt: new Date().toISOString(), scope: SCOPE_PARAMS, queries: QUERIES, studies: [...byId.values()] };
  await writeFile("data/seed/studies.json", JSON.stringify(out));
  console.log(`Wrote ${byId.size} studies to data/seed/studies.json`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
