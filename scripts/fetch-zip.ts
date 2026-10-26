/**
 * Rebuild data/geo/zcta.csv (ZIP -> internal point) from the U.S. Census Bureau Gazetteer
 * (public domain). Run: `npm run zip:fetch`. The resulting CSV is committed.
 */
import { writeFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";

const YEAR = 2025;
const URL_ = `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${YEAR}_Gazetteer/${YEAR}_Gaz_zcta_national.zip`;

async function main(): Promise<void> {
  const res = await fetch(URL_, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Census download failed: HTTP ${res.status}`);
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const txt = Object.entries(files).find(([name]) => name.endsWith(".txt"));
  if (!txt) throw new Error("Gazetteer zip has no .txt file");
  const lines = strFromU8(txt[1]).split(/\r?\n/).slice(1).filter(Boolean);
  const out = [`# US Census Bureau ${YEAR} Gazetteer ZCTA internal points (public domain). zip,lat,lon`];
  for (const line of lines) {
    const cols = line.split("|");
    const zip = cols[0];
    const lat = Number(cols[6]);
    const lon = Number(cols[7]?.trim());
    if (zip && Number.isFinite(lat) && Number.isFinite(lon)) out.push(`${zip},${lat.toFixed(4)},${lon.toFixed(4)}`);
  }
  await writeFile("data/geo/zcta.csv", out.join("\n") + "\n");
  console.log(`Wrote ${out.length - 1} ZIP centroids to data/geo/zcta.csv`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
