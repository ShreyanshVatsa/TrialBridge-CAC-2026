import { TrialCardSchema, type Site, type TrialCard } from "@/lib/types/trial";
import type { RawStudy } from "./raw";
import { CRITERIA_VERSION, splitCriteria } from "./criteria-split";
import { contacts, parseAge, parseEligibility, STATE_CODES, unescapeMarkdown, usSites } from "./parse";
import { mapGroups } from "./groups";
import { detectBarriers } from "./barriers";
import { extractRuleFacts } from "./facts";

type BuildResult = { ok: true; card: TrialCard; sites: Site[] } | { ok: false; id: string; reason: string };

const SUMMARY_MAX = 1200;
export const OUT_OF_SCOPE = "no recruiting U.S. sites";
export const NOT_CANCER = "not a cancer trial";
/** Cancer scope check for records matched by the broad API query (e.g. "tumor" also matches non-cancer studies). */
const CANCER_TEXT = /cancer|neoplas|tumou?r|carcinoma|lymphoma|leuk(a)?emia|myeloma|melanoma|sarcoma|glioma|blastoma|malignan|metasta|oncolog|myelodysplastic|myeloproliferative|mesothelioma|carcinoid/i;

/** Stricter malignancy check for trials that fit no cancer group: benign neoplasms (cysts, hemangioma) don't count. */
const MALIGNANCY_TEXT = /cancer|tumou?r|carcinoma|lymphoma|leuk(a)?emia|myeloma|melanoma|sarcoma|glioma|blastoma|malignan|metasta|oncolog|myelodysplastic|myeloproliferative|mesothelioma|carcinoid|neoplasms?,? (germ|plasma|nerve|neuroepithelial|glandular|squamous|gonadal|neuroendocrine|adnexal|connective|complex|second primary|residual|unknown primary|multiple primary|embryonal)|waldenstr|hemangioendothelioma|endocrine neoplasia|intraepithelial (neoplasia|lesion)|mycosis fungoides|histiocytosis|polycythemia|myelofibrosis|thrombocythemia|mastocytosis|hodgkin|seminoma|teratoma|thymoma|paraganglioma|pheochromocytoma|insulinoma|neurofibroma|meningioma|adenoma|polyps?\b/i;

/**
 * Convert one validated ClinicalTrials.gov study into a TrialCard + U.S. sites, running
 * cancer-group mapping, barrier detection, and the rule fact layer. Never throws.
 * `zipLookup` fills coordinates for sites missing a geoPoint.
 */
export function buildRecord(study: RawStudy, zipLookup?: (zip: string) => { lat: number; lon: number } | undefined): BuildResult {
  const ps = study.protocolSection;
  const id = ps.identificationModule.nctId;
  try {
    const elig = ps.eligibilityModule;
    const { inclusion, exclusion } = parseEligibility(elig.eligibilityCriteria);
    if (inclusion.length === 0 && exclusion.length === 0) return { ok: false, id, reason: "no parseable eligibility criteria" };

    const sites = usSites(study).map((s) => {
      if (s.lat !== undefined || !zipLookup) return s;
      const c = zipLookup(s.zip);
      return c ? { ...s, lat: c.lat, lon: c.lon } : s;
    });
    if (sites.length === 0) return { ok: false, id, reason: OUT_OF_SCOPE };

    const meshTerms = [
      ...(study.derivedSection?.conditionBrowseModule?.meshes ?? []).map((m) => m.term),
      ...(study.derivedSection?.conditionBrowseModule?.ancestors ?? []).map((m) => m.term),
    ];
    const conditions = ps.conditionsModule?.conditions ?? [];
    if (!meshTerms.some((t) => /^neoplasms/i.test(t)) && !conditions.some((c) => CANCER_TEXT.test(c)) && !CANCER_TEXT.test(ps.identificationModule.briefTitle)) {
      return { ok: false, id, reason: NOT_CANCER };
    }
    const groups = mapGroups(meshTerms, conditions, ps.identificationModule.briefTitle, ps.identificationModule.officialTitle ?? "");
    if (groups.length === 1 && groups[0] === "other") {
      const text = [...conditions, ps.identificationModule.briefTitle, ps.identificationModule.officialTitle ?? "", ...meshTerms].join("\n");
      if (!MALIGNANCY_TEXT.test(text)) return { ok: false, id, reason: NOT_CANCER };
    }
    const minAge = parseAge(elig.minimumAge);
    const maxAge = parseAge(elig.maximumAge);
    let summary = unescapeMarkdown(ps.descriptionModule?.briefSummary ?? "").trim();
    if (summary.length > SUMMARY_MAX) summary = `${summary.slice(0, SUMMARY_MAX).replace(/\s+\S*$/, "")}…`;
    const sex = elig.sex === "FEMALE" || elig.sex === "MALE" ? elig.sex : "ALL";

    const card: TrialCard = {
      id,
      title: ps.identificationModule.briefTitle.trim(),
      ...(ps.identificationModule.officialTitle ? { officialTitle: ps.identificationModule.officialTitle.trim() } : {}),
      summary,
      phases: (ps.designModule?.phases ?? []).filter((p) => p !== "NA"),
      conditions,
      meshTerms: [...new Set(meshTerms)],
      groups,
      sponsor: ps.sponsorCollaboratorsModule?.leadSponsor?.name ?? "Not listed",
      minAge,
      maxAge,
      sex,
      inclusion,
      exclusion,
      criteria: splitCriteria(elig.eligibilityCriteria),
      criteriaVersion: CRITERIA_VERSION,
      contacts: contacts(study),
      barriers: detectBarriers({ inclusion, exclusion, maxAge, minAge, ...(elig.maximumAge ? { maxAgeRaw: elig.maximumAge } : {}) }),
      facts: extractRuleFacts(inclusion, exclusion, groups, [...conditions, ps.identificationModule.briefTitle]),
      siteCount: sites.length,
      states: [...new Set(sites.map((s) => STATE_CODES[s.state] ?? s.state))].sort(),
      lastUpdated: ps.statusModule.lastUpdatePostDateStruct?.date ?? "",
    };
    const parsed = TrialCardSchema.safeParse(card);
    if (!parsed.success) return { ok: false, id, reason: parsed.error.issues[0]?.message ?? "invalid card" };
    return { ok: true, card: parsed.data, sites };
  } catch (err) {
    return { ok: false, id, reason: err instanceof Error ? err.message : "unknown error" };
  }
}

/** Text that is embedded and keyword-indexed for a trial. */
export function embeddingText(card: TrialCard): string {
  return [card.title, card.conditions.join(", "), card.summary, card.inclusion.map((c) => c.text).join(" ")].join("\n");
}
