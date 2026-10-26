import { readFileSync } from "node:fs";
import { RawStudySchema } from "@/lib/ingest/raw";
import { buildRecord } from "@/lib/ingest/record";
import type { ServerTrial } from "@/functions/lib/trials";

/** Real trials from the committed ClinicalTrials.gov seed, converted to the backend's copy. */
export function loadSeedServerTrials(limit = 20): ServerTrial[] {
  const seed = JSON.parse(readFileSync("data/seed/studies.json", "utf8")) as { studies: unknown[] };
  const out: ServerTrial[] = [];
  for (const s of seed.studies) {
    const raw = RawStudySchema.safeParse(s);
    if (!raw.success) continue;
    const r = buildRecord(raw.data);
    if (!r.ok) continue;
    const c = r.card;
    out.push({ id: c.id, title: c.title, summary: c.summary, inclusion: c.inclusion, exclusion: c.exclusion, minAge: c.minAge, maxAge: c.maxAge, groups: c.groups, facts: c.facts, barriers: c.barriers });
    if (out.length >= limit) break;
  }
  return out;
}
