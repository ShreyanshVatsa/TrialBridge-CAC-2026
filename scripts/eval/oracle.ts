/**
 * Independent hard-filter oracle.
 *
 * The app's hard filters (lib/match/filters.ts) read derived TrialCard fields (groups, minAge/maxAge, sites with
 * ZIP-centroid coordinates). Re-checking a result with those same functions can never fail, so it proves nothing.
 * This oracle re-derives all three decisions from the RAW ClinicalTrials.gov record instead, with its own code:
 *   - cancer group: its own term lists (written here, not imported from config/cancer-groups.ts) matched against the
 *     raw conditions, keywords and titles;
 *   - age: its own parser of the raw "18 Years" / "6 Months" strings;
 *   - distance: the raw facility geoPoint of each recruiting U.S. location and its own haversine.
 * It deliberately imports nothing from lib/match, lib/ingest or config. (The ZIP centroid table is plain input data.)
 * Disagreements are reported, not silently reconciled. See eval/RESULTS.md for how to read them.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface RawLoc {
  status?: string;
  country?: string;
  geoPoint?: { lat: number; lon: number };
}
/** The few raw fields the oracle looks at (a structural subset of a ClinicalTrials.gov v2 study). */
export interface OracleStudy {
  id: string;
  text: string; // conditions + keywords + titles, lowercased
  ownText?: string; // conditions + titles only (no sponsor keywords), lowercased; defaults to text
  minAgeYears: number | null;
  maxAgeYears: number | null;
  sex: string;
  locations: RawLoc[];
}

// ---- cancer group terms (independent of config/cancer-groups.ts) ------------------------------------------------
const GROUP_TERMS: Record<string, RegExp> = {
  breast: /breast|mammary|\btnbc\b/,
  lung: /\blung\b|nsclc|sclc|mesothelioma|bronchogenic|pulmonary (carcinoma|adenocarcinoma|neoplasm)/,
  colorectal: /colorectal|\bcolon\b|colonic|rectal|rectum|\banal (cancer|carcinoma|canal)|\bcrc\b|polyposis|lynch syndrome/,
  prostate: /prostat/,
  leukemia: /leuk(a)?emi|myelodysplas|\bmds\b|\baml\b|\bcll\b|\bcml\b|myeloproliferative|myeloid malignan|lymphoblastic|myelofibrosis|mastocytosis|polycythemia|thrombocythemia|blastic plasmacytoid|\bbpdcn\b/,
  lymphoma: /lymphoma|hodgkin|dlbcl|waldenstr|macroglobulinemia|\bsll\b|lymphocytic|lymphoproliferative|mycosis fungoides/,
  myeloma: /myeloma|plasmacytoma|plasma cell/,
  melanoma: /melanoma|merkel|basal cell carcinoma|cutaneous squamous|skin (cancer|carcinoma|neoplasm)|uveal/,
  pancreatic: /pancrea|insulinoma/,
  ovarian: /ovar|fallopian|peritoneal (cancer|carcinoma|neoplasm)/,
  brain: /pituitary|schwannoma|craniopharyngioma|glioma|glioblastoma|astrocytoma|medulloblastoma|ependymoma|meningioma|brain (tumou?r|cancer|neoplasm|metasta)|central nervous system (tumou?r|neoplasm|cancer)|\bcns (tumou?r|lymphoma|neoplasm)|leptomeningeal/,
  bladder: /(?<!gall ?)bladder|urothelial|transitional cell|\bnmibc\b|\bmibc\b/,
  kidney: /kidney|renal (cell|carcinoma|neoplasm|tumou?r|cancer)|\brcc\b|wilms/,
  liver: /liver|hepatocellular|\bhcc\b|cholangio|biliary|bile duct|gall ?bladder|hepatic (carcinoma|cancer|neoplasm)/,
  "head-neck": /head and neck|head & neck|head\/neck|\bhnscc\b|oral cavity|oropharyn|laryn|nasopharyn|hypopharyn|salivary|tongue|\bmouth\b/,
  gastroesophageal: /gastric|stomach|esophag|oesophag|gastroesophageal|gastro-oesophageal|\bgej\b|cardia/,
  "uterine-cervical": /endometri|uterine|uterus|cervical (cancer|carcinoma|neoplasm|intraepithelial)|\bcervix\b|vulvar|vaginal/,
  sarcoma: /sarcoma|\bgist\b|gastrointestinal stromal|desmoid|chordoma/,
  thyroid: /thyroid/,
};
const HEME_GROUPS = new Set(["leukemia", "lymphoma", "myeloma"]);
const GENERIC_CANCER = /cancer|neoplasm|tumou?r|carcinoma|malignan|metasta|solid|oncolog/;
const GENERIC_HEME = /hematolog|haematolog|blood (cancer|malignan)|myeloid|lymphoid|bone marrow/;

/**
 * Does the raw record say this patient's cancer group? "other" accepts any cancer trial; solid-tumor profiles also
 * accept generic baskets. A record is a basket when its conditions and titles (`ownText`) name no specific cancer:
 * sponsor keywords often list example indications of a basket ("HER2+ breast cancer", "esophageal adenocarcinoma" on an
 * "Advanced Solid Tumors" study), so they count as a positive match but do not stop a record from being a basket.
 */
export function oracleGroupOk(text: string, group: string, ownText: string = text): boolean {
  if (group === "other") return true;
  if (group === "solid-tumors") return GENERIC_CANCER.test(text) || Object.values(GROUP_TERMS).some((r) => r.test(text));
  const specific = GROUP_TERMS[group];
  if (specific?.test(text)) return true;
  // A basket / generic record that names no specific cancer applies to solid-tumor groups (not to blood cancers).
  const namesSomething = Object.values(GROUP_TERMS).some((r) => r.test(ownText));
  if (namesSomething) return false;
  if (HEME_GROUPS.has(group)) return GENERIC_HEME.test(ownText);
  return GENERIC_CANCER.test(ownText);
}

// ---- age (independent parser) ----------------------------------------------------------------------------------
export function oracleAgeYears(s: string | undefined): number | null {
  if (!s) return null;
  const m = /(\d+(?:\.\d+)?)\s*(year|month|week|day|hour|minute)/i.exec(s);
  if (!m) return null; // "N/A" or unparseable: no bound
  const v = Number(m[1]);
  const per = { year: 1, month: 12, week: 52.14, day: 365.25, hour: 8766, minute: 525960 }[(m[2] as string).toLowerCase() as "year"];
  return v / per;
}
export function oracleAgeOk(s: Pick<OracleStudy, "minAgeYears" | "maxAgeYears">, age: number): boolean {
  if (s.minAgeYears !== null && age < s.minAgeYears - 1e-6) return false; // a 17-year-old fails "18 Years"
  if (s.maxAgeYears !== null && age > s.maxAgeYears + 1e-6) return false;
  return true;
}

// ---- distance (own haversine, raw facility geoPoints) ----------------------------------------------------------
export function oracleHaversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // miles
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const OPEN_STATUS = new Set(["RECRUITING", "NOT_YET_RECRUITING"]);
/** Recruiting U.S. locations that have no registry coordinates (e.g. a misspelled city such as "Huston"). */
export function oracleUncodedSites(s: OracleStudy): number {
  return s.locations.filter((l) => (!l.country || l.country === "United States") && (!l.status || OPEN_STATUS.has(l.status)) && !l.geoPoint).length;
}
/** Nearest recruiting U.S. location (miles) to the origin, using the registry's own coordinates; null when none has coordinates. */
export function oracleNearestMiles(s: OracleStudy, origin: { lat: number; lon: number }): number | null {
  let best: number | null = null;
  for (const l of s.locations) {
    if (l.country && l.country !== "United States") continue;
    if (l.status && !OPEN_STATUS.has(l.status)) continue;
    if (!l.geoPoint) continue;
    const d = oracleHaversine(origin.lat, origin.lon, l.geoPoint.lat, l.geoPoint.lon);
    if (best === null || d < best) best = d;
  }
  return best;
}

export interface OraclePatient {
  group: string;
  age: number;
  origin: { lat: number; lon: number } | null;
  travelMiles: number | null;
  sex?: "female" | "male" | null;
}
/**
 * Facility geoPoints and the ZIP centroids the app uses are different points; a trial whose nearest site is within a
 * few miles of the limit can legitimately differ. Violations are therefore counted at this slack (strict also reported).
 */
export const DISTANCE_SLACK_MILES = 25;

export interface Verdict {
  group: boolean;
  age: boolean;
  sex: boolean;
  /** Strict: no raw location inside the limit. */
  distanceStrict: boolean;
  /** Tolerant: no raw location inside limit + DISTANCE_SLACK_MILES. */
  distance: boolean;
  /** The raw record has no recruiting U.S. location with registry coordinates, so distance could not be checked (counted as pass). */
  distanceUnverifiable: boolean;
}
export function oracleVerdict(s: OracleStudy, p: OraclePatient): Verdict {
  let distanceStrict = true;
  let distance = true;
  let distanceUnverifiable = false;
  if (p.travelMiles !== null && p.origin) {
    const d = oracleNearestMiles(s, p.origin);
    if (d === null) distanceUnverifiable = true; // no registry coordinates: cannot judge, do not flag
    else {
      distanceStrict = d <= p.travelMiles;
      distance = d <= p.travelMiles + DISTANCE_SLACK_MILES;
      // A site the registry left without coordinates may be the near one (NCT03850574: "Huston", TX 77030 for a
      // Houston patient; the app places it by its ZIP). Such a result cannot be judged, so it is not flagged.
      if (!distanceStrict && oracleUncodedSites(s) > 0) {
        distanceStrict = distance = true;
        distanceUnverifiable = true;
      }
    }
  }
  const sexOk = !p.sex || s.sex === "ALL" || s.sex === "" || (p.sex === "female" ? s.sex === "FEMALE" : s.sex === "MALE");
  return { group: oracleGroupOk(s.text, p.group, s.ownText ?? s.text), age: oracleAgeOk(s, p.age), sex: sexOk, distanceStrict, distance, distanceUnverifiable };
}

// ---- loading raw records ----------------------------------------------------------------------------------------
interface RawJson {
  protocolSection?: {
    identificationModule?: { nctId?: string; briefTitle?: string; officialTitle?: string };
    conditionsModule?: { conditions?: string[]; keywords?: string[] };
    eligibilityModule?: { minimumAge?: string; maximumAge?: string; sex?: string };
    contactsLocationsModule?: { locations?: RawLoc[] };
  };
}
export function toOracleStudy(raw: RawJson): OracleStudy | null {
  const ps = raw.protocolSection;
  const id = ps?.identificationModule?.nctId;
  if (!ps || !id) return null;
  const titles = [ps.identificationModule?.briefTitle ?? "", ps.identificationModule?.officialTitle ?? ""];
  const text = [...(ps.conditionsModule?.conditions ?? []), ...(ps.conditionsModule?.keywords ?? []), ...titles].join(" | ").toLowerCase();
  const ownText = [...(ps.conditionsModule?.conditions ?? []), ...titles].join(" | ").toLowerCase();
  return {
    id,
    text,
    ownText,
    minAgeYears: oracleAgeYears(ps.eligibilityModule?.minimumAge),
    maxAgeYears: oracleAgeYears(ps.eligibilityModule?.maximumAge),
    sex: ps.eligibilityModule?.sex ?? "",
    locations: ps.contactsLocationsModule?.locations ?? [],
  };
}

export function loadRawSeed(file = "data/seed/studies.json"): Map<string, OracleStudy> {
  const out = new Map<string, OracleStudy>();
  const j = JSON.parse(readFileSync(file, "utf8")) as { studies: RawJson[] };
  for (const r of j.studies) {
    const s = toOracleStudy(r);
    if (s) out.set(s.id, s);
  }
  return out;
}

/** Raw national CT.gov pages from the ingest cache (data/cache/national/page-*.json); null when the cache is absent. */
export function loadRawNational(dir = "data/cache/national"): Map<string, OracleStudy> | null {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /^page-\d+\.json$/.test(f)).sort();
  if (!files.length) return null;
  const out = new Map<string, OracleStudy>();
  for (const f of files) {
    const arr = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as RawJson[];
    for (const r of arr) {
      const s = toOracleStudy(r);
      if (s) out.set(s.id, s);
    }
  }
  return out;
}

// ---- tallying ---------------------------------------------------------------------------------------------------
export interface OracleTally {
  results: number;
  unverifiable: number; // returned ids with no raw record
  group: number;
  age: number;
  sex: number;
  distance: number; // tolerant
  distanceStrict: number;
  distanceUnverifiable: number; // results whose raw record has no coordinates (not counted as violations)
  any: number; // results failing at least one (tolerant) check
  samples: string[]; // up to a handful of "NCT... (check)" for the report
}
export const emptyTally = (): OracleTally => ({ results: 0, unverifiable: 0, group: 0, age: 0, sex: 0, distance: 0, distanceStrict: 0, distanceUnverifiable: 0, any: 0, samples: [] });

export function tallyResults(t: OracleTally, raw: ReadonlyMap<string, OracleStudy>, ids: readonly string[], p: OraclePatient, label = ""): void {
  for (const id of ids) {
    t.results++;
    const s = raw.get(id);
    if (!s) {
      t.unverifiable++;
      continue;
    }
    const v = oracleVerdict(s, p);
    const failed: string[] = [];
    if (!v.group) {
      t.group++;
      failed.push("group");
    }
    if (!v.age) {
      t.age++;
      failed.push("age");
    }
    if (!v.sex) {
      t.sex++;
      failed.push("sex");
    }
    if (!v.distance) {
      t.distance++;
      failed.push("distance");
    }
    if (!v.distanceStrict) t.distanceStrict++;
    if (v.distanceUnverifiable) t.distanceUnverifiable++;
    if (failed.length) {
      t.any++;
      if (t.samples.length < 8) t.samples.push(`${id} for ${label || p.group} (${failed.join("+")})`);
    }
  }
}

/** Oracle-eligible ids among the raw records (group, age, sex, tolerant distance): for the false-negative (missed trial) check. */
export function oracleEligibleIds(raw: ReadonlyMap<string, OracleStudy>, p: OraclePatient): string[] {
  const out: string[] = [];
  for (const s of raw.values()) {
    const v = oracleVerdict(s, p);
    if (v.group && v.age && v.sex && v.distance) out.push(s.id);
  }
  return out;
}
