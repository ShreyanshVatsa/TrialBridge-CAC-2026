/** Item-level checks the fact extractor does not cover: age, sex, cancer type. Part of the criterion resolver (./index.ts). */
import { CANCER_GROUPS, type CancerGroupId } from "@/config/cancer-groups";
import type { SplitCriterion } from "@/lib/ingest/criteria-split";
import { cancerSynonyms } from "@/lib/ingest/synonyms";
import type { ResolverProfile } from "./profile";
import type { Checked } from "./facts";

export const AGE_CONTEXT = /\bage[ds]?\b|\byears? old\b|\byrs? old\b|\bof age\b/i;
export const AGE_NOT_PATIENT = /\bdiagnos|\bonset\b|\bat (?:the )?time of\b|\bchild(?:ren)?'s\b|\bpartner|\bparent|\blife expectancy\b|\bbone age\b|\bgestational\b|\bfor age\b|\bage[- ](?:adjusted|appropriate|specific|related|matched)|\(\s*\d+\s*-\s*age\b|\bif\b|\bmay\b|\ballowed\b|\bpermitted\b|\beligible\b|\bunless\b|\bexcept\b|\bage\s*(?:[<>]=?|[\u2264\u2265]|=<|>=)\s*\d+\s*(?:years?)?\s*:|\b(?:patients?|participants?|subjects?)\s+(?:who are\s+)?(?:aged?\s*)?(?:[<>]=?|[\u2264\u2265]|over|under|older|younger)\s*(?:than\s+)?(?:the age of\s+)?\d+[^.;]{0,30}\b(?:must|should|need|will|are|have)\b|\bQTc?\b|\bweight\b|\bBMI\b|\bcreatinine\b|\bbilirubin\b|\bULN\b/i;
/** The item is about age (not a lab threshold or a list that mentions age in passing). */
export const AGE_LEAD = /^\W*(?:[a-z]\.\s*|\d+\.\s*)?(?:current\s+)?(?:(?:adult|pediatric|male|female|men|women|male or female|female or male|male and female)\s+)?(?:patients?|participants?|subjects?|individuals?|persons?|people|adults?|children|women|men)?\s*(?:must|should|need to|who are|that are|is|are)?\s*(?:be\s+)?(?:aged?|ages|age of|age range|between|[<>]=?|[\u2264\u2265]|=<|=>|\d|less than|greater than|more than|under|over|older than|younger than|at least|minimum age)/i;

/** "18 years and older" / "18 or over": an age floor stated without the word "age". */
const AGE_FLOOR_PHRASE = /\b\d{1,3}\s*(?:years?|yrs?)?\s*(?:and|or)\s*(?:older|over|above)\b/i;
const UNDER_WORD = /\b(?:under|younger than|below)\b/i;
const OVER_WORD = /\b(?:over|above|older than)\b/i;
const NUMBER_WORDS: Record<string, string> = { sixteen: "16", eighteen: "18", twenty: "20", "twenty-one": "21", "twenty one": "21", sixty: "60", "sixty-five": "65", "sixty five": "65" };

/** Spelled-out operators and numbers ("greater than or equal to 18", "> = 50", "eighteen") and the reference time ("at the time of consent"). */
function normalizeAgeText(text: string): string {
  return text
    .replace(/\bgreater than or equal to\b|\bnot less than\b/gi, ">=")
    .replace(/\bless than or equal to\b|\bnot more than\b/gi, "<=")
    .replace(/>\s*\/?\s*=|=\s*>/g, ">=")
    .replace(/<\s*\/?\s*=|=\s*</g, "<=")
    .replace(/\b(?:sixteen|eighteen|twenty[- ]one|twenty|sixty[- ]five|sixty)\b/gi, (w) => NUMBER_WORDS[w.toLowerCase()] ?? w)
    .replace(/\b(?:at|on|upon)\s+(?:the\s+)?(?:time\s+of\s+)?(?:signing|consent|informed consent|screening|enrol?lment|registration|study entry|randomi[sz]ation)\b[^.;]*\.?\s*$/i, "");
}

/** Age bounds stated by an item, or null. Exported for tests. */
export function parseAgeBounds(raw: string): { min?: number; minStrict?: boolean; max?: number; maxStrict?: boolean } | null {
  const text = normalizeAgeText(raw);
  if (!(AGE_CONTEXT.test(text) || AGE_FLOOR_PHRASE.test(text)) || AGE_NOT_PATIENT.test(text)) return null;
  let t = text.replace(/≥/g, ">=").replace(/≤/g, "<=");
  // "Under 45 or over 74" and bulleted per-group lists name two-sided or per-group rules: not one range to check.
  if (UNDER_WORD.test(t) && OVER_WORD.test(t)) return null;
  if ((t.match(/(?:^|\s)[-*\u2022]\s+\S/g) ?? []).length >= 2) return null;
  // Only the first clause states the age ("Aged >=18 years; due to ... those <18 years, ...").
  const first = t.split(";")[0] ?? t;
  if (first !== t && /\d/.test(first)) t = first;
  const out: { min?: number; minStrict?: boolean; max?: number; maxStrict?: boolean } = {};
  const ranges = [...t.matchAll(/\b(\d{1,3})\s*(?:years?|yrs?)?\s*(?:-|–|to|and)\s*(\d{1,3})\s*(?:years?|yrs?)\b/gi)];
  if (ranges.length === 0) {
    const bare = /\baged?\s+(\d{1,3})\s*(?:-|–|to)\s*(\d{1,3})\b(?!\s*(?:%|mg|kg|mm|cm|ml|g\/))/i.exec(t);
    if (bare) return { min: Number(bare[1]), max: Number(bare[2]) };
  }
  if (ranges.length > 1) return null; // several ranges ("2 to 17 years for X, 2 to 21 years for Y"): per-group rules
  const range = ranges[0];
  if (range && /\bbetween\b|\baged?\b|\bages\b|-|–|\bto\b/i.test(t)) return { min: Number(range[1]), max: Number(range[2]) };
  const min =
    /(?:>=|=>|\bat least|\bminimum(?: age)?(?: of)?|\baged?\s*>=)\s*(\d{1,3})\s*(?:years?|yrs?)?/i.exec(t) ??
    /\b(\d{1,3})\s*(?:(?:years?|yrs?)(?:\s+of\s+age)?(?:\s+old)?)?\s*(?:or|and)\s*(?:older|above|over|greater)\b/i.exec(t);
  const minStrict = /(?:>(?!=)|\bolder than|\bover|\bgreater than|\bmore than)\s*(\d{1,3})\s*(?:years?|yrs?)?/i.exec(t);
  if (min) out.min = Number(min[1]);
  else if (minStrict && !/\bor\s+(?:equal|older)/i.test(t)) [out.min, out.minStrict] = [Number(minStrict[1]), true];
  const max = /(?:<=|=<|\bup to|\bmaximum(?: age)?(?: of)?|\bno older than|\bnot older than)\s*(\d{1,3})\s*(?:years?|yrs?)?/i.exec(t) ?? /\b(\d{1,3})\s*(?:years?|yrs?)(?:\s+of\s+age)?\s*or\s*(?:younger|less|under)\b/i.exec(t);
  const maxStrict = /(?:<(?!=)|\byounger than|\bunder|\bless than)\s*(\d{1,3})\s*(?:years?|yrs?)/i.exec(t);
  if (max) out.max = Number(max[1]);
  else if (maxStrict) [out.max, out.maxStrict] = [Number(maxStrict[1]), true];
  return out.min !== undefined || out.max !== undefined ? out : null;
}

/** A short item that starts with who it is for ("Females, aged 18 years and older", "Adults (male and female) age >18"). */
const POPULATION_LEAD = /^\W*(?:[a-z]\.\s*)?(?:both\s+)?(?:adults?|males?|females?|men|women|patients?|participants?|subjects?|individuals?)\b/i;
const NAMED_FEMALE = /\b(?:females?|women|woman)\b/i;
const NAMED_MALE = /\b(?:males?|men|man)\b/i;

export function checkAge(text: string, p: ResolverProfile, section: SplitCriterion["section"]): Checked | null {
  const trimmed = text.trim();
  const shortPopulation = POPULATION_LEAD.test(trimmed) && trimmed.split(/\s+/).length <= 16;
  if (!AGE_LEAD.test(trimmed) && !/^\W*(?:age|aged)\b/i.test(trimmed) && !shortPopulation && !AGE_FLOOR_PHRASE.test(trimmed.slice(0, 20))) return null;
  // An exclusion must say "age" itself: "18 years or older, currently cared for by..." is not an age rule.
  if (section === "exclusion" && !AGE_CONTEXT.test(text)) return null;
  const b = parseAgeBounds(text);
  if (!b) return null;
  // "Females, aged 18 or older": one sex named, so the sex answer decides too (inclusion only; "males and females" names both).
  const onlyOneSex = section === "inclusion" && NAMED_FEMALE.test(trimmed) !== NAMED_MALE.test(trimmed);
  if (onlyOneSex) {
    if (p.sex === undefined) return { key: "age", verdict: "open", questions: [] };
    if (p.sex !== (NAMED_FEMALE.test(trimmed) ? "female" : "male")) return { key: "sex", verdict: "fail", questions: p.sources.sex ?? [] };
  }
  if (p.age === undefined) return { key: "age", verdict: "open", questions: [] };
  const a = p.age;
  const okMin = b.min === undefined || (b.minStrict ? a > b.min : a >= b.min);
  const okMax = b.max === undefined || (b.maxStrict ? a < b.max : a <= b.max);
  // An exclusion states who is ruled out ("Age < 18"): being inside its bounds is the failure.
  const inside = okMin && okMax;
  return { key: "age", verdict: inside === (section === "inclusion") ? "ok" : "fail", questions: p.sources.age ?? [] };
}

export const SEX_ITEM = /^(?:(?:patients?|participants?|subjects?|must be|be)\s+)*(?:(female|women|woman)|(male|men|man)|(?:male|men)\s+(?:or|and|and\/or)\s+(?:female|women)|(?:female|women)\s+(?:or|and|and\/or)\s+(?:male|men))(?:\s+(?:patients?|participants?|subjects?))?(?:\s+only)?(?:\s+(?:aged?|>=|≥|\d).*)?[.;]?$/i;

export function checkSex(text: string, p: ResolverProfile, section: SplitCriterion["section"]): Checked | null {
  const m = SEX_ITEM.exec(text.trim());
  if (!m) return null;
  if (!p.sex) return { key: "sex", verdict: "open", questions: [] };
  const named = m[1] ? "female" : m[2] ? "male" : null;
  if (section === "exclusion") return named === null ? null : { key: "sex", verdict: named === p.sex ? "fail" : "ok", questions: p.sources.sex ?? [] };
  return { key: "sex", verdict: named === null || named === p.sex ? "ok" : "fail", questions: p.sources.sex ?? [] };
}

/** Name patterns per cancer group, expanded with NCIt cancer-type synonyms of the group's label. */
export const groupTerms = (() => {
  const cache = new Map<CancerGroupId, RegExp[]>();
  return (g: CancerGroupId): RegExp[] => {
    const hit = cache.get(g);
    if (hit) return hit;
    const def = CANCER_GROUPS.find((x) => x.id === g);
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const syn = def ? [def.label, ...def.synonyms].flatMap((t) => [t, ...cancerSynonyms(t)]).filter((t) => t.length >= 5) : [];
    const out = [...(def?.text ?? []), ...syn.map((t) => new RegExp(`\\b${esc(t)}\\b`, "i"))];
    cache.set(g, out);
    return out;
  };
})();

/** "Histologically confirmed <patient's cancer>": met when the item names only the patient's own cancer group. */
export function checkCancerType(text: string, p: ResolverProfile, trialGroups: readonly CancerGroupId[]): Checked | null {
  if (!p.group || p.group === "other" || p.group === "solid-tumors") return null;
  if (!/\b(cancer|carcinoma|adenocarcinoma|tumou?r|neoplasm|malignan|lymphoma|leuk[a]?emia|myeloma|melanoma|sarcoma|glioma|glioblastoma|nsclc|sclc|hcc|rcc|dlbcl|aml|cll)\b/i.test(text)) return null;
  // Brain/bone/CNS metastases name a site of spread, not the cancer type.
  const clean = text.replace(/\b(brain|cns|central nervous system|bone|liver|leptomeningeal|spinal)\s+metasta\w*/gi, " ");
  const named = (g: CancerGroupId) => groupTerms(g).some((re) => re.test(clean));
  if (!named(p.group)) return null;
  const others = CANCER_GROUPS.filter((g) => g.id !== p.group && g.id !== "other" && g.id !== "solid-tumors" && named(g.id));
  if (others.length > 0 || !trialGroups.includes(p.group)) return null;
  return { key: "cancer_type", verdict: "ok", questions: p.sources.group ?? [] };
}
