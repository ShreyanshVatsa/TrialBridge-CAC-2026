/**
 * High-precision LLM layer for the catalog fact families (lines, prior drugs, stage, relapsed/refractory, other
 * cancer, hepatitis, catalog biomarkers, histology, autoimmune). Pure helpers; the runner is scripts/ingest/llm.ts.
 *
 * Only PUBLIC ClinicalTrials.gov trial text (registered conditions + numbered criteria) is ever sent to the
 * model. No patient data exists at ingestion time and none of these functions accept any.
 *
 * Pipeline per (trial, family):
 *  1. prompt (prompts/ingest-facts-v2.ts) -> JSON -> zod (`parseFamilyOutput`); the raw parsed facts are cached,
 *     so verification thresholds can be re-tuned without re-running the model;
 *  2. hard verification (`verifyFamilyFacts`): verbatim quote inside ONE criterion (and the cited one), family
 *     keyword and any numeric param written in the quote, scope "all" (cohort/alternatives/unclear => abstain),
 *     no cohort header or sub-population wording around the criterion, family-specific checks (washout windows,
 *     single named drug for an exclusion), confidence threshold. Anything that fails => abstain ("mentioned");
 *  3. agreement with the rule layer (`combineFamily`): commit a directional fact only when the LLM committed it
 *     and the rules agree or say none/mentioned; disagreement => both kept with needsReview (never penalize);
 *     a rule-only directional fact in an LLM-gated family is demoted to "mentioned".
 */
import { z } from "zod";
import {
  ALT_HEADER,
  AUTOIMMUNE,
  DRUG_CLASS_PATTERNS,
  HEP_B,
  HEP_C,
  HISTOLOGY_PATTERNS,
  LOCALLY_ADVANCED,
  NUMBER_WORDS,
  OTHER_CANCER,
  RECURRENT,
  ADJUVANT_SETTING,
  ADJUVANT_NED,
} from "@/config/criteria";
import { BIOMARKERS } from "@/config/biomarkers";
import type { CancerGroupId } from "@/config/cancer-groups";
import { DRUG_CLASS_IDS, HISTOLOGY_IDS, type DrugClassId } from "@/config/questionnaire/ids";
import { FAMILY_PROMPT_VERSION, INGEST_SYSTEM_PROMPT, LLM_FAMILY_IDS, familyTask, trialPrefix, type LlmFamily } from "@/prompts/ingest-facts-v2";
import type { Criterion, CriterionSection, Fact, FactKey, FactParam, FactValue } from "@/lib/types/trial";
import { cohortSpecific, familyOf, moreLenient, populationLabel } from "./eligibility-facts";
import { normalizeWs } from "./parse";

export { LLM_FAMILY_IDS, FAMILY_PROMPT_VERSION, type LlmFamily };

/**
 * Families whose final facts follow the verified-LLM agreement policy at ingest (chosen on the dev split).
 * Autoimmune keeps its rule layer (already on at 94% held-out, LLM no better on dev, and
 * the gold sets have no autoimmune family). Histology keeps its rule layer by the rule fixed before the gold
 * measurement (switch only if the verified layer passes the gold gate; it measured 73% on 26 facts).
 */
export const LLM_LAYER_FAMILIES: readonly LlmFamily[] = ["lines", "prior_drug", "stage", "recurrent", "other_malignancy", "hepatitis", "biomarker_v2"];

/** Public trial text the layer reads. Deliberately no patient fields. */
export interface LlmTrialText {
  id: string;
  lastUpdated: string;
  groups: readonly CancerGroupId[];
  conditions: readonly string[];
  inclusion: readonly Criterion[];
  exclusion: readonly Criterion[];
}

const V2_MARKERS = ["MET", "RET", "HPV", "CLDN18", "PH", "NPM1", "TP53", "MGMT", "PIK3CA", "ESR1", "PALB2", "KIT"] as const;
const MARKER_RE = new Map<string, RegExp>(BIOMARKERS.filter((b) => (V2_MARKERS as readonly string[]).includes(b.id)).map((b) => [b.id as string, b.pattern]));
const DRUG_ANY = new RegExp(Object.values(DRUG_CLASS_PATTERNS).map((r) => r.source).join("|"), "i");

/** Keyword pre-filter: the family can only have a fact when its words appear in the criteria. */
const FAMILY_KEYWORD: Readonly<Record<LlmFamily, (text: string, groups: readonly CancerGroupId[]) => boolean>> = {
  lines: (t) => /\b(lines?|regimens?|LOTs?)\b/i.test(t),
  prior_drug: (t) => DRUG_ANY.test(t),
  stage: (t) => LOCALLY_ADVANCED.test(t) || ADJUVANT_SETTING.test(t) || ADJUVANT_NED.test(t) || /\badjuvant\b|\bresected\b/i.test(t),
  recurrent: (t) => RECURRENT.test(t) || /\bnewly diagnosed\b|\buntreated\b/i.test(t),
  other_malignancy: (t) => OTHER_CANCER.test(t),
  hepatitis: (t) => HEP_B.test(t) || HEP_C.test(t),
  biomarker_v2: (t) => [...MARKER_RE.values()].some((re) => re.test(t)),
  histology: (t, g) => HISTOLOGY_PATTERNS.some((h) => h.groups.some((x) => g.includes(x)) && (h.re.test(t) || !!h.negated?.test(t))),
  autoimmune: (t) => AUTOIMMUNE.test(t) || /\bautoimmun/i.test(t),
};

/** Words the verified quote itself must contain (guards against a quote unrelated to the fact). */
const QUOTE_KEYWORD: Readonly<Record<LlmFamily, RegExp>> = {
  lines: /\b(lines?|regimens?|LOTs?|therap(y|ies)|treatments?)\b/i,
  prior_drug: /./, // the class pattern is checked per key
  stage: /\b(locally|advanced|resect\w*|adjuvant|evidence of disease|NED|surgery|surgical|removed)\b/i,
  recurrent: /\b(relaps\w*|refractory|recurr\w*|progress\w*|r\/r|newly diagnosed|untreated|na[iï]ve|resistant|failed|failure)\b/i,
  other_malignancy: /\b(malignan\w*|cancers?|neoplasm\w*|tumou?rs?|carcinoma\w*)\b/i,
  hepatitis: /./, // per key below
  biomarker_v2: /./, // per key below
  histology: /./, // per key below
  autoimmune: /\bauto-?immun/i,
};

/** Histology ids that apply to the trial's groups. */
export function histologyIdsFor(groups: readonly CancerGroupId[]): string[] {
  return HISTOLOGY_PATTERNS.filter((h) => h.groups.some((g) => groups.includes(g))).map((h) => h.id);
}

/** Distinct histology ids of the trial's groups named in a text (a parent + its subtype, NSCLC + squamous, count once). */
export function histologyIdsIn(text: string, groups: readonly CancerGroupId[]): string[] {
  const ids = HISTOLOGY_PATTERNS.filter((h) => h.groups.some((g) => groups.includes(g)) && h.re.test(text)).map((h) => h.id);
  return ids.includes("nsclc") ? ids.filter((i) => i !== "lung_squamous") : ids;
}

/** Catalog marker ids named in the trial's criteria. */
export function markerIdsIn(text: string): string[] {
  return V2_MARKERS.filter((id) => MARKER_RE.get(id)?.test(text));
}

const allText = (t: LlmTrialText) => [...t.inclusion, ...t.exclusion].map((c) => c.text).join("\n");

/**
 * Families worth an LLM call for this trial: its criteria contain the family's keywords, or the rule layer
 * produced any fact (directional or "mentioned") of the family.
 */
export function relevantFamilies(t: LlmTrialText, ruleFacts: readonly Fact[], only: readonly LlmFamily[] = LLM_FAMILY_IDS): LlmFamily[] {
  const text = allText(t);
  const ruleFams = new Set(ruleFacts.map((f) => familyOf(f.key)));
  return only.filter((fam) => {
    if (fam === "histology" && histologyIdsFor(t.groups).length === 0) return false;
    return ruleFams.has(fam) || FAMILY_KEYWORD[fam](text, t.groups);
  });
}

/** A header-like criterion (ends with ":", opens a cohort/part, or introduces alternatives): kept for context. */
const headerLike = (text: string) => /:\s*$/.test(text.trim()) || cohortSpecific(normalizeWs(text).split(/(?<=[.;:])\s+/)[0] ?? "") || ALT_HEADER.test(text);

/**
 * Criteria sent to the model for a set of families: the first two inclusion criteria (diagnosis context),
 * every criterion with a keyword of any of the families, and header-like criteria (cohort/part context).
 * Original numbering is kept, so refs stay valid; omitted criteria are unrelated to every family scheduled.
 */
export function compactCriteria(t: LlmTrialText, families: readonly LlmFamily[]): { inclusion: Criterion[]; exclusion: Criterion[]; omitted: number } {
  let omitted = 0;
  const keep = (list: readonly Criterion[], incl: boolean) =>
    list.filter((c, i) => {
      const ok = (incl && i < 2) || headerLike(c.text) || families.some((f) => FAMILY_KEYWORD[f](c.text, t.groups));
      if (!ok) omitted++;
      return ok;
    });
  const inclusion = keep(t.inclusion, true);
  const exclusion = keep(t.exclusion, false);
  return { inclusion, exclusion, omitted };
}

/** Drug classes named in the trial text (the prior_drug task lists only these). */
export function drugClassesIn(text: string): DrugClassId[] {
  return DRUG_CLASS_IDS.filter((id) => DRUG_CLASS_PATTERNS[id].test(text));
}

/**
 * Chat messages for one (trial, family) call. The (compacted) trial text comes first and depends only on the
 * trial and the scheduled family set, so a trial's family calls share one cached prompt prefix.
 */
export function buildFamilyMessages(family: LlmFamily, t: LlmTrialText, scheduled: readonly LlmFamily[] = [family]): { role: "system" | "user"; content: string }[] {
  const text = allText(t);
  const ids = family === "histology" ? histologyIdsFor(t.groups) : family === "biomarker_v2" ? markerIdsIn(text) : family === "prior_drug" ? drugClassesIn(text) : [];
  const c = compactCriteria(t, scheduled);
  return [
    { role: "system", content: INGEST_SYSTEM_PROMPT },
    { role: "user", content: `${trialPrefix(t.conditions, c.inclusion, c.exclusion, c.omitted)}\n\n${familyTask(family, ids)}\n/no_think` },
  ];
}

/** Allowed keys of a family for one trial (closed vocabularies). */
export function familyKeys(family: LlmFamily, t: LlmTrialText): string[] {
  const text = allText(t);
  switch (family) {
    case "lines":
      return ["min_prior_lines", "max_prior_lines"];
    case "prior_drug":
      return (drugClassesIn(text).length ? drugClassesIn(text) : [...DRUG_CLASS_IDS]).map((d) => `prior_drug:${d}`);
    case "stage":
      return ["locally_advanced", "adjuvant_setting"];
    case "recurrent":
      return ["recurrent"];
    case "other_malignancy":
      return ["other_malignancy"];
    case "hepatitis":
      return ["hepatitis_b", "hepatitis_c"];
    case "biomarker_v2":
      return (markerIdsIn(text).length ? markerIdsIn(text) : [...V2_MARKERS]).map((m) => `biomarker:${m}`);
    case "histology":
      return histologyIdsFor(t.groups).map((h) => `histology:${h}`);
    case "autoimmune":
      return ["autoimmune"];
  }
}

/**
 * JSON schema for llama-server's grammar-constrained output: closed key/scope/value enums, a valid criterion
 * ref, and a capped quote length (keeps generation short; a capped quote is still a verbatim prefix).
 */
export function familySchema(family: LlmFamily, t: LlmTrialText): Record<string, unknown> {
  const item: Record<string, unknown> = {
    key: { enum: familyKeys(family, t) },
    scope: { enum: ["all", "cohort", "alternatives", "unclear"] },
    value: { enum: ["required", "excluded"] },
  };
  if (family === "lines") item.param = { type: "integer", minimum: 0, maximum: 10 };
  if (family === "other_malignancy") item.param = { anyOf: [{ type: "integer", minimum: 1, maximum: 10 }, { enum: ["active_only"] }] };
  if (family === "hepatitis" || family === "autoimmune") item.param = { enum: ["active_only"] };
  if (family === "prior_drug") {
    item.time = { enum: ["ever", "window", "current"] };
    item.class_level = { type: "boolean" };
  }
  item.ref = { type: "string", pattern: "^[IE][0-9]{1,3}$" };
  item.quote = { type: "string", maxLength: 220 };
  return {
    type: "object",
    properties: { facts: { type: "array", maxItems: 8, items: { type: "object", properties: item, required: ["key", "scope", "value", "ref"] } } },
    required: ["facts"],
  };
}

export const familyCacheKey = (id: string, lastUpdated: string, family: LlmFamily) => `${id}|${lastUpdated}|${FAMILY_PROMPT_VERSION[family]}|${family}`;

// -------------------------------------------------------------------------------------------------
// Output parsing (zod)
// -------------------------------------------------------------------------------------------------
export const RawLlmFactSchema = z.object({
  key: z.string().min(1).max(60),
  value: z.enum(["required", "excluded", "mentioned"]),
  param: z.union([z.number(), z.string().max(30)]).nullish(),
  scope: z.string().max(30).optional(),
  time: z.string().max(20).optional(),
  class_level: z.boolean().optional(),
  ref: z.string().max(8).optional(),
  /** Omitted by the model when scope is not "all" (such facts can only abstain). */
  quote: z.string().max(2000).optional(),
  confidence: z.coerce.number().min(0).max(1).optional(),
  /** Token probability of the value/scope/param choice (filled by the runner from logprobs). */
  lp: z.number().min(0).max(1).optional(),
});
export type RawLlmFact = z.infer<typeof RawLlmFactSchema>;

/** Strip <think> blocks, parse the first JSON object, validate each fact individually (max 12). */
export function parseFamilyOutput(raw: string): { facts: RawLlmFact[]; invalid: number } {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("LLM output has no JSON object");
  const json = z.object({ facts: z.array(z.unknown()) }).parse(JSON.parse(text.slice(start, end + 1)));
  const facts = json.facts.map((f) => RawLlmFactSchema.safeParse(f)).flatMap((r) => (r.success ? [r.data] : []));
  return { facts: facts.slice(0, 12), invalid: json.facts.length - facts.length };
}

/**
 * Token probabilities of the decisive choices (value, scope, param) per fact, from OpenAI-style logprobs.
 * Returns one number per `"value":"` occurrence (the minimum over that fact's decisive tokens).
 */
export function decisionProbs(content: string, tokens: readonly { token: string; logprob: number }[]): number[] {
  const starts: number[] = [];
  let pos = 0;
  for (const t of tokens) {
    starts.push(pos);
    pos += t.token.length;
  }
  const probAt = (charIdx: number): number => {
    for (let i = tokens.length - 1; i >= 0; i--) if ((starts[i] as number) <= charIdx) return Math.exp((tokens[i] as { logprob: number }).logprob);
    return 1;
  };
  const out: number[] = [];
  const objects = content.split(/(?="key"\s*:)/).slice(1);
  let offset = content.indexOf('"key"');
  for (const obj of objects) {
    let p = 1;
    for (const field of ["value", "scope", "param", "time"]) {
      const m = new RegExp(`"${field}"\\s*:\\s*"?`).exec(obj);
      if (m) p = Math.min(p, probAt(offset + m.index + m[0].length));
    }
    out.push(p);
    offset += obj.length;
  }
  return out;
}

// -------------------------------------------------------------------------------------------------
// Verification
// -------------------------------------------------------------------------------------------------
interface VerifyOptions {
  /**
   * Minimum confidence to commit (chosen on the dev split). Confidence = the token probability of the fact's
   * decisive choices (value, scope, param, time) from logprobs; the model's self-rated number was always ~0.95
   * in the first samples, so it is only a fallback.
   */
  minConfidence: number;
}
export const DEFAULT_VERIFY: VerifyOptions = { minConfidence: 0.95 };

/** One LLM fact after verification. `committed` = it may become a directional fact. */
export interface CheckedFact {
  key: FactKey;
  value: FactValue;
  param?: FactParam;
  quote: string;
  ref: { section: CriterionSection; n: number };
  confidence: number;
  committed: boolean;
  /** Why it was not committed (abstain reason). */
  reason?: string;
}

function keyAllowed(family: LlmFamily, key: string, t: LlmTrialText): boolean {
  switch (family) {
    case "lines":
      return key === "min_prior_lines" || key === "max_prior_lines";
    case "prior_drug":
      return key.startsWith("prior_drug:") && (DRUG_CLASS_IDS as readonly string[]).includes(key.slice(11));
    case "stage":
      return key === "locally_advanced" || key === "adjuvant_setting";
    case "recurrent":
      return key === "recurrent";
    case "other_malignancy":
      return key === "other_malignancy";
    case "hepatitis":
      return key === "hepatitis_b" || key === "hepatitis_c";
    case "biomarker_v2":
      return key.startsWith("biomarker:") && (V2_MARKERS as readonly string[]).includes(key.slice(10));
    case "histology":
      return key.startsWith("histology:") && (HISTOLOGY_IDS as readonly string[]).includes(key.slice(10)) && histologyIdsFor(t.groups).includes(key.slice(10));
    case "autoimmune":
      return key === "autoimmune";
  }
}

/** Is the quote about this key (its own words appear in it)? */
function quoteMentionsKey(family: LlmFamily, key: string, quote: string): boolean {
  if (!QUOTE_KEYWORD[family].test(quote)) return false;
  if (family === "prior_drug") return DRUG_CLASS_PATTERNS[key.slice(11) as DrugClassId].test(quote);
  if (family === "hepatitis") return (key === "hepatitis_b" ? HEP_B : HEP_C).test(quote) || (key === "hepatitis_c" && /\bhepatitis\b[^.;]{0,12}\bB\b[^.;]{0,12}\bC\b/i.test(quote));
  if (family === "stage") return key === "locally_advanced" ? LOCALLY_ADVANCED.test(quote) : ADJUVANT_SETTING.test(quote) || ADJUVANT_NED.test(quote) || /\badjuvant\b|\b(?:completely |R0 )?resected\b/i.test(quote);
  if (family === "biomarker_v2") return MARKER_RE.get(key.slice(10))?.test(quote) ?? false;
  if (family === "histology") {
    const h = HISTOLOGY_PATTERNS.find((x) => x.id === key.slice(10));
    return !!h && (h.re.test(quote) || !!h.negated?.test(quote));
  }
  return true;
}

/** A numeric param must be written in the quote (digits or a number word). */
export function numberInQuote(n: number, quote: string): boolean {
  if (new RegExp(String.raw`(?<![\d.])${n}(?![\d.])`).test(quote)) return true;
  const words = Object.entries(NUMBER_WORDS).filter(([, v]) => v === n).map(([w]) => w);
  return words.some((w) => new RegExp(String.raw`\b${w}\b`, "i").test(quote));
}

/** Allowed params per key; anything else => abstain. */
function normalizeParam(family: LlmFamily, key: string, p: RawLlmFact["param"]): { ok: boolean; param?: FactParam } {
  if (p === null || p === undefined || p === "" || p === "none") return { ok: family !== "lines" };
  if (family === "lines") {
    const n = typeof p === "number" ? p : Number(p);
    return Number.isInteger(n) && n >= 0 && n <= 10 ? { ok: true, param: n } : { ok: false };
  }
  if (family === "other_malignancy") {
    if (p === "active_only") return { ok: true, param: "active_only" };
    const n = typeof p === "number" ? p : Number(p);
    return Number.isInteger(n) && n >= 1 && n <= 10 ? { ok: true, param: n } : { ok: false };
  }
  if ((family === "hepatitis" || family === "autoimmune") && p === "active_only") return { ok: true, param: "active_only" };
  return { ok: false };
}

const ACTIVE_WORDS = /\b(active|uncontrolled|untreated|detectable|undetectable|replicat\w*|viral load|DNA|RNA|PCR|cured|resolved|controlled|antiviral|suppressive|clearance|curative|ongoing|current\w*|requir\w*|symptomatic|systemic (?:treatment|therapy)|within|past|last|remission|no evidence|disease[- ]free|receiving)\b/i;
const ANY_HISTORY_WORDS = /\b(history|chronic|known|suspected|prior|previous|any|positive|seropositive|reactive|HBsAg)\b/i;
/**
 * Cheap consistency check between a carve-out param and the criterion wording: "active_only" needs some
 * activity/treatment/time wording; a blanket exclusion (no param) next to only-active wording, or next to a
 * written year window (other cancers), is suspicious. Inconsistent => abstain.
 */
export function paramInconsistent(family: LlmFamily, param: FactParam | undefined, text: string): boolean {
  if (family !== "hepatitis" && family !== "autoimmune" && family !== "other_malignancy") return false;
  if (param === "active_only") return !ACTIVE_WORDS.test(text);
  if (param === undefined) {
    if (family === "other_malignancy") return /\b\d{1,2}\s*(?:\(\w+\)\s*)?(?:years?|yrs?)\b|\b(?:two|three|five|ten)\s+years?\b/i.test(text) || /\bcurative\b|\bactive\b/i.test(text) && !/\b(?:history|prior|previous)\b/i.test(text);
    return ACTIVE_WORDS.test(text) && !ANY_HISTORY_WORDS.test(text);
  }
  return false;
}

/** Class-level wording for a prior-drug exclusion ("any CDK4/6 inhibitor", "anti-PD-1 therapy", "platinum-based"). */
const DRUG_CLASS_WORD = /\b(inhibitors?|therap(?:y|ies)|agents?|antibod\w*|blockade|class|based|containing|TKIs?|regimens?|directed|targeted|chemotherap\w*|conjugates?|engag\w*|transplant\w*|CAR[- ]?T|cell therapy|BCG|hormonal|endocrine|anti-?[A-Z0-9])/i;

/** The key's own words sit inside an exception or example clause ("except hepatitis B", "mutations such as BCR-ABL"). */
export function keyCarvedOut(family: LlmFamily, key: string, text: string): boolean {
  const re = family === "hepatitis" ? (key === "hepatitis_b" ? HEP_B : HEP_C) : family === "prior_drug" ? DRUG_CLASS_PATTERNS[key.slice(11) as DrugClassId] : family === "biomarker_v2" ? MARKER_RE.get(key.slice(10)) : family === "histology" ? HISTOLOGY_PATTERNS.find((h) => h.id === key.slice(10))?.re : undefined;
  const m = re ? new RegExp(re.source, re.flags.replace("g", "")).exec(text) : null;
  if (!m) return false;
  const lead = text.slice(Math.max(0, m.index - 60), m.index);
  return /\b(?:except|exception|other than|excluding|such as|e\.g|for example|including)\b[^.;]*$/i.test(lead);
}

/** Find the single criterion holding the (whitespace-normalized) quote. */
function locate(quote: string, t: LlmTrialText): { section: CriterionSection; c: Criterion; matches: number } | null {
  const q = normalizeWs(quote);
  let found: { section: CriterionSection; c: Criterion } | null = null;
  let matches = 0;
  for (const [section, list] of [["inclusion", t.inclusion], ["exclusion", t.exclusion]] as const) {
    for (const c of list) {
      if (normalizeWs(c.text).includes(q)) {
        matches++;
        found ??= { section, c };
      }
    }
  }
  return found ? { ...found, matches } : null;
}

/** The criterion sits under a cohort/part/alternatives header (a nearby earlier criterion ending with ":"). */
export function underCohortHeader(list: readonly Criterion[], n: number): boolean {
  for (let i = n - 2; i >= 0 && i >= n - 7; i--) {
    const prev = normalizeWs(list[i]?.text ?? "");
    if (!/:\s*$/.test(prev)) continue;
    return cohortSpecific(prev) || ALT_HEADER.test(prev) || populationLabel(prev) || /\b(cohorts?|parts?|arms?|groups?|stratum|module)\b/i.test(prev);
  }
  return false;
}

const parseRef = (ref: string | undefined): { section: CriterionSection; n: number } | null => {
  const m = /^\s*([IE])\s*(\d{1,3})\s*$/i.exec(ref ?? "");
  return m ? { section: (m[1] as string).toUpperCase() === "I" ? "inclusion" : "exclusion", n: Number(m[2]) } : null;
};

/**
 * Hard verification of one family's raw facts for one trial. Every fact comes back, with `committed`
 * telling whether it may become directional and `reason` why not. Unlocatable quotes and keys outside the
 * family are dropped entirely (they cannot be shown as evidence).
 */
export function verifyFamilyFacts(family: LlmFamily, raw: readonly RawLlmFact[], t: LlmTrialText, opts: VerifyOptions = DEFAULT_VERIFY): CheckedFact[] {
  const out: CheckedFact[] = [];
  for (const f of raw) {
    if (!keyAllowed(family, f.key, t)) continue;
    const quote = normalizeWs(f.quote ?? "");
    if (quote.length < 8) continue;
    const loc = locate(quote, t);
    if (!loc) continue; // not verbatim inside one criterion (paraphrase, or text joined across criteria)
    const ref = { section: loc.section, n: loc.c.n };
    const conf = f.lp ?? f.confidence ?? 0;
    const base = { key: f.key as FactKey, quote, ref, confidence: conf };
    const abstain = (reason: string): CheckedFact => ({ ...base, value: "mentioned", committed: false, reason });
    if (f.value === "mentioned") {
      out.push(abstain("model_mentioned"));
      continue;
    }
    const cited = parseRef(f.ref);
    const param = normalizeParam(family, f.key, f.param);
    const list = loc.section === "inclusion" ? t.inclusion : t.exclusion;
    const critText = normalizeWs(loc.c.text);
    const firstClause = critText.split(/(?<=[.;:])\s+/)[0] ?? critText;
    let reason: string | null = null;
    if (!cited || cited.section !== ref.section || cited.n !== ref.n) reason = "ref_mismatch";
    else if (loc.matches > 1) reason = "quote_ambiguous";
    else if ((f.scope ?? "unclear") !== "all") reason = `scope_${f.scope ?? "missing"}`;
    else if (!quoteMentionsKey(family, f.key, quote)) reason = "quote_off_topic";
    else if (!param.ok) reason = "bad_param";
    else if (typeof param.param === "number" && !numberInQuote(param.param, quote)) reason = "param_not_in_quote";
    else if (cohortSpecific(quote) || cohortSpecific(firstClause) || populationLabel(critText) || underCohortHeader(list, loc.c.n)) reason = "cohort_context";
    else if (family === "prior_drug" && f.value === "excluded" && (f.time ?? "ever") !== "ever") reason = "time_window";
    else if (family === "prior_drug" && f.value === "required" && f.time === "current") reason = "time_current";
    else if (family === "prior_drug" && f.value === "excluded" && f.class_level === false) reason = "single_drug";
    else if (family === "lines" && f.value !== "required") reason = "bad_value";
    else if (family === "lines" && f.key === "max_prior_lines" && loc.section === "inclusion" && /\b(?:more|greater) than\b|≥|>=|\bat least\b/i.test(quote) && !/\b(?:no|not|n't|cannot|must not|may not)\b|≤|<=/i.test(quote)) reason = "direction_inconsistent";
    else if (family === "lines" && f.key === "min_prior_lines" && loc.section === "exclusion") reason = "direction_inconsistent";
    else if (family === "prior_drug" && f.value === "excluded" && /\b(refractor\w*|resistan\w*|progress\w*|intoleran\w*|fail\w*)\b/i.test(quote)) reason = "status_not_exposure";
    else if (family === "stage" && f.value !== "required") reason = "bad_value"; // "excluded" settings were misreadings on dev
    else if (family === "other_malignancy" && f.value !== "excluded") reason = "bad_value";
    else if (family === "autoimmune" && f.value !== "excluded") reason = "bad_value";
    // No gold examples exist for "hepatitis required", so that value stays support-only.
    else if (family === "hepatitis" && f.value === "required") reason = "support_only_value";
    else if (f.value === "required" && /^\s*[*\u2022-]\s/.test(loc.c.text)) reason = "list_item"; // orphan sub-bullet: one option or a definition
    else if (family === "histology" && /\bblast (?:phase|crisis)|\btransform\w*|\baccelerated phase|\btherapy[- ]related|\bexcept\b|\bunless\b|\bother than\b/i.test(critText)) reason = "qualified_histology";
    else if (family === "histology" && f.value === "required" && histologyIdsIn(critText, t.groups).length > 1) reason = "alternatives_in_criterion";
    else if (family === "biomarker_v2" && f.value === "required" && (markerIdsIn(critText).length > 1 || /\b(?:or|and\/or|either)\b/i.test(quote))) reason = "alternatives_in_criterion";
    else if (paramInconsistent(family, param.param, critText)) reason = "param_inconsistent";
    else if (keyCarvedOut(family, f.key, critText)) reason = "carved_out_or_example";
    else if (family === "prior_drug" && f.value === "excluded" && !DRUG_CLASS_WORD.test(quote)) reason = "single_drug";
    else if ((family === "stage" || family === "histology") && f.value === "required" && /\s(?:or|and\/or)\s|\w\/\w/i.test(quote)) reason = "alternatives_in_quote";
    else if (family === "autoimmune" && param.param === "active_only" && /\bhistory\b/i.test(critText) && !/\b(?:within|past|last|prior to|before)\b|\b\d+\s*(?:days?|weeks?|months?|years?)\b|requir\w*|\btreated\b|\btreatment\b/i.test(critText)) reason = "param_inconsistent";
    else if (conf < opts.minConfidence) reason = "low_confidence";
    if (reason) {
      out.push(abstain(reason));
      continue;
    }
    out.push({ ...base, value: f.value, ...(param.param !== undefined ? { param: param.param } : {}), committed: true });
  }
  // Several different subtypes "required" in one trial are alternatives (separate list items), not "only this one".
  if (family === "histology") {
    const req = new Set(out.filter((c) => c.committed && c.value === "required").map((c) => c.key));
    if (req.has("histology:nsclc")) req.delete("histology:lung_squamous");
    if (req.size > 1) return out.map((c) => (c.committed && c.value === "required" ? { ...c, value: "mentioned" as const, committed: false, reason: "multiple_required" } : c));
  }
  return out;
}

/**
 * One committed LLM fact per key. Committed facts that disagree in direction cancel out (abstain);
 * same direction with different params keeps the most lenient one (same rule as the rule layer).
 */
export function committedByKey(checked: readonly CheckedFact[]): Map<FactKey, CheckedFact> {
  const out = new Map<FactKey, CheckedFact>();
  const conflicted = new Set<FactKey>();
  for (const c of checked) {
    if (!c.committed || conflicted.has(c.key)) continue;
    const prev = out.get(c.key);
    if (!prev) out.set(c.key, c);
    else if (prev.value !== c.value) {
      out.delete(c.key);
      conflicted.add(c.key);
    } else if (prev.param !== c.param && (prev.param === undefined || c.param === undefined || moreLenient(c.key, prev, c))) {
      // Mixed "no param" vs param within one direction: the lenient (carve-out) reading wins.
      if (c.param !== undefined) out.set(c.key, c);
    }
  }
  return out;
}

const toFact = (c: CheckedFact, extra: Partial<Fact> = {}): Fact => ({
  key: c.key,
  value: c.value,
  quote: c.quote,
  ref: c.ref,
  source: "llm",
  confidence: Math.round(c.confidence * 100) / 100,
  ...(c.param !== undefined ? { param: c.param } : {}),
  ...extra,
});

/**
 * Agreement policy for ONE family of one trial.
 * - LLM committed + rule same (value, param) => one fact (the rule fact, LLM confidence attached), directional.
 * - LLM committed + rule none or "mentioned" => the LLM fact, directional.
 * - LLM committed + rule directional but different => both kept with needsReview (never penalize).
 * - no LLM commitment + rule directional => rule fact demoted to "mentioned" (abstain; never penalizes).
 * - rule "mentioned" facts stay as they are.
 */
export function combineFamily(ruleFacts: readonly Fact[], checked: readonly CheckedFact[]): Fact[] {
  const llm = committedByKey(checked);
  const out: Fact[] = [];
  const seen = new Set<FactKey>();
  for (const r of ruleFacts) {
    seen.add(r.key);
    const l = llm.get(r.key);
    if (r.value === "mentioned") {
      out.push(l ? toFact(l) : { ...r });
      continue;
    }
    if (!l) out.push({ ...r, value: "mentioned" });
    else if (l.value === r.value && l.param === r.param) out.push({ ...r, confidence: Math.round(l.confidence * 100) / 100 });
    else out.push({ ...r, needsReview: true }, toFact(l, { needsReview: true }));
  }
  for (const [k, l] of llm) if (!seen.has(k)) out.push(toFact(l));
  return out;
}

/** Cached model output for one (trial, family). */
export interface FamilyCacheEntry {
  model: string;
  facts: RawLlmFact[];
  invalid: number;
  seconds: number;
}

/**
 * Layer LLM results over a trial's rule facts. Families in `gated` follow the agreement policy when the trial
 * has an LLM result for them. When it has none (the family was not run for this trial yet), rule directional
 * facts are kept, except for families in `demoteMissing` (families switched on because of the verified layer),
 * where they become "mentioned" so that only verified facts can ever penalize. Other families are untouched.
 */
export function applyLlmLayer(
  t: LlmTrialText,
  ruleFacts: readonly Fact[],
  results: Partial<Record<LlmFamily, FamilyCacheEntry>>,
  gated: ReadonlySet<LlmFamily>,
  opts: VerifyOptions = DEFAULT_VERIFY,
  demoteMissing: ReadonlySet<LlmFamily> = gated,
): Fact[] {
  const byFam = new Map<string, Fact[]>();
  const rest: Fact[] = [];
  for (const f of ruleFacts) {
    const fam = familyOf(f.key);
    if (fam && gated.has(fam as LlmFamily)) byFam.set(fam, [...(byFam.get(fam) ?? []), f]);
    else rest.push(f);
  }
  const out = [...rest];
  for (const fam of LLM_FAMILY_IDS) {
    if (!gated.has(fam)) continue;
    const rules = byFam.get(fam) ?? [];
    const res = results[fam];
    if (!res) {
      out.push(...(demoteMissing.has(fam) ? rules.map((r) => (r.value === "mentioned" ? r : { ...r, value: "mentioned" as const })) : rules));
      continue;
    }
    out.push(...combineFamily(rules, verifyFamilyFacts(fam, res.facts, t, opts)));
  }
  return out;
}
