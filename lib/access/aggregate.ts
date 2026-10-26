import type { CancerGroupId } from "@/config/cancer-groups";
import { STATE_CODES } from "@/lib/ingest/parse";
import type { AccessData, AccessSite, CountsTuple } from "@/lib/types/access";
import type { Site, TrialCard } from "@/lib/types/trial";

const MIN_SITE_TRIALS = 5;

const zero = (): CountsTuple => [0, 0, 0, 0, 0];

/** Add one trial's barrier flags to a counts tuple (mutates `c`). */
function addTrial(c: CountsTuple, card: Pick<TrialCard, "barriers">): void {
  const types = new Set(card.barriers.map((b) => b.type));
  c[0] += 1;
  if (types.size > 0) c[1] += 1;
  if (types.has("english_required")) c[2] += 1;
  if (types.has("upper_age_limit")) c[3] += 1;
  if (types.has("disability_exclusion")) c[4] += 1;
}

const stateCode = (s: string): string => STATE_CODES[s] ?? s;

/** Placeholder facility names used by sponsors; not real institutions, so they never form a site row. */
const GENERIC_FACILITY = /^\s*((research|clinical|investigational|investigator|local|study|trial)\s+(site|center|centre|institution)s?|(gsk|pfizer|novartis|lilly|merck|bms|astrazeneca|roche|amgen)?\s*investigational (site|center)|site\s*#?\d+)\s*(#?\d+)?\s*$/i;

/** Aliases for the largest cancer centers, whose name varies by trial ("M D Anderson", "UT MD Anderson", "(All Protocol Activities)"). */
const SITE_ALIASES: [RegExp, string][] = [
  [/\b(banner|rush|baptist|cooper|cancer center at)\b.*\banderson\b|\banderson\b.*\b(banner|rush|baptist|cooper)\b/i, ""],
  [/\bm\.?\s?d\.?\s?anderson\b/i, "MD Anderson Cancer Center"],
  [/\bmemorial sloan[- ]?kettering\b|\bmskcc\b/i, "Memorial Sloan Kettering Cancer Center"],
  [/\bdana[- ]?farber\b/i, "Dana-Farber Cancer Institute"],
  [/^mayo clinic(?! health)/i, "Mayo Clinic"],
  [/^city of hope\b/i, "City of Hope"],
  [/\bemory\b|\bwinship\b/i, "Emory University"],
];

/**
 * Canonical identity of a site: major centers are merged across name variants (per city, so separate
 * campuses stay separate); generic placeholder names return null and are left out of the site table.
 */
export function canonicalSite(s: Site): { key: string; facility: string } | null {
  const raw = s.facility.trim();
  if (!raw || GENERIC_FACILITY.test(raw)) return null;
  const city = s.city.toLowerCase();
  const st = stateCode(s.state);
  for (const [re, name] of SITE_ALIASES) {
    if (re.test(raw)) {
      if (name === "") break; // a differently-owned partner site: keep its own name
      return { key: `alias:${name.toLowerCase()}|${city}|${st}`, facility: name };
    }
  }
  const norm = raw.toLowerCase().replace(/\s*\((site|all protocol|limited protocol|consent only|data collection)[^)]*\)\s*/g, " ").replace(/\s*\(\s*site[^)]*\)\s*/g, " ").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
  return { key: `${norm}|${city}|${st}`, facility: raw };
}

/** Compute national Access Intelligence aggregates from cards + sites. Pure; deterministic. */
export function aggregateAccess(cards: readonly TrialCard[], sitesById: ReadonlyMap<string, readonly Site[]>, dataDate: string, dataVersion: string): AccessData {
  const totals = zero();
  const byGroup: Partial<Record<CancerGroupId, CountsTuple>> = {};
  const byState: Record<string, CountsTuple> = {};
  const byStateGroup: Record<string, Partial<Record<CancerGroupId, CountsTuple>>> = {};
  const sites = new Map<string, { site: Site; counts: CountsTuple; groups: Partial<Record<CancerGroupId, CountsTuple>> }>();

  for (const card of cards) {
    addTrial(totals, card);
    for (const g of card.groups) addTrial((byGroup[g] ??= zero()), card);
    const trialSites = sitesById.get(card.id) ?? [];
    const states = new Set(trialSites.map((s) => stateCode(s.state)).filter(Boolean));
    for (const st of states) {
      addTrial((byState[st] ??= zero()), card);
      const sg = (byStateGroup[st] ??= {});
      for (const g of card.groups) addTrial((sg[g] ??= zero()), card);
    }
    const seen = new Set<string>();
    for (const s of trialSites) {
      const canon = canonicalSite(s);
      if (!canon) continue;
      const key = canon.key;
      if (seen.has(key)) continue; // a trial counts once per site
      seen.add(key);
      let entry = sites.get(key);
      if (!entry) sites.set(key, (entry = { site: { ...s, facility: canon.facility }, counts: zero(), groups: {} }));
      addTrial(entry.counts, card);
      for (const g of card.groups) addTrial((entry.groups[g] ??= zero()), card);
    }
  }

  const siteRows: AccessSite[] = [...sites.values()]
    .filter((e) => e.counts[0] >= MIN_SITE_TRIALS)
    .map((e) => ({ facility: e.site.facility, city: e.site.city, state: stateCode(e.site.state), counts: e.counts, groups: e.groups }))
    .sort((a, b) => b.counts[0] - a.counts[0] || a.facility.localeCompare(b.facility));

  return { dataDate, dataVersion, minSiteTrials: MIN_SITE_TRIALS, totals, byGroup, byState, byStateGroup, sites: siteRows };
}
