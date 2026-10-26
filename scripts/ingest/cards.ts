/**
 * Load rule-layer trial cards straight from the cached ClinicalTrials.gov snapshot (national) or the committed
 * seed, without writing anything. Shared by fact-precision.ts, llm.ts and llm-eval.ts.
 */
import { readFileSync } from "node:fs";
import { RawStudySchema } from "../../lib/ingest/raw";
import { buildRecord } from "../../lib/ingest/record";
import { readDataLock, readSnapshotStudies, resolveSnapshotDir } from "../../lib/ingest/snapshot";
import type { TrialCard } from "../../lib/types/trial";

/** The national snapshot directory scripts read by default (lock file, else newest snapshot, else the older cache). */
export function nationalSnapshotDir(): string {
  const dir = resolveSnapshotDir({ lock: readDataLock(), ...(process.env.SNAPSHOT_DIR ? { explicit: process.env.SNAPSHOT_DIR } : {}) });
  if (!dir) throw new Error("no national snapshot found; run `npm run ingest -- --refresh`");
  return dir;
}

export function loadRawStudies(source: "national" | "seed" = "national"): unknown[] {
  return source === "seed" ? (JSON.parse(readFileSync("data/seed/studies.json", "utf8")) as { studies: unknown[] }).studies : readSnapshotStudies(nationalSnapshotDir());
}

export function loadCards(source: "national" | "seed" = "national"): TrialCard[] {
  const seen = new Set<string>();
  const cards: TrialCard[] = [];
  for (const s of loadRawStudies(source)) {
    const raw = RawStudySchema.safeParse(s);
    if (!raw.success) continue;
    const r = buildRecord(raw.data);
    if (!r.ok || seen.has(r.card.id)) continue;
    seen.add(r.card.id);
    cards.push(r.card);
  }
  return cards.sort((a, b) => a.id.localeCompare(b.id));
}
