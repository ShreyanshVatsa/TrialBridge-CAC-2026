import { basketAppliesTo, getCancerGroup, isBasketOnly, type CancerGroupId } from "@/config/cancer-groups";
import { haversineMiles, type LatLon } from "@/lib/geo/distance";
import type { Site, TrialCard } from "@/lib/types/trial";
import type { NearestSite } from "@/lib/types/match";

/**
 * Hard filter: the trial's group list must include the selected group ("other" = any group).
 * Solid-tumor basket trials that name no specific cancer type also apply to every solid-tumor group.
 */
export function passesGroup(card: Pick<TrialCard, "groups"> & Partial<Pick<TrialCard, "conditions" | "title" | "officialTitle">>, group: CancerGroupId): boolean {
  return group === "other" || card.groups.includes(group) || (basketAppliesTo(group) && isBasketOnly(card.groups)) || untaggedNamesGroup(card, group);
}

/**
 * Recall rescue: a trial the ingest could not place in any group ("other") still passes when its own conditions or
 * titles name the patient's group (e.g. "Pleural Effusion, Malignant" for lung). Trials with any group tag are not
 * second-guessed here. Found on the TREC subset, where 37 judged-eligible mesothelioma trials sat in "other".
 */
function untaggedNamesGroup(card: Pick<TrialCard, "groups"> & Partial<Pick<TrialCard, "conditions" | "title" | "officialTitle">>, group: CancerGroupId): boolean {
  if (card.groups.length !== 1 || card.groups[0] !== "other" || group === "solid-tumors") return false;
  const text = [...(card.conditions ?? []), card.title ?? "", card.officialTitle ?? ""].join(" ; ");
  return getCancerGroup(group).text.some((re) => re.test(text));
}

/** Hard filter: age within [minAge, maxAge]; null bounds mean no limit. */
export function passesAge(card: Pick<TrialCard, "minAge" | "maxAge">, age: number): boolean {
  if (card.minAge !== null && age < card.minAge) return false;
  if (card.maxAge !== null && age > card.maxAge) return false;
  return true;
}

/**
 * Hard filter (v2): a definite sex answer hides trials restricted to the other sex. "Prefer not to say",
 * "not sure" and skip pass `null`, which never filters. Trials open to ALL always pass.
 */
export function passesSex(card: Pick<TrialCard, "sex">, sex: "FEMALE" | "MALE" | null | undefined): boolean {
  return !sex || card.sex === "ALL" || card.sex === sex;
}

/** Sites sorted nearest-first; sites without coordinates go last with miles = null. */
export function sortSitesByDistance(sites: Site[], origin: LatLon | null): NearestSite[] {
  const withMiles = sites.map((site) => ({
    site,
    miles: origin && site.lat !== undefined && site.lon !== undefined ? haversineMiles(origin, { lat: site.lat, lon: site.lon }) : null,
  }));
  return withMiles.sort((a, b) => (a.miles ?? Infinity) - (b.miles ?? Infinity));
}

/**
 * Nearest site, or the first site when distance is unknown; null when there are no sites. A single pass that keeps
 * the first site with the smallest distance (the same pick as sorting every site by distance, without the sort
 * and without building a result for each site: trials can list hundreds of sites).
 */
export function nearestSite(sites: Site[], origin: LatLon | null): NearestSite | null {
  let best: NearestSite | null = null;
  let bestMiles = Infinity; // distance used for comparing; sites without coordinates compare as Infinity
  for (const site of sites) {
    const miles = origin && site.lat !== undefined && site.lon !== undefined ? haversineMiles(origin, { lat: site.lat, lon: site.lon }) : null;
    const d = miles ?? Infinity;
    if (best === null || d < bestMiles) {
      best = { site, miles };
      bestMiles = d;
    }
  }
  return best;
}

/**
 * Hard filter: at least one site within `maxMiles`. `maxMiles === null` means "anywhere".
 * Sites without coordinates never satisfy a distance limit. (When the user's own location is
 * unknown, callers pass maxMiles = null.)
 */
export function passesDistance(nearest: NearestSite | null, maxMiles: number | null): boolean {
  if (maxMiles === null) return nearest !== null;
  if (!nearest) return false;
  return nearest.miles !== null && nearest.miles <= maxMiles;
}
