/**
 * Generate eval/labels.json: 30 SYNTHETIC patient profiles (no real people) with provisional
 * relevance labels. Labeling rule per profile is written below and uses only each trial's
 * TITLE + CONDITIONS (independent of the criteria-derived facts and the embeddings being evaluated):
 *   relevant = passes hard filters AND title/conditions match `rel` AND do not match `not`
 *   excluded = passes hard filters AND title/conditions match `not` (clear mismatch for this profile)
 * Run once: `npx tsx scripts/eval/make-labels.ts`; labels are committed and reviewed.
 */
import { writeFileSync } from "node:fs";
import type { IntakeAnswers } from "../../lib/types/intake";
import { getCatalog } from "../../config/questionnaire";
import type { AnswerValue, QuestionnaireState } from "../../lib/types/questionnaire";
import { nearestSite, passesAge, passesDistance, passesGroup } from "../../lib/match/filters";
import type { Site, TrialCard } from "../../lib/types/trial";
import type { LatLon } from "../../lib/geo/distance";
import { loadSeedCards, loadZip, zipCentroid } from "./common";

/** x = written extra v2 answers for the profile ("unknown" = the synthetic patient does not know). */
export type P = { id: string; note: string; a: IntakeAnswers; rel: RegExp; not?: RegExp; x?: Record<string, AnswerValue> };
const base = { language: "en", pregnant: "no", inAnotherTrial: "no" } as const;
const A = (o: Partial<IntakeAnswers> & Pick<IntakeAnswers, "cancerType" | "zip" | "age">): IntakeAnswers => ({
  travelMiles: 250, spread: "not_sure", treatments: ["not_sure"], biomarkers: {}, ...base, ...o,
});

export const PROFILES: P[] = [
  { id: "p01", note: "HER2+ metastatic breast, prior chemo, Boston", a: A({ cancerType: "breast", zip: "02115", age: 52, spread: "yes", treatments: ["chemotherapy"], biomarkers: { HER2: "positive" } }), rel: /breast/i, not: /HER2[- ]?(negative|-)|triple|TNBC|HR\+\/HER2-/i, x: { daily_activity: "0-1", disease_status: "recurrent" } },
  { id: "p02", note: "Triple-negative breast, Houston", a: A({ cancerType: "breast", zip: "77030", age: 44, spread: "yes", biomarkers: { HER2: "negative", HR: "negative" } }), rel: /breast/i, not: /HER2[- ]?positive|HER2\+|HR[- ]?positive|HR\+/i, x: { daily_activity: "unknown", disease_status: "on_treatment" } },
  { id: "p03", note: "HR+/HER2- breast, Chicago, 500 mi", a: A({ cancerType: "breast", zip: "60611", age: 63, travelMiles: 500, biomarkers: { HR: "positive", HER2: "negative" } }), rel: /breast/i, not: /HER2[- ]?positive|HER2\+|triple|TNBC/i, x: { daily_activity: "0-1", sex: "female" } },
  { id: "p04", note: "Early breast, newly diagnosed, NYC", a: A({ cancerType: "breast", zip: "10032", age: 38, spread: "no", treatments: ["none"] }), rel: /breast/i, not: /metastatic|advanced/i, x: { disease_status: "new", daily_activity: "0-1", sex: "female" } },
  { id: "p05", note: "EGFR+ NSCLC, prior targeted, LA area", a: A({ cancerType: "lung", zip: "94143", age: 67, travelMiles: 500, spread: "yes", treatments: ["targeted_therapy"], biomarkers: { EGFR: "positive" } }), rel: /non-small|NSCLC/i, not: /(?<!non-)(?<!non )small cell lung|\bSCLC\b|mesothelioma/i, x: { daily_activity: "2", disease_status: "recurrent", brain_mets: "unknown" } },
  { id: "p06", note: "Small cell lung, Ohio", a: A({ cancerType: "lung", zip: "44195", age: 70, travelMiles: 500 }), rel: /(?<!non-)(?<!non )small cell|\bSCLC\b|extensive[- ]stage/i, not: /NSCLC|non-small|mesothelioma/i, x: { daily_activity: "2", disease_status: "new" } },
  { id: "p07", note: "Advanced NSCLC after immunotherapy, Philadelphia", a: A({ cancerType: "lung", zip: "19104", age: 61, spread: "yes", treatments: ["immunotherapy", "chemotherapy"] }), rel: /lung|NSCLC/i, not: /\bSCLC\b|mesothelioma/i, x: { disease_status: "recurrent", daily_activity: "0-1" } },
  { id: "p08", note: "Lung cancer, not sure of details, Atlanta", a: A({ cancerType: "lung", zip: "30322", age: 58, travelMiles: 500 }), rel: /lung|NSCLC|SCLC/i, x: {} },
  { id: "p09", note: "Metastatic colorectal, KRAS+, Minnesota", a: A({ cancerType: "colorectal", zip: "55905", age: 59, travelMiles: 500, spread: "yes", treatments: ["chemotherapy"], biomarkers: { KRAS: "positive" } }), rel: /colorectal|colon|rectal/i, not: /anal|KRAS wild/i, x: { disease_status: "on_treatment", daily_activity: "0-1" } },
  { id: "p10", note: "Rectal cancer, newly diagnosed, Durham", a: A({ cancerType: "colorectal", zip: "27710", age: 47, spread: "no", treatments: ["none"] }), rel: /rect|colorectal/i, not: /metastatic|anal/i, x: { disease_status: "new" } },
  { id: "p11", note: "Colorectal, MSI-high, Seattle", a: A({ cancerType: "colorectal", zip: "98109", age: 55, travelMiles: 500, biomarkers: { "MSI-H": "positive" } }), rel: /colorectal|colon|rectal/i, not: /anal/i, x: { daily_activity: "unknown" } },
  { id: "p12", note: "Metastatic castration-resistant prostate, Dallas/Houston", a: A({ cancerType: "prostate", zip: "77030", age: 72, spread: "yes", treatments: ["surgery", "radiation"] }), rel: /prostat/i, not: /localized|low[- ]risk|active surveillance/i, x: { group_status: "crpc", daily_activity: "0-1", sex: "male" } },
  { id: "p13", note: "Localized prostate, St. Louis", a: A({ cancerType: "prostate", zip: "63110", age: 66, travelMiles: 500, spread: "no", treatments: ["none"] }), rel: /prostat/i, not: /metastatic|castration/i, x: { group_status: "cspc", sex: "male", disease_status: "new" } },
  { id: "p14", note: "Prostate, BRCA+, Baltimore", a: A({ cancerType: "prostate", zip: "21287", age: 69, biomarkers: { BRCA: "positive" } }), rel: /prostat/i, x: { sex: "male" } },
  { id: "p15", note: "AML, FLT3+, Houston", a: A({ cancerType: "leukemia", zip: "77030", age: 64, biomarkers: { FLT3: "positive" } }), rel: /acute myeloid|AML|leukemia/i, not: /chronic lymphocytic|\bCLL\b|acute lymphoblastic|\bALL\b/i, x: { daily_activity: "0-1", disease_status: "new" } },
  { id: "p16", note: "CLL, Columbus/Ohio, 500 mi", a: A({ cancerType: "leukemia", zip: "44195", age: 71, travelMiles: 500 }), rel: /chronic lymphocytic|\bCLL\b|leukemia/i, not: /acute myeloid|\bAML\b/i, x: { daily_activity: "0-1" } },
  { id: "p17", note: "Relapsed ALL adult, LA", a: A({ cancerType: "leukemia", zip: "90095", age: 34, treatments: ["chemotherapy"] }), rel: /lymphoblastic|\bALL\b|leukemia/i, not: /chronic lymphocytic|\bCLL\b/i, x: { disease_status: "recurrent", daily_activity: "0-1" } },
  { id: "p18", note: "Relapsed DLBCL, NYC", a: A({ cancerType: "lymphoma", zip: "10032", age: 60, treatments: ["chemotherapy", "immunotherapy"] }), rel: /lymphoma|DLBCL/i, x: { disease_status: "recurrent", daily_activity: "unknown" } },
  { id: "p19", note: "Hodgkin lymphoma young adult, Denver", a: A({ cancerType: "lymphoma", zip: "80045", age: 26, travelMiles: 500 }), rel: /lymphoma|hodgkin/i, x: { disease_status: "new" } },
  { id: "p20", note: "Relapsed multiple myeloma, Rochester MN", a: A({ cancerType: "myeloma", zip: "55905", age: 68, treatments: ["chemotherapy", "targeted_therapy"] }), rel: /myeloma/i, not: /newly diagnosed/i, x: { disease_status: "recurrent", daily_activity: "0-1" } },
  { id: "p21", note: "Newly diagnosed myeloma, Nashville", a: A({ cancerType: "myeloma", zip: "37232", age: 62, travelMiles: 500, treatments: ["none"] }), rel: /myeloma/i, not: /relapsed|refractory/i, x: { disease_status: "new", daily_activity: "0-1" } },
  { id: "p22", note: "BRAF+ metastatic melanoma, Phoenix", a: A({ cancerType: "melanoma", zip: "85054", age: 57, travelMiles: 500, spread: "yes", biomarkers: { BRAF: "positive" } }), rel: /melanoma/i, x: { daily_activity: "0-1", brain_mets: "none" } },
  { id: "p23", note: "Melanoma after immunotherapy, Ann Arbor", a: A({ cancerType: "melanoma", zip: "48109", age: 49, travelMiles: 500, treatments: ["immunotherapy"] }), rel: /melanoma/i, x: { disease_status: "recurrent" } },
  { id: "p24", note: "Metastatic pancreatic, Miami", a: A({ cancerType: "pancreatic", zip: "33136", age: 66, travelMiles: 500, spread: "yes", treatments: ["chemotherapy"] }), rel: /pancrea/i, not: /resectable(?! .*(un|borderline))|neuroendocrine/i, x: { daily_activity: "2", disease_status: "on_treatment" } },
  { id: "p25", note: "Pancreatic, BRCA+, New Orleans, anywhere", a: A({ cancerType: "pancreatic", zip: "70112", age: 58, travelMiles: null, biomarkers: { BRCA: "positive" } }), rel: /pancrea/i, not: /neuroendocrine/i, x: {} },
  { id: "p26", note: "Platinum-resistant ovarian, Salt Lake City, anywhere", a: A({ cancerType: "ovarian", zip: "84112", age: 61, travelMiles: null, treatments: ["chemotherapy", "surgery"] }), rel: /ovar|fallopian|peritoneal/i, x: { group_status: "platinum_resistant", sex: "female" } },
  { id: "p27", note: "Ovarian BRCA+, Boston", a: A({ cancerType: "ovarian", zip: "02115", age: 54, biomarkers: { BRCA: "positive" } }), rel: /ovar|fallopian|peritoneal/i, x: { sex: "female", disease_status: "new" } },
  { id: "p28", note: "Recurrent glioblastoma, San Francisco", a: A({ cancerType: "brain", zip: "94143", age: 55, travelMiles: 500, treatments: ["surgery", "radiation", "chemotherapy"] }), rel: /glioblastoma|glioma|GBM/i, not: /newly diagnosed|pediatric/i, x: { disease_status: "recurrent", daily_activity: "2" } },
  { id: "p29", note: "IDH-mutant glioma, Durham, anywhere", a: A({ cancerType: "brain", zip: "27710", age: 39, travelMiles: null, biomarkers: { IDH: "positive" } }), rel: /glioma|astrocytoma|oligodendroglioma|glioblastoma/i, not: /IDH[- ]?wild/i, x: {} },
  { id: "p30", note: "Metastatic urothelial (bladder), Spanish speaker, Houston", a: A({ cancerType: "bladder", zip: "77030", age: 73, travelMiles: 500, language: "es", spread: "yes", treatments: ["chemotherapy"] }), rel: /urothelial|bladder/i, not: /non[- ]muscle|NMIBC|BCG/i, x: { disease_status: "on_treatment", daily_activity: "0-1" } },
  // v2 additions (QUESTIONNAIRE_SPEC §7.3): groups and answers the first 30 profiles do not exercise.
  { id: "p31", note: "RAI-refractory thyroid, Boston", a: A({ cancerType: "thyroid", zip: "02115", age: 63, travelMiles: 500, spread: "yes", treatments: ["surgery", "radiation"], biomarkers: { BRAF: "positive" } }), rel: /thyroid/i, not: /anaplastic|medullary/i, x: { group_status: "rai_refractory", daily_activity: "0-1" } },
  { id: "p32", note: "Hepatocellular carcinoma, unsure of biomarkers, Houston", a: A({ cancerType: "liver", zip: "77030", age: 66, travelMiles: 500, spread: "yes" }), rel: /hepatocellular|\bHCC\b|liver/i, not: /cholangio|biliary|gallbladder/i, x: { daily_activity: "2", disease_status: "on_treatment" } },
  { id: "p33", note: "Biliary tract cancer, Rochester MN", a: A({ cancerType: "liver", zip: "55905", age: 58, travelMiles: 500, spread: "yes", treatments: ["chemotherapy"] }), rel: /cholangio|biliary|gallbladder/i, not: /hepatocellular|\bHCC\b/i, x: { daily_activity: "0-1" } },
  { id: "p34", note: "HER2+ gastroesophageal, New York", a: A({ cancerType: "gastroesophageal", zip: "10032", age: 61, travelMiles: 500, spread: "yes", treatments: ["chemotherapy"], biomarkers: { HER2: "positive" } }), rel: /gastric|stomach|esophag|gastroesophageal|GEJ/i, x: { daily_activity: "0-1", disease_status: "recurrent" } },
  { id: "p35", note: "EGFR+ NSCLC with brain metastases, Houston", a: A({ cancerType: "lung", zip: "77030", age: 55, travelMiles: 500, spread: "yes", treatments: ["targeted_therapy"], biomarkers: { EGFR: "positive" } }), rel: /non-small|NSCLC/i, not: /(?<!non-)(?<!non )small cell lung|\bSCLC\b|mesothelioma/i, x: { brain_mets: "treated_stable", daily_activity: "0-1", disease_status: "recurrent" } },
  { id: "p36", note: "Small cell lung, ECOG 2, Cleveland", a: A({ cancerType: "lung", zip: "44195", age: 72, travelMiles: 500, spread: "yes", treatments: ["chemotherapy"] }), rel: /(?<!non-)(?<!non )small cell|\bSCLC\b|extensive[- ]stage/i, not: /NSCLC|non-small|mesothelioma/i, x: { daily_activity: "2", disease_status: "on_treatment" } },
  { id: "p37", note: "mCRPC after one hormone drug, ECOG unknown, Dallas/Houston", a: A({ cancerType: "prostate", zip: "77030", age: 74, travelMiles: 500, spread: "yes", treatments: ["surgery", "radiation"] }), rel: /prostat/i, not: /localized|low[- ]risk|active surveillance/i, x: { group_status: "crpc", daily_activity: "unknown", sex: "male", disease_status: "recurrent" } },
  { id: "p38", note: "Platinum-resistant ovarian, BRCA unknown, Salt Lake City", a: A({ cancerType: "ovarian", zip: "84112", age: 64, travelMiles: null, treatments: ["chemotherapy", "surgery"], biomarkers: { BRCA: "dont_know" } }), rel: /ovar|fallopian|peritoneal/i, x: { group_status: "platinum_resistant", sex: "female", daily_activity: "0-1" } },
  { id: "p39", note: "AML FLT3+, ECOG 2, Houston", a: A({ cancerType: "leukemia", zip: "77030", age: 69, travelMiles: 500, treatments: ["chemotherapy"], biomarkers: { FLT3: "positive" } }), rel: /acute myeloid|AML|leukemia/i, not: /chronic lymphocytic|\bCLL\b|acute lymphoblastic|\bALL\b/i, x: { daily_activity: "2", disease_status: "recurrent" } },
  { id: "p40", note: "Relapsed myeloma, many treatments, Nashville", a: A({ cancerType: "myeloma", zip: "37232", age: 70, travelMiles: 500, treatments: ["chemotherapy", "targeted_therapy", "immunotherapy"] }), rel: /myeloma/i, not: /newly diagnosed/i, x: { disease_status: "recurrent", daily_activity: "unknown" } },
];

/** Hand-checkable v2 state from a profile's legacy answers plus its written extras. */
export function stateFor(p: P): QuestionnaireState {
  const a = p.a;
  const catalog = getCatalog("cancer", a.cancerType);
  const grid = new Set(catalog.find((q) => q.id === "biomarkers")?.biomarkers ?? []);
  const answers: Record<string, AnswerValue> = { cancer_type: a.cancerType, age: a.age, zip: a.zip, travel: a.travelMiles };
  answers.spread = a.spread === "yes" ? "distant" : a.spread === "no" ? "not_spread" : "unknown";
  answers.treatments = a.treatments.includes("not_sure") ? ["unknown"] : a.treatments;
  const bm: Record<string, string> = {};
  for (const [m, v] of Object.entries(a.biomarkers)) if (grid.has(m as never)) bm[m] = v === "dont_know" ? "unknown" : (v as string);
  if (Object.keys(bm).length) answers.biomarkers = bm;
  Object.assign(answers, p.x ?? {});
  for (const [k, v] of Object.entries(p.x ?? {})) {
    const q = catalog.find((c) => c.id === k);
    if (!q) throw new Error(`${p.id}: unknown question ${k} for ${a.cancerType}`);
    if (typeof v === "string" && !(q.options ?? []).some((o) => o.id === v)) throw new Error(`${p.id}: bad option ${v} for ${k}`);
  }
  return { v: 2, area: "cancer", mode: "thorough", answers, history: Object.keys(answers), deferred: [], updatedAt: 1 };
}

/** Title + conditions text the label rules read (never the criteria facts or embeddings under test). */
const labelText = (c: Pick<TrialCard, "title" | "conditions">) => `${c.title} ${c.conditions.join(" ")}`;

/** Relevant / excluded ids for one profile over any trial set (seed or national): same written rules. */
export function labelProfile(p: P, cards: readonly TrialCard[], sites: ReadonlyMap<string, Site[]>, origin: LatLon | null) {
  const pass = cards.filter((c) => passesGroup(c, p.a.cancerType) && passesAge(c, p.a.age) && passesDistance(nearestSite(sites.get(c.id) ?? [], origin), origin ? p.a.travelMiles : null));
  const relevant = pass.filter((c) => p.rel.test(labelText(c)) && !(p.not && p.not.test(labelText(c)))).map((c) => c.id);
  const excluded = p.not ? pass.filter((c) => p.not?.test(labelText(c))).map((c) => c.id) : [];
  return { relevant, excluded, candidates: pass.length };
}

if (process.argv[1]?.endsWith("make-labels.ts")) {
  const zips = loadZip();
  const { cards, sites } = loadSeedCards(zips);
  const labels = PROFILES.map((p) => {
    const origin = zipCentroid(zips, p.a.zip);
    // Seed labels keep the original behaviour (the distance limit applies even when the ZIP is unknown).
    const pass = cards.filter((c) => passesGroup(c, p.a.cancerType) && passesAge(c, p.a.age) && passesDistance(nearestSite(sites.get(c.id) ?? [], origin), p.a.travelMiles));
    const relevant = pass.filter((c) => p.rel.test(labelText(c)) && !(p.not && p.not.test(labelText(c)))).map((c) => c.id);
    const excluded = p.not ? pass.filter((c) => p.not?.test(labelText(c))).map((c) => c.id) : [];
    return { id: p.id, note: p.note, answers: p.a, state: stateFor(p), relevant, excluded, candidates: pass.length };
  });
  for (const l of labels) console.log(`${l.id} ${l.note.padEnd(55)} candidates=${l.candidates} relevant=${l.relevant.length} excluded=${l.excluded.length}`);
  writeFileSync(
    "eval/labels.json",
    JSON.stringify({ schema: 2, note: "SYNTHETIC, PROVISIONAL. Schema v2: 40 synthetic patient profiles (not real people), each with legacy `answers` (v1 pipeline) and a written v2 questionnaire `state`. Relevance labels from per-profile title/condition rules (scripts/eval/make-labels.ts) over the committed ClinicalTrials.gov seed; not clinician-reviewed.", generatedAt: new Date().toISOString().slice(0, 10), profiles: labels }, null, 1),
  );
}
