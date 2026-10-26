/**
 * Deterministic per-criterion resolver. Each split criterion item (lib/ingest/criteria-split.ts) is run
 * through the rule fact extractor ON ITS OWN, and the facts are compared with the patient's questionnaire answers:
 *   inclusion -> "met" | "not_met" | "unknown";  exclusion -> "excluded" | "not_excluded" | "unknown".
 * Only these facts settle an item: age, sex, cancer group/subtype (histology), ECOG, prior lines / treated status,
 * brain metastases, measurable disease, biomarkers, other malignancy and the health-history answers: HIV,
 * hepatitis B/C, organ transplant, donor stem cell transplant, autoimmune disease, kidney/liver/heart disease,
 * pregnancy and another treatment trial (exclusion items only). Everything else stays "unknown" for the LLM judge, and so does:
 *  - any fact whose question was answered "don't know", skipped, deferred or never asked (never "not_met");
 *  - items with a cohort/arm scope, real alternatives ("X or Y") in inclusion, or a time window the answers can't settle;
 *  - positive labels (met / not_excluded) when the item says more than the facts we checked (residual content).
 * Pure and synchronous; no I/O, no LLM.
 */
import { BIOMARKERS } from "@/config/biomarkers";
import { factPolicy } from "@/config/questionnaire/fact-policy";
import { MARKER_QUALIFIER } from "../marker-qualifier";
import { cohortSpecific } from "@/lib/ingest/eligibility-facts";
import { factsForCriterion, preciseTreatedExclusion } from "@/lib/ingest/facts";
import type { SplitCriterion } from "@/lib/ingest/criteria-split";
import { canonicalGene } from "@/lib/ingest/synonyms";
import type { CriterionLabel, CriterionLabelValue, TrialCriteriaLabels } from "@/lib/types/criteria";
import type { FactKey, TrialCard } from "@/lib/types/trial";
import type { ResolverProfile, ResolveContext } from "./profile";
import { type Verdict, type Checked, isHistoryKey, allowedKey, checkFact, sourcesOf, hasAttr } from "./facts";
import { checkAge, checkSex, checkCancerType } from "./demographics";
import { STAGE_MET, STAGE_ADVANCED, STAGE_EARLY, checkStage } from "./stage";
import { TREATMENT_SPECIFIC, checkTreated } from "./treated";
import { EXCLUSION_QUALIFIERS, ASSESSMENT_WINDOW, STAGE_LABEL, EXTRACT_COLLAPSE, REGISTRATION_HEADER, TIME_WINDOW, hasAlternatives, residualWords, MAX_RESIDUAL, mentionsDrug, normalizeMarkers, UNTREATED_NON_CANCER, CARVE_OUT, SUBGROUP_RULE, PHASE_COHORT, PERMISSIVE_ITEM, msiDirection } from "./text";
import { negatedMarkers, allAlternativesFail } from "./markers";

/** A resolver label. `questions` = questionnaire ids the verdict rests on (the LLM judge numbers answers A1..An). */
interface ResolvedLabel extends CriterionLabel {
  source: "rule" | "default";
  questions?: string[];
}

const label = (item: SplitCriterion, value: CriterionLabelValue, reason: string, questions: readonly string[] = [], ctx?: ResolveContext): ResolvedLabel => {
  const out: ResolvedLabel = { id: item.id, section: item.section, label: value, source: value === "unknown" ? "default" : "rule", reason };
  if (questions.length) {
    out.questions = [...new Set(questions)];
    const ids = ctx?.answerIds ? out.questions.map((q) => ctx.answerIds?.[q]).filter((x): x is string => !!x) : [];
    if (ids.length) out.answerIds = ids;
  }
  return out;
};

const FAIL_REASON: Record<string, string> = {
  age: "Your age is outside the age range for this rule.",
  stage: "Your answer about how far the cancer has spread does not fit this rule.",
  treated: "Your answers about past treatment do not fit this rule.",
  sex: "This rule is for a different sex.",
  ecog_max: "Your daily activity level is outside what this rule allows.",
  min_prior_lines: "This rule needs more past treatments than you reported.",
  max_prior_lines: "This rule allows fewer past treatments than you reported.",
  previously_treated: "Your answers about past treatment do not fit this rule.",
  newly_diagnosed: "Your answers about past treatment do not fit this rule.",
  brain_mets: "Your answer about cancer in the brain does not fit this rule.",
  measurable_disease: "Your answer about measurable disease does not fit this rule.",
  other_malignancy: "Your answer about other cancers does not fit this rule.",
  hiv: "Your answer about HIV does not fit this rule.",
  hepatitis_b: "Your answer about hepatitis does not fit this rule.",
  hepatitis_c: "Your answer about hepatitis does not fit this rule.",
  organ_transplant: "Your answer about transplants does not fit this rule.",
  allo_sct: "Your answer about transplants does not fit this rule.",
  autoimmune: "Your answer about autoimmune disease does not fit this rule.",
  kidney_disease: "Your answer about kidney problems does not fit this rule.",
  liver_disease: "Your answer about liver problems does not fit this rule.",
  heart_disease: "Your answer about heart problems does not fit this rule.",
  pregnancy: "This rule is about pregnancy or breastfeeding.",
  concurrent_trial: "This rule is about being in another treatment study.",
};
const failReason = (key: string) => FAIL_REASON[key] ?? (key.startsWith("biomarker:") ? `Your ${key.slice(10)} test result does not fit this rule.` : "Your cancer subtype does not fit this rule.");

/** The item really names another cancer (the extractor also fires on "prior treatment with a cancer vaccine"). */
const OTHER_CANCER_WORDS = /\bmalignan\w*|\b(?:other|another|second|additional|concurrent|synchronous|separate|prior|previous)\s+(?:\w+\s+){0,2}(?:cancers?|tumou?rs?|neoplasms?|carcinomas?)\b(?!\s+(?:vaccine|therapy|treatment|drug))/i;
/** "ECOG = 3": an exact value, which the extractor reads as a ceiling. */
const ECOG_EXACT = /(?:^|[^<>=\u2264\u2265])=\s*[1-4]\b(?!\s*-)/;
/** "Known BRAF mutational status", "documented PD-L1 status": the result must be known, not positive. */
const MARKER_STATUS_ONLY = /\b(?:known|documented|available|determined|confirmed|tested|testing|evaluable|results? of)\s+(?:\w+\s+){0,3}?status\b(?![^.;]{0,40}\b(?:positive|negative|mutant|mutated|mutations?|amplif\w*|express\w*|wild[- ]?type|deficien\w*|rearrang\w*|fusion|high|low|\+|-)\b)/i;
/** Activity, control or test wording on a health-history item that a yes/no answer does not settle. */
const HISTORY_QUALIFIER = /\b(?:active|uncontrolled|untreated|unresolved|requiring|detectable|undetectable|viral load|RNA|DNA|HBsAg|antibod\w*|antigen|on (?:antiviral |antiretroviral )?treatment|receiving|positive test|positive for|seropositiv\w*|within|in the (?:last|past))\b/i;
/** A plain subtype statement ("histologically confirmed non-squamous NSCLC"), where the patient's subtype answer applies. */
const HISTOLOGY_ITEM = /\b(?:histolog\w*|cytolog\w*|patholog\w*|confirmed|diagnos\w*|documented|proven|biopsy)\b/i;
const TREATED_KEYS = new Set(["previously_treated", "newly_diagnosed", "min_prior_lines", "max_prior_lines"]);
const STAGE_KEYS = new Set(["metastatic", "locally_advanced", "adjuvant_setting"]);
/**
 * A rule addressed to a subgroup ("ER/PR+ patients must be refractory to...", "Patients with brain metastases
 * must be stable..."): it sets a condition for that subgroup, so the subgroup's own fact never fails the patient
 * (TREC 2021-61, NCT01677455: an HR-negative patient was excluded by an ER/PR+ condition).
 */
/** Sub-bullets labeled by a population ("- NSCLC: ...", "- Cohort B: ..."). */
const SUB_LABELS = (text: string) => (text.match(/(?:^|\s)[-*\u2022]\s+[A-Za-z0-9][A-Za-z0-9 /()+-]{0,40}:/g) ?? []).length;
/** A comma list naming three or more markers or genes ("BRCA2, PALB2, BRCA1, ATM"): options, not all required. */
function markerList(text: string): boolean {
  if ((text.match(/,/g) ?? []).length < 2) return false;
  const seen = new Set<string>();
  for (const b of BIOMARKERS) if (b.pattern.test(text)) seen.add(b.id);
  for (const w of text.match(/\b[A-Z][A-Z0-9]{2,9}\b/g) ?? []) {
    const g = canonicalGene(w);
    if (g) seen.add(g);
  }
  return seen.size >= 3;
}

/**
 * MSI status words. MSI-H, MSI-high and dMMR name the positive state of our "MSI-H / dMMR" marker on their own; MSS,
 * microsatellite stable, pMMR and MSI-low name the negative state, which the shared extractor does not read (seen as an MSS
 * trial ranked #1 for an MSI-high answer). Negative wording is matched first and removed, so
 * "non-MSI-H" and "not MSI-H" read as negative.
 */

/** Conditions the patient can plainly lack, and the check that they do (a definite "no" answer, not an unknown). */
const LACKS_KEYS = new Set(["hiv", "hepatitis_b", "hepatitis_c", "organ_transplant", "allo_sct", "autoimmune", "kidney_disease", "liver_disease", "heart_disease", "pregnancy", "concurrent_trial", "brain_mets", "other_malignancy"]);
/** "measurable ... in the liver / outside the CNS / not previously irradiated": a location or lesion detail the answers do not give. */
const MEASURABLE_WHERE = /\b(?:irradiated|radiated|outside|inside|extracranial|intracranial|cns|brain|liver|lung|bone|nodal|lymph|skin|site|sites|located|within the|in the|in a|in at least)\b/i;
/** "or active systemic viral disease or active severe infection": an infection the hepatitis and HIV answers do not cover. */
const OTHER_INFECTION = /\b(?:other|any|systemic|severe|serious|bacterial|fungal|uncontrolled|intercurrent)\s+(?:\w+\s+)?(?:viral\s+)?(?:infections?|viral disease)\b|\bviral disease\b/i;
/** "nursing home resident" is not about pregnancy: the item must say so itself. */
const PREGNANCY_WORDS = /pregnan|breast-?\s?feed|lactat|child-?bearing/i;
function lacks(key: string, p: ResolverProfile): boolean {
  if (key === "brain_mets") return p.brainMets === "none";
  if (key === "other_malignancy") return p.otherCancer === "no";
  return hasAttr(key, p) === false;
}

/** Label one criterion item. Pure. */
export function resolveItem(item: SplitCriterion, p: ResolverProfile, ctx: ResolveContext): ResolvedLabel {
  const incl = item.section === "inclusion";
  const body = item.text.replace(REGISTRATION_HEADER, "").replace(STAGE_LABEL, "");
  if (item.scope || cohortSpecific(body) || PHASE_COHORT.test(body) || SUB_LABELS(body) >= 2) return label(item, "unknown", "Applies only to one group in the study.");
  // "one-line of therapy" -> "one line of therapy" so the line-count parser sees the unit.
  const text = normalizeMarkers(body).replace(/\b(\d+|one|two|three|four)-(lines?|regimens?)\b/gi, "$1 $2");
  let factText = text;
  for (const [re, to] of EXTRACT_COLLAPSE) factText = factText.replace(re, to);
  const facts = factsForCriterion(item.section, factText, { v2: true, groups: ctx.groups, ...(ctx.conditions ? { conditions: ctx.conditions } : {}) });
  const msi = msiDirection(item.section, text);
  if (msi) {
    const i = facts.findIndex((f) => f.key === "biomarker:MSI-H");
    if (i < 0) facts.push({ key: "biomarker:MSI-H", value: msi });
    else if (facts[i]?.value === "mentioned") facts[i] = { ...facts[i], key: "biomarker:MSI-H", value: msi };
  }
  // "without EGFR, ALK, or ROS1 alterations": every listed marker must be absent.
  const { keys: negated, altText } = negatedMarkers(item.section, text);
  for (const key of negated as FactKey[]) {
    const i = facts.findIndex((f) => f.key === key);
    if (i < 0) facts.push({ key, value: "excluded" });
    else facts[i] = { ...facts[i], key, value: "excluded" };
  }
  const directional = facts.filter((f) => f.value !== "mentioned");
  const checks: Checked[] = [];
  const treatedCheck = checkTreated(text, p, item.section);
  const stageCheck = checkStage(text, p, item.section);
  for (const c of [checkAge(text, p, item.section), checkSex(text, p, item.section), incl ? checkCancerType(text, p, ctx.groups) : null, stageCheck, treatedCheck]) if (c) checks.push(c);
  const untreatedOther = UNTREATED_NON_CANCER.test(text);
  const carveOut = CARVE_OUT.test(text);
  for (const f of directional) {
    if (!allowedKey(f.key)) continue;
    // The item's own treated-status reading (checkTreated) replaces the whole-trial fact for these keys.
    if (treatedCheck && (f.key === "previously_treated" || f.key === "newly_diagnosed")) continue;
    // "untreated brain metastases / lesion / infection" is not about treatment history; carve-outs ("unless",
    // "adjuvant therapy is permitted") are not modeled for treated status and line counts.
    const loose =
      SUBGROUP_RULE.test(text) ||
      (TREATED_KEYS.has(f.key) && (untreatedOther || carveOut)) ||
      (f.key === "other_malignancy" && !OTHER_CANCER_WORDS.test(text)) ||
      (f.key === "ecog_max" && ECOG_EXACT.test(text)) ||
      (f.key.startsWith("biomarker:") && !negated.includes(f.key) && MARKER_QUALIFIER.test(text)) ||
      // "Known BRAF mutational status": a test result must exist, either way.
      (f.key.startsWith("biomarker:") && MARKER_STATUS_ONLY.test(text));
    let verdict: Verdict = loose || (incl && isHistoryKey(f.key)) ? "open" : checkFact(f, p);
    // "Active hepatitis B without antiviral treatment", "HCV RNA positive": activity or test detail a yes/no answer
    // does not give, so a reported infection never fails the item (a reported "no" still clears it).
    if (verdict === "fail" && (f.key === "hepatitis_b" || f.key === "hepatitis_c" || f.key === "hiv") && f.param === undefined && HISTORY_QUALIFIER.test(text)) verdict = "open";
    // Health-history facts settle exclusion items only (inclusion wording about them is conditional, and inclusion
    // pregnancy items ask for a test or contraception that "not pregnant" alone does not meet).
    checks.push({ key: f.key, verdict, questions: sourcesOf(f.key, p) });
  }
  // Stage facts of the whole-trial extractor are explained by the item's own stage reading.
  // Stage facts of the whole-trial extractor are explained by the item's own stage reading, or name the setting of a
  // treatment-history rule ("prior therapy for metastatic disease").
  const outside = directional.filter((f) => !allowedKey(f.key) && !(STAGE_KEYS.has(f.key) && (stageCheck || treatedCheck || STAGE_MET.test(text) || STAGE_ADVANCED.test(text) || STAGE_EARLY.test(text))));
  const alternatives = hasAlternatives(altText) || markerList(altText);
  // "EGFR mutation or ALK rearrangement": the whole-item extractor demotes markers next to "or", so options are
  // checked one by one here; the item is not met only when every option fails on a checked fact.
  const everyOptionFails = incl && alternatives && !PERMISSIVE_ITEM.test(text) && !TIME_WINDOW.test(text.replace(ASSESSMENT_WINDOW, " ")) && allAlternativesFail(altText, p, ctx);
  if (everyOptionFails) return label(item, "not_met", "None of the options in this rule fit your answers.", checks.flatMap((c) => c.questions), ctx);
  if (checks.length === 0) return label(item, "unknown", "Our questions do not cover this rule.");

  // An exclusion the patient lacks outright: "pregnant or nursing", "active autoimmune disease requiring treatment within 2 years".
  // Windows, carve-outs and "or" lists only narrow the condition, so a definite "no" settles it, provided every content
  // word is covered by the checked facts (an unchecked alternative such as "or chronic steroids" keeps the item unknown).
  if (!incl && checks.length > 0 && outside.length === 0 && !/:\s*$/.test(text) && !mentionsDrug(text) && checks.every((c) => c.verdict === "ok" && LACKS_KEYS.has(c.key) && lacks(c.key, p)) && (!checks.some((c) => c.key === "pregnancy") || PREGNANCY_WORDS.test(text)) && !OTHER_INFECTION.test(text)) {
    // Reasons ("because of ... the fetus"), examples in brackets and later carve-out sentences ("Patients with treated ... may
    // participate") do not add conditions.
    const [firstSentence = "", ...later] = text.replace(/\b(?:because|due to|since)\b[^.]*/i, " ").replace(/\([^()]*\)/g, " ").split(/(?<=[.;])\s+/);
    const reduced = [firstSentence, ...later.filter((x) => !CARVE_OUT.test(x) && !/^\W*note\b/i.test(x))].join(" ");
    // The facts must come from the condition itself, not from a carve-out sentence that names them ("patients with HIV may be eligible if...").
    let reducedFactText = reduced;
    for (const [re, to] of EXTRACT_COLLAPSE) reducedFactText = reducedFactText.replace(re, to);
    const reducedKeys = new Set<string>(factsForCriterion(item.section, reducedFactText, { v2: true, groups: ctx.groups, ...(ctx.conditions ? { conditions: ctx.conditions } : {}) }).map((f) => f.key));
    if (checks.every((c) => reducedKeys.has(c.key)) && residualWords(reduced, p, checks.map((c) => c.key), EXCLUSION_QUALIFIERS).length === 0) {
      return label(item, "not_excluded", "Your answers say this does not apply to you.", checks.flatMap((c) => c.questions), ctx);
    }
  }

  // A time window our answers can't settle ("within 4 weeks"); the other-cancer years window is settled by checkFact.
  const window = TIME_WINDOW.test(text.replace(ASSESSMENT_WINDOW, " ")) && !checks.every((c) => c.key === "other_malignancy");
  if (window) return label(item, "unknown", "Depends on dates your answers do not include.");

  // Policy gate: families below the precision gate never create a hard failure.
  // Line counts: a plain count (the extractor already demotes class-specific and conditional counts to "mentioned")
  // with no carve-out or option wording is settled by the lines answer.
  const linesPrecise = !carveOut && !PERMISSIVE_ITEM.test(text) && !SUBGROUP_RULE.test(text);
  // Histology (a family below the whole-trial precision gate): the patient's own subtype answer settles a plain
  // "histologically confirmed <subtype>" item. Health-history families below the gate settle a plain exclusion
  // (no carve-out, no time or activity qualifier) when the patient reports the condition.
  const histologyPrecise = HISTOLOGY_ITEM.test(text) && !carveOut;
  const historyPrecise = !incl && !carveOut;
  const fails = checks.filter((c) => c.verdict === "fail" && (c.key === "age" || c.key === "sex" || c.key === "cancer_type" || c.key === "stage" || c.key === "treated" || (factPolicy(c.key).penalize && !factPolicy(c.key).belowGate) || (c.key === "previously_treated" && preciseTreatedExclusion(item.section, text) && !TREATMENT_SPECIFIC.test(text) && !mentionsDrug(text)) || ((c.key === "min_prior_lines" || c.key === "max_prior_lines") && linesPrecise) || (c.key.startsWith("histology:") && histologyPrecise) || (isHistoryKey(c.key) && historyPrecise)));
  // Inclusion alternatives: one failing option does not fail the item. Exclusion alternatives are a list of
  // excluding conditions, so any one of them that applies excludes.
  if (fails.length > 0 && !(incl && (alternatives || PERMISSIVE_ITEM.test(text)))) {
    const f = fails[0] as Checked;
    return label(item, incl ? "not_met" : "excluded", failReason(f.key), f.questions, ctx);
  }
  if (alternatives) return label(item, "unknown", "This rule has options we cannot check one by one.");

  // Positive labels: every directional fact is one we checked and fits, nothing else is asked, no drug is named.
  const allOk = checks.every((c) => c.verdict === "ok");
  const mentionedAllowed = facts.some((f) => f.value === "mentioned" && allowedKey(f.key) && !(f.key === "other_malignancy" && !OTHER_CANCER_WORDS.test(text)));
  // Health-history items allow one unexplained word ("significant", "uncontrolled"); an item ending in ":"
  // introduces a list we do not see, so it never gets a positive label.
  const maxResidual = checks.some((c) => c.key === "cancer_type") ? 0 : checks.some((c) => c.key === "measurable_disease") ? (MEASURABLE_WHERE.test(text) ? -1 : 1) : checks.some((c) => isHistoryKey(c.key)) ? 1 : MAX_RESIDUAL;
  if (allOk && !/:\s*$/.test(text) && outside.length === 0 && !mentionedAllowed && !carveOut && !mentionsDrug(text) && residualWords(text, p, checks.map((c) => c.key)).length <= maxResidual) {
    return label(item, incl ? "met" : "not_excluded", incl ? "Your answers fit this rule." : "Your answers say this does not apply to you.", checks.flatMap((c) => c.questions), ctx);
  }
  return label(item, "unknown", "Your answers do not settle this rule.");
}

/** Resolver labels for every split criterion of a trial (resolver-only: provider null). */
export function resolveCriteria(
  card: Pick<TrialCard, "id" | "groups" | "conditions" | "criteria" | "criteriaVersion">,
  profile: ResolverProfile,
  opts: { answerIds?: Readonly<Record<string, string>> } = {},
): TrialCriteriaLabels & { labels: ResolvedLabel[] } {
  const ctx: ResolveContext = { groups: card.groups, conditions: card.conditions, ...(opts.answerIds ? { answerIds: opts.answerIds } : {}) };
  return { trialId: card.id, criteriaVersion: card.criteriaVersion ?? 0, labels: (card.criteria ?? []).map((c) => resolveItem(c, profile, ctx)), provider: null };
}

/** Items the resolver left unknown: what the LLM judge receives. */
export function unresolved(labels: readonly CriterionLabel[]): string[] {
  return labels.filter((l) => l.label === "unknown").map((l) => l.id);
}

export { type ResolverProfile, profileFromState } from "./profile";
export { parseAgeBounds } from "./demographics";
export { hasAlternatives, normalizeMarkers } from "./text";
export { negatedMarkers } from "./markers";
