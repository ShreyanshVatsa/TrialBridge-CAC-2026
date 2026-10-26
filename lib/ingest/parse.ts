import type { Criterion, Site, Contact } from "@/lib/types/trial";
import type { RawStudy } from "./raw";

/** Remove ClinicalTrials.gov markdown backslash escapes (e.g. "\\>" -> ">"). */
export function unescapeMarkdown(s: string): string {
  return s.replace(/\\([\\`*_{}[\]()#+\-.!<>~|=^])/g, "$1");
}

/** Collapse whitespace for comparisons (quote verification, dedupe). */
export function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const BULLET = /^(\s*)(?:[*\-•·]|\d{1,3}[.)]|[a-z][.)]|\([a-z0-9]{1,3}\))\s+/i;
const INCLUSION_HEADER = /^\s*(key\s+)?inclusion criteria\b.*$/i;
const EXCLUSION_HEADER = /^\s*(key\s+)?exclusion criteria\b.*$/i;

/**
 * Split an eligibility block into numbered inclusion and exclusion criteria.
 * Top-level bullets become criteria; deeper-indented bullets and continuation lines are kept
 * with their parent (newlines preserved) so each criterion stays verbatim official text.
 * Text before any header is treated as inclusion. Unbulleted paragraphs become their own criterion.
 */
export function parseEligibility(raw: string): { inclusion: Criterion[]; exclusion: Criterion[] } {
  const text = unescapeMarkdown(raw.replace(/\r\n?/g, "\n"));
  const sections: Record<"inclusion" | "exclusion", string[]> = { inclusion: [], exclusion: [] };
  let current: "inclusion" | "exclusion" = "inclusion";
  let topIndent: number | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const joined = buffer.join("\n").trim();
    if (joined) sections[current].push(joined);
    buffer = [];
  };

  for (const line of text.split("\n")) {
    if (INCLUSION_HEADER.test(line) || EXCLUSION_HEADER.test(line)) {
      flush();
      current = EXCLUSION_HEADER.test(line) ? "exclusion" : "inclusion";
      topIndent = null;
      continue;
    }
    if (!line.trim()) {
      // Blank line ends an unbulleted paragraph, but bullets may be separated by blanks.
      if (buffer.length && !BULLET.test(buffer[0] ?? "")) flush();
      continue;
    }
    const m = BULLET.exec(line);
    if (m) {
      const indent = (m[1] ?? "").length;
      if (topIndent === null) topIndent = indent;
      if (indent <= topIndent) {
        flush();
        buffer.push(line.slice(m[0].length).trim());
        continue;
      }
      buffer.push(line.trim()); // nested bullet stays with its parent, keeping its marker
      continue;
    }
    buffer.push(line.trim()); // continuation line (or start of an unbulleted paragraph)
  }
  flush();

  const number = (items: string[]): Criterion[] => items.map((t, i) => ({ n: i + 1, text: t }));
  return { inclusion: number(sections.inclusion), exclusion: number(sections.exclusion) };
}

/** Parse "18 Years" / "6 Months" / "N/A" into years (null = no limit). */
export function parseAge(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)\s*(year|month|week|day|hour|minute)s?$/i.exec(s.trim());
  if (!m) return null;
  const v = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  const perYear: Record<string, number> = { year: 1, month: 12, week: 52.1775, day: 365.25, hour: 8766, minute: 525960 };
  return Math.round((v / (perYear[unit] ?? 1)) * 100) / 100;
}

/** Keep U.S. sites that are recruiting or not yet recruiting (or have no status). */
export function usSites(study: RawStudy): Site[] {
  const locs = study.protocolSection.contactsLocationsModule?.locations ?? [];
  const ok = new Set(["RECRUITING", "NOT_YET_RECRUITING", "ENROLLING_BY_INVITATION", undefined]);
  const seen = new Set<string>();
  const out: Site[] = [];
  for (const l of locs) {
    if (l.country !== "United States" || !ok.has(l.status)) continue;
    const site: Site = {
      facility: l.facility?.trim() || "Study site",
      city: l.city?.trim() ?? "",
      state: l.state?.trim() ?? "",
      zip: (l.zip ?? "").trim().slice(0, 5),
      ...(l.geoPoint ? { lat: l.geoPoint.lat, lon: l.geoPoint.lon } : {}),
      ...(l.status ? { status: l.status } : {}),
    };
    const key = `${site.facility}|${site.city}|${site.zip}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(site);
  }
  return out;
}

/** Central contacts with at least a phone or email. */
export function contacts(study: RawStudy): Contact[] {
  return (study.protocolSection.contactsLocationsModule?.centralContacts ?? [])
    .filter((c) => c.phone || c.email)
    .slice(0, 3)
    .map((c) => ({ ...(c.name ? { name: c.name } : {}), ...(c.phone ? { phone: c.phone } : {}), ...(c.email ? { email: c.email } : {}) }));
}

/** U.S. state names -> postal codes (for compact display and the state filter). */
export const STATE_CODES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE",
  "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN",
  Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ",
  "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR",
  Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT",
  Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY", "Puerto Rico": "PR",
  Guam: "GU", "Virgin Islands": "VI", "U.S. Virgin Islands": "VI",
};
