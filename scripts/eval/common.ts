/** Shared eval helpers: build the seed dataset in memory (no public/data dependency). */
import { readFileSync } from "node:fs";
import { RawStudySchema } from "../../lib/ingest/raw";
import { buildRecord } from "../../lib/ingest/record";
import type { Site, TrialCard } from "../../lib/types/trial";
import type { LatLon } from "../../lib/geo/distance";

export function loadZip(): Map<string, LatLon> {
  const m = new Map<string, LatLon>();
  for (const line of readFileSync("data/geo/zcta.csv", "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [z, lat, lon] = line.split(",");
    if (z && lat && lon) m.set(z, { lat: Number(lat), lon: Number(lon) });
  }
  return m;
}

export function loadSeedCards(zips: Map<string, LatLon>): { cards: TrialCard[]; sites: Map<string, Site[]> } {
  const seed = JSON.parse(readFileSync("data/seed/studies.json", "utf8")) as { studies: unknown[] };
  const cards: TrialCard[] = [];
  const sites = new Map<string, Site[]>();
  for (const s of seed.studies) {
    const raw = RawStudySchema.safeParse(s);
    if (!raw.success) continue;
    const r = buildRecord(raw.data, (z) => zips.get(z));
    if (!r.ok || sites.has(r.card.id)) continue;
    cards.push(r.card);
    sites.set(r.card.id, r.sites);
  }
  cards.sort((a, b) => a.id.localeCompare(b.id));
  return { cards, sites };
}

/** Same as the browser's lookupZip: exact ZCTA, else the 3-digit-prefix average. */
export function zipCentroid(zips: Map<string, LatLon>, zip: string): LatLon | null {
  const exact = zips.get(zip);
  if (exact) return exact;
  const pts = [...zips.entries()].filter(([z]) => z.startsWith(zip.slice(0, 3))).map(([, c]) => c);
  if (!pts.length) return null;
  return { lat: pts.reduce((s, c) => s + c.lat, 0) / pts.length, lon: pts.reduce((s, c) => s + c.lon, 0) / pts.length };
}
