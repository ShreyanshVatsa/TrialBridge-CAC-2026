/**
 * Rule-layer fact families (QUESTIONNAIRE_SPEC §1.4): performance status, brain metastases,
 * histology, lines of therapy, prior drug classes, measurable disease, relapsed/refractory, other
 * cancers, HIV, hepatitis, transplant, autoimmune disease, disease-named organ problems, and
 * group-specific status (castration, platinum, muscle-invasive, resectability, RAI, stage setting).
 *
 * Pure functions over one clause ("segment") of one criterion. Every fact quotes the clause it came
 * from verbatim. When the direction is unclear the fact is "mentioned", which never penalizes.
 * Parameterized facts carry `param` (ecog_max 1, min_prior_lines 2, brain_mets "active_only").
 */
import {
  ADJUVANT_FUTURE,
  ADJUVANT_NED,
  ADJUVANT_NED_CONTEXT,
  ADJUVANT_NOT_STATUS,
  LOCALLY_ADVANCED_NOT_STATUS,
  RECURRENT_NOT_DISEASE_V4,
  RECURRENT_NOT_REQUIREMENT,
  GENERIC_LABEL,
  LINES_ALT,
  LINES_ALT_AFTER,
  LINES_ELIGIBLE_IF,
  LINES_MAY,
  LINES_MODAL_CLASS,
  LINES_SUBSET,
  SUBGROUP_OPENER,
  ADJUVANT_SETTING,
  ALLO_SCT,
  ALLOWED,
  AUTOIMMUNE,
  BORDERLINE,
  BRAIN_ACTIVE,
  BRAIN_CARVEOUT,
  BRAIN_METS,
  BRAIN_REQUIRED,
  COHORT_PREFIX,
  CRPC,
  DRUG_HISTORY_STRONG,
  DRUG_OPTIONAL,
  DRUG_PROGRESSION,
  DRUG_REPRODUCTIVE,
  DRUG_STOP,
  DRUG_STUDY_PLAN,
  DRUG_TIMING,
  CSPC,
  DRUG_CLASS_PATTERNS,
  ECOG_MENTION,
  EXAMPLE_CONTEXT,
  HEART_DISEASE,
  HEP_ACTIVE_CARVEOUT,
  HEP_CARVEOUT_LEAD,
  HEP_NOT_INFECTION_RULE,
  HEP_TEST_DEFINED,
  HEP_QUALIFIER,
  HEP_VIROLOGIC_CONDITION,
  HISTOLOGY_CONFIRM,
  HISTOLOGY_DEFINITION,
  HISTOLOGY_QUALIFIER,
  HISTOLOGY_SUBGRADE,
  HISTOLOGY_TESTING,
  HISTOLOGY_TRANSFORMED,
  HISTOLOGY_SECOND_CANCER,
  HISTOLOGY_THERAPY,
  HEP_B,
  HEP_C,
  HISTOLOGY_PATTERNS,
  HIV,
  HIV_CONTROLLED_CARVEOUT,
  HIV_REQUIRED,
  KIDNEY_DISEASE,
  KPS_MENTION,
  LINES_CLASS_SPECIFIC,
  LINES_NO_LIMIT,
  LINES_UNIT,
  LIST_CONTEXT,
  LIVER_DISEASE,
  LOCALLY_ADVANCED,
  MEASURABLE,
  MEASURABLE_DEFINITION,
  MEASURABLE_OPTIONAL,
  MIBC,
  NEW_OR_RECURRENT_ALT,
  NMIBC,
  NON_MEASURABLE,
  NUM,
  NUMBER_WORDS,
  OR_NEAR,
  ORGAN_LAB,
  ORGAN_TRANSPLANT,
  OTHER_CANCER,
  OTHER_CANCER_ACTIVE,
  OTHER_CANCER_JUDGMENT,
  PERFORMANCE_MENTION,
  PLATINUM_RESISTANT,
  PLATINUM_SENSITIVE,
  RAI_REFRACTORY,
  RECURRENT,
  RECURRENT_NOT_DISEASE,
  RESECTABLE,
  TRANSPLANT_FUTURE,
  TRANSPLANT_PRIOR,
  UNLESS,
  UNRESECTABLE,
  WASHOUT,
  WITH_OR_WITHOUT,
  YEARS_WINDOW,
} from "@/config/criteria";
import type { CancerGroupId } from "@/config/cancer-groups";
import type { DrugClassId } from "@/config/questionnaire/ids";
import { isScopedParam, type CriterionSection, type FactKey, type FactParam, type FactValue } from "@/lib/types/trial";

interface V2Candidate {
  key: FactKey;
  value: FactValue;
  param?: FactParam;
  /** The clause the fact came from (verbatim substring of the criterion). */
  quote: string;
}

interface ExtractContext {
  /** The trial's cancer groups (histology patterns only run for their own groups). */
  groups: readonly CancerGroupId[];
  /** The criterion starts with a cohort/part header, so every clause in it is cohort-specific. */
  cohort?: boolean;
  /** The trial's conditions (as registered); used to tell the trial's own disease from other diseases named in a clause. */
  conditions?: readonly string[];
  /** The clause sits under a header offering alternatives ("one of the following indications:"). */
  alt?: boolean;
}

/** Fact families used for precision measurement and the catalog gate (§7.3). */
export const FACT_FAMILIES = {
  performance: ["ecog_max"],
  brain_mets: ["brain_mets"],
  histology: ["histology:*"],
  lines: ["min_prior_lines", "max_prior_lines"],
  prior_drug: ["prior_drug:*"],
  measurable: ["measurable_disease"],
  recurrent: ["recurrent"],
  other_malignancy: ["other_malignancy"],
  hiv: ["hiv"],
  hepatitis: ["hepatitis_b", "hepatitis_c"],
  transplant: ["organ_transplant", "allo_sct"],
  autoimmune: ["autoimmune"],
  organ_disease: ["kidney_disease", "liver_disease", "heart_disease"],
  group_status: ["castration_resistant", "platinum_resistant", "platinum_sensitive", "mibc", "resectable", "rai_refractory"],
  stage: ["locally_advanced", "adjuvant_setting"],
  biomarker_v2: ["biomarker:MET", "biomarker:RET", "biomarker:HPV", "biomarker:CLDN18", "biomarker:PH", "biomarker:NPM1", "biomarker:TP53", "biomarker:MGMT", "biomarker:PIK3CA", "biomarker:ESR1", "biomarker:PALB2", "biomarker:KIT"],
} as const satisfies Record<string, readonly string[]>;
export type FactFamily = keyof typeof FACT_FAMILIES;

/** The family a fact key belongs to, or null for legacy keys. */
export function familyOf(key: string): FactFamily | null {
  for (const [fam, keys] of Object.entries(FACT_FAMILIES) as [FactFamily, readonly string[]][]) {
    for (const k of keys) if (k === key || (k.endsWith(":*") && key.startsWith(k.slice(0, -1)))) return fam;
  }
  return null;
}

const toNum = (tok: string): number => NUMBER_WORDS[tok.toLowerCase()] ?? Number(tok);

/** Inclusion text that is really an exclusion ("Patients with X are not eligible"). */
const INCLUSION_EXCLUDES = /\b(not eligible|ineligible|are excluded|will be excluded|is excluded|excluded from|not (be )?allowed|not permitted)\b/i;
/** "No X", "without X", "free of X", "negative for X" before a match, inside its clause. */
const LEAD_NEGATION = /\b(no|not|without|never|absence of|free of|negative for|none|neither|nor|excluding|other than|except)\b/i;
/** Permission wording: the criterion says who MAY join, not who must. */
const PERMISSIVE = /\b(eligible|allowed|permitted|acceptable|may (participate|enroll|be (included|enrolled|eligible))|can (participate|enroll|be enrolled)|are able to (participate|enroll)|may have)\b/i;

/** Clause containing `index`: the text after the last , ; : before it. */
function leadClause(text: string, index: number, max = 60): string {
  const lead = text.slice(Math.max(0, index - max), index);
  return lead.slice(Math.max(lead.lastIndexOf(","), lead.lastIndexOf(";"), lead.lastIndexOf(":"), lead.lastIndexOf("(")) + 1);
}

function insideParens(text: string, index: number): boolean {
  const before = text.slice(0, index);
  return before.lastIndexOf("(") > before.lastIndexOf(")");
}

/** Effective section: inclusion criteria phrased as exclusions count as exclusion. */
export function effectiveSection(section: CriterionSection, seg: string): CriterionSection {
  if (section !== "inclusion") return section;
  const m = INCLUSION_EXCLUDES.exec(seg);
  // "... unless not eligible", "if they are not eligible for X": a condition, not an exclusion.
  if (!m || /\b(unless|if|except|who (are|is)|whom|when|considered)\b[^.;]{0,25}$/i.test(seg.slice(0, m.index))) return section;
  // "(unknown primary is excluded)": a parenthetical aside, not the criterion's own rule.
  const pre = seg.slice(0, m.index);
  if (pre.lastIndexOf("(") > pre.lastIndexOf(")")) return section;
  // "ineligible for ASCT", "not eligible to receive X": a condition on the patient, unless it says "for this study".
  if (/^(not eligible|ineligible)$/i.test(m[0]) && /^\s*(for|to|or|and)\b/i.test(seg.slice(m.index + m[0].length)) && !/^\s*(for|to)\s+(?:this|the|any|further)?\s*(study|trial|protocol|participation|enrol\w*|inclusion|randomi[sz]\w*|screening)\b/i.test(seg.slice(m.index + m[0].length))) return section;
  return "exclusion";
}

// ---------------------------------------------------------------------------------------------
// Performance status (ECOG / Karnofsky / Lansky) -> ecog_max
// ---------------------------------------------------------------------------------------------

/** Lenient ECOG ceiling for a Karnofsky/Lansky floor: ECOG 0=90-100, 1=70-80, 2=50-60, 3=30-40, 4=10-20. */
export function kpsToEcog(minKps: number): number {
  if (minKps <= 20) return 4;
  if (minKps <= 40) return 3;
  if (minKps <= 60) return 2;
  if (minKps <= 80) return 1;
  return 0;
}

const E = String.raw`([0-4])(?!\s*(?:days?|weeks?|months?|years?|%|mg|hours?|cm|mm|x|\.\d))`;
const ECOG_RANGE = new RegExp(String.raw`\b${E}\s*(?:-|–|—|to|through)\s*${E}\b`, "i");
const ECOG_LIST = new RegExp(String.raw`\b${E}(?:\s*,\s*[0-4])*\s*,?\s*(?:or|and|\/)\s*${E}\b`, "i");
const ECOG_LE = new RegExp(String.raw`(?:≤|<=|=<|less than or equal to|equal to or less than|at most|no (?:greater|higher|more|worse) than|not (?:greater|higher|more|worse) than|maximum (?:of )?|up to|max(?:imum)?\.?)\s*(?:of\s*)?${E}`, "i");
const ECOG_LT = new RegExp(String.raw`(?:<|less than|lower than|below|better than)\s*${E}`, "i");
const ECOG_GE = new RegExp(String.raw`(?:≥|>=|=>|greater than or equal to|equal to or greater than|at least)\s*${E}`, "i");
const ECOG_GT = new RegExp(String.raw`(?:>|greater than|higher than|more than|worse than|above)\s*${E}`, "i");
const ECOG_OR_LESS = new RegExp(String.raw`\b${E}\s*or\s*(?:less|lower|below|better)\b`, "i");
const ECOG_OR_MORE = new RegExp(String.raw`\b${E}\s*or\s*(?:more|greater|higher|above|worse)\b|\b${E}\s*\+`, "i");
const ECOG_SINGLE = new RegExp(String.raw`(?:^|status|score|PS|ECOG|grade|scale|\bof|=|:)\s*(?:\(PS\)\s*|\(ECOG\)\s*)?(?:of\s*)?${E}\b`, "i");

/** ECOG ceiling stated in a window of text right after an ECOG mention, or null. */
export function parseEcog(window: string, section: CriterionSection): number | null {
  const found: { i: number; v: number }[] = [];
  const add = (re: RegExp, f: (m: RegExpExecArray) => number | null) => {
    const m = re.exec(window);
    if (m) {
      const v = f(m);
      if (v !== null && v >= 0 && v <= 4) found.push({ i: m.index, v });
    }
  };
  const incl = section === "inclusion";
  add(ECOG_RANGE, (m) => (incl ? Number(m[2]) : Number(m[1]) - 1));
  add(ECOG_LIST, (m) => (incl ? Number(m[2]) : Number(m[1]) - 1));
  add(ECOG_LE, (m) => (incl ? Number(m[1]) : null));
  add(ECOG_OR_LESS, (m) => (incl ? Number(m[1]) : null));
  add(ECOG_LT, (m) => (incl ? Number(m[1]) - 1 : null));
  add(ECOG_GE, (m) => (incl ? null : Number(m[1]) - 1));
  add(ECOG_OR_MORE, (m) => (incl ? null : Number(m[1] ?? m[2]) - 1));
  add(ECOG_GT, (m) => (incl ? null : Number(m[1])));
  if (found.length === 0) add(ECOG_SINGLE, (m) => (incl ? Number(m[1]) : Number(m[1]) - 1));
  if (found.length === 0) return null;
  found.sort((a, b) => a.i - b.i);
  return found[0]?.v ?? null;
}

const K = String.raw`(\d{2,3})\s*%?`;
const KPS_GE = new RegExp(String.raw`(?:≥|>=|=>|at least|of at least|greater than or equal to|equal to or greater than|minimum(?: of)?|no less than|not less than|over|above)\s*(?:of\s*)?${K}`, "i");
const KPS_GT = new RegExp(String.raw`(?:>|greater than|more than)\s*${K}`, "i");
const KPS_RANGE = new RegExp(String.raw`${K}\s*(?:-|–|to)\s*100\b`, "i");
const KPS_OR_MORE = new RegExp(String.raw`${K}\s*(?:or|and)\s*(?:higher|greater|more|above|better|over)\b`, "i");
const KPS_LT = new RegExp(String.raw`(?:<|less than|lower than|below)\s*${K}`, "i");
const KPS_LE = new RegExp(String.raw`(?:≤|<=|=<|less than or equal to|equal to or less than|of)\s*${K}\s*(?:or (?:less|lower|below))?`, "i");
const KPS_SINGLE = new RegExp(String.raw`(?:score|status|KPS|Karnofsky|Lansky|of|=|:)\s*(?:\(KPS\)\s*)?(?:score\s*)?(?:of\s*)?${K}`, "i");

/** Minimum Karnofsky/Lansky score stated in a window, or null. */
export function parseKpsMin(window: string, section: CriterionSection): number | null {
  const incl = section === "inclusion";
  const ok = (n: number) => n >= 10 && n <= 100 && n % 10 === 0;
  const tries: [RegExp, (n: number) => number | null][] = incl
    ? [
        [KPS_RANGE, (n) => n],
        [KPS_GE, (n) => n],
        [KPS_GT, (n) => n + 10],
        [KPS_OR_MORE, (n) => n],
        [KPS_SINGLE, (n) => n],
      ]
    : [
        [KPS_LT, (n) => n],
        [KPS_LE, (n) => n + 10],
      ];
  let best: { i: number; v: number } | null = null;
  for (const [re, f] of tries) {
    const m = re.exec(window);
    if (!m) continue;
    const n = Number(m[1]);
    if (!ok(n)) continue;
    const v = f(n);
    if (v === null) continue;
    if (!best || m.index < best.i) best = { i: m.index, v };
  }
  return best ? Math.min(100, best.v) : null;
}

function performanceFacts(section: CriterionSection, seg: string): V2Candidate[] {
  if (!PERFORMANCE_MENTION.test(seg)) return [];
  const values: number[] = [];
  const ecogRe = new RegExp(ECOG_MENTION.source, "gi");
  for (let m = ecogRe.exec(seg); m; m = ecogRe.exec(seg)) {
    let window = seg.slice(m.index + m[0].length, m.index + m[0].length + 110);
    const kps = KPS_MENTION.exec(window);
    if (kps) window = window.slice(0, kps.index);
    const v = parseEcog(window, section);
    if (v !== null) values.push(v);
  }
  // "performance status 0-1" without a scale name: small numbers are ECOG.
  if (values.length === 0 && !KPS_MENTION.test(seg)) {
    const ps = /\bperformance (status|score)\b|\bPS\b/i.exec(seg);
    if (ps) {
      const v = parseEcog(seg.slice(ps.index + ps[0].length, ps.index + ps[0].length + 80), section);
      if (v !== null) values.push(v);
    }
  }
  const kpsRe = new RegExp(KPS_MENTION.source, "gi");
  for (let m = kpsRe.exec(seg); m; m = kpsRe.exec(seg)) {
    let window = seg.slice(m.index + m[0].length, m.index + m[0].length + 90);
    const ec = ECOG_MENTION.exec(window);
    if (ec) window = window.slice(0, ec.index);
    const min = parseKpsMin(window, section);
    if (min !== null) values.push(kpsToEcog(min));
  }
  if (values.length === 0) return [{ key: "ecog_max", value: "mentioned", quote: seg }];
  // "ECOG 0-1 or KPS >= 60" and part-specific limits: the most lenient ceiling applies.
  return [{ key: "ecog_max", value: "required", param: Math.max(...values), quote: seg }];
}

// ---------------------------------------------------------------------------------------------
// Brain metastases
// ---------------------------------------------------------------------------------------------
function brainFacts(section0: CriterionSection, seg: string): V2Candidate[] {
  const m = BRAIN_METS.exec(seg);
  if (!m) return [];
  if (EXAMPLE_CONTEXT.test(leadClause(seg, m.index, 40)) || /\b(surgery|biopsy|resection|removal)\b[^.;]{0,30}$/i.test(seg.slice(0, m.index)) && /\(e\.g|such as|including/i.test(seg.slice(0, m.index))) {
    return [{ key: "brain_mets", value: "mentioned", quote: seg }];
  }
  const section = effectiveSection(section0, seg);
  const lead = leadClause(seg, m.index, 50);
  const negatedLead = LEAD_NEGATION.test(lead);
  const qualifier = BRAIN_ACTIVE.test(seg.slice(Math.max(0, m.index - 70), m.index + m[0].length + 60));
  const carve = BRAIN_CARVEOUT.test(seg) || UNLESS.test(seg);
  if (section === "exclusion") {
    // An exclusion clause that only says who IS allowed ("Patients with treated, stable brain metastases are eligible").
    if (PERMISSIVE.test(seg) && !/\b(known|active|untreated|symptomatic|history of|presence of|any)\b/i.test(seg.slice(0, m.index))) {
      return [{ key: "brain_mets", value: "excluded", param: "active_only", quote: seg }];
    }
    if (negatedLead && !qualifier) return [{ key: "brain_mets", value: "mentioned", quote: seg }];
    return [qualifier || carve ? { key: "brain_mets", value: "excluded", param: "active_only", quote: seg } : { key: "brain_mets", value: "excluded", quote: seg }];
  }
  // Inclusion.
  if (negatedLead) return [qualifier || carve ? { key: "brain_mets", value: "excluded", param: "active_only", quote: seg } : { key: "brain_mets", value: "excluded", quote: seg }];
  if (PERMISSIVE.test(seg) || carve || ALLOWED.test(seg)) {
    // "treated/stable brain metastases are allowed" implies active ones are not; "asymptomatic/untreated allowed" restricts little.
    if (/\b(previously treated|treated|stable)\b/i.test(seg) && !/\buntreated\b/i.test(seg)) return [{ key: "brain_mets", value: "excluded", param: "active_only", quote: seg }];
    return [{ key: "brain_mets", value: "mentioned", quote: seg }];
  }
  if (OR_NEAR.test(seg.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)) || LIST_CONTEXT.test(seg)) return [{ key: "brain_mets", value: "mentioned", quote: seg }];
  if (BRAIN_REQUIRED.test(seg)) return [{ key: "brain_mets", value: "required", quote: seg }];
  return [{ key: "brain_mets", value: "mentioned", quote: seg }];
}

// ---------------------------------------------------------------------------------------------
// Lines of therapy
// ---------------------------------------------------------------------------------------------
const LU = LINES_UNIT;
const LINES_RANGE = new RegExp(String.raw`\b${NUM}\s*(?:-|–|to|or)\s*${NUM}\s+${LU}`, "i");
const LINES_BETWEEN = new RegExp(String.raw`\bat least\s+${NUM}\s+(?:but|and)\s+(?:no more than|not more than|not greater than|at most|up to|≤)\s+${NUM}\s+${LU}`, "i");
const LINES_MIN = new RegExp(String.raw`(?:at least|≥|>=|minimum of|a minimum of|no fewer than|not less than)\s*${NUM}\s+${LU}|\b${NUM}\s+or more\s+${LU}|\b${NUM}\s*\+\s+${LU}`, "i");
const LINES_MIN_GT = new RegExp(String.raw`(?<!\b(?:no|not|or|nor)\s)(?<!n't\s)(?:more than|greater than|>)\s*${NUM}\s+${LU}`, "i");
/** "must not have received more than 1 line", "no more than 2 regimens" (inclusion) => maximum. */
const LINES_MAX_NEG = new RegExp(String.raw`(?:\b(?:no|not|n't)|cannot|may not|must not)\s+(?:\w+\s+){0,3}?(?:(?:more|greater) than|>)\s*${NUM}\s+${LU}`, "i");
const LINES_MAX = new RegExp(String.raw`(?:no more than|not more than|not greater than|at most|up to|maximum of|a maximum of|≤|<=|no greater than|fewer than or equal to)\s*${NUM}\s+${LU}|\b${NUM}\s+or (?:fewer|less)\s+${LU}`, "i");
const LINES_MAX_LT = new RegExp(String.raw`(?:fewer than|less than|<)\s*${NUM}\s+${LU}`, "i");
const LINES_EXACT = new RegExp(String.raw`\b(?:only|exactly|one and only)\s+${NUM}\s+${LU}`, "i");

/** The unit is followed by "of <class>" ("lines of endocrine therapy"): a class-specific count, not total lines. */
function classSpecificAfter(seg: string, m: RegExpExecArray): boolean {
  return /^\s*(of|with|containing|including only)\s+(?!(prior |previous )?(systemic |anti-?cancer |standard )?(therapy|therapies|treatments?)\b)/i.test(seg.slice(m.index + m[0].length, m.index + m[0].length + 40));
}

/** {min,max} prior lines stated in a clause (generic total counts only). */
export function parseLines(seg: string, section: CriterionSection): { min?: number; max?: number } | null {
  if (LINES_NO_LIMIT.test(seg)) return null;
  const incl = section === "inclusion";
  // Numbers inside a match, in order (the unit pattern itself contains no number tokens).
  const nums = (m: RegExpExecArray): number[] => [...m[0].matchAll(new RegExp(String.raw`\b${NUM}\b`, "gi"))].map((x) => toNum(x[1] as string));
  let m = LINES_BETWEEN.exec(seg);
  if (m) {
    const [a, b] = nums(m);
    return incl && !classSpecificAfter(seg, m) && a !== undefined && b !== undefined ? { min: a, max: b } : null;
  }
  // "Only 1 prior line is allowed" / "may have received 1-2 prior lines": a ceiling, not a minimum.
  const mayHave = LINES_MAY.test(seg);
  m = LINES_EXACT.exec(seg);
  if (m) {
    const [a] = nums(m);
    if (!incl || classSpecificAfter(seg, m) || a === undefined) return null;
    return mayHave ? { max: a } : { min: a, max: a };
  }
  m = LINES_RANGE.exec(seg);
  if (m && !classSpecificAfter(seg, m)) {
    const [a, b] = nums(m);
    if (a !== undefined && b !== undefined && b > a && b - a <= 4) return incl ? (mayHave ? { max: b } : { min: a, max: b }) : null;
  }
  const out: { min?: number; max?: number } = {};
  if ((m = LINES_MAX_NEG.exec(seg))) {
    if (!incl || classSpecificAfter(seg, m)) return null; // an inclusion-style sentence misfiled under exclusion: unclear
    const [n] = nums(m);
    return n === undefined ? null : { max: n };
  }
  if ((m = LINES_MIN.exec(seg))) {
    if (classSpecificAfter(seg, m)) return null;
    const [n = 0] = nums(m);
    if (incl) out.min = n;
    else out.max = n - 1; // excluded: "≥ 3 prior lines" => at most 2
  } else if ((m = LINES_MIN_GT.exec(seg))) {
    if (classSpecificAfter(seg, m)) return null;
    const [n = 0] = nums(m);
    if (incl) out.min = n + 1;
    else out.max = n; // excluded: "more than 2 prior lines" => at most 2
  }
  if ((m = LINES_MAX.exec(seg))) {
    const [n] = nums(m);
    if (incl && n !== undefined && !classSpecificAfter(seg, m)) out.max = n;
  } else if ((m = LINES_MAX_LT.exec(seg))) {
    const [n] = nums(m);
    if (incl && n !== undefined && !classSpecificAfter(seg, m)) out.max = n - 1;
  }
  if (out.min === undefined && out.max === undefined) return null;
  if (out.max !== undefined && out.max < 0) return null;
  return out;
}

/** "1 prior line of therapy in any setting with a PARPi-based regimen": the count is for a drug class. */
function linesClassAfterUnit(seg: string): boolean {
  const u = /\b(?:lines?|regimens?)\b(?:\s+of\s+(?:\w+\s+){0,2}(?:therapy|treatment))?/i.exec(seg);
  if (!u) return false;
  const tail = seg.slice(u.index + u[0].length, u.index + u[0].length + 80);
  const w = /\b(?:with|containing|using|based on|that (?:contained|included|used))\b/i.exec(tail);
  return !!w && w.index < 50 && Object.values(DRUG_CLASS_PATTERNS).some((re) => re.test(tail.slice(w.index)));
}

/** A "Label:" opener naming a disease/cohort (not a generic heading such as "Prior therapy:"). */
export function populationLabel(seg: string): boolean {
  const m = /^\s*(?:[*\u2022-]\s*)*(?:\(?[a-z0-9]{1,3}[.)]\s*)?([^:.;]{2,60}):\s+\S/.exec(seg);
  return !!m && !GENERIC_LABEL.test(m[1] as string);
}

/** Several different count limits in one clause ("no more than 1 line if concurrent ... no more than 2 if sequential") are conditional. */
function conflictingCounts(seg: string): boolean {
  const found = new Set<number>();
  // "at least 1 and up to 3 lines" is one range, not two conflicting rules.
  seg = seg.replace(new RegExp(String.raw`(?:at least|≥|>=|minimum of)\s*${NUM}\b[^.;]{0,25}?\b(?:but|and|,)\s*(?:no more than|not more than|up to|at most|maximum of|≤|<=)\s*${NUM}\b`, "gi"), " ");
  for (const m of seg.matchAll(new RegExp(String.raw`(?:no more than|not more than|up to|at most|at least|maximum of|minimum of|≥|≤|>=|<=)\s*${NUM}\b`, "gi"))) found.add(toNum(m[1] as string));
  return found.size > 1;
}

/** The clause names a different disease than the trial's own (basket/multi-disease trials): "Participants with FH-deficient RCC should have ...". */
export function diseasePopulationClause(seg: string, ctx?: ExtractContext): boolean {
  if ((ctx?.groups.length ?? 0) < 2) return false;
  const disease = String.raw`(cancers?|carcinoma|lymphoma|leuk[a]?emia|myeloma|sarcoma|tumou?rs?|melanoma|glioma|NSCLC|SCLC|HCC|RCC|CRC|AML|ALL|CLL|CML|MDS|MCL|MZL|FL|HL|NHL|PTCL|CTCL|MM|DLBCL|PCNSL|GBM|SCC|HNSCC|ESCC|PDAC|TNBC|CRPC|mCRPC|NPC)`;
  return new RegExp(String.raw`^\s*(?:[*\u2022-]\s*)*(?:participants|patients|subjects|individuals)?\s*(?:with|who have)\s+[^.;]{0,70}?\b${disease}\b`, "i").test(seg) || new RegExp(String.raw`^\s*[*\u2022-]\s*[^.;:]{0,60}\b${disease}\b`, "i").test(seg);
}

function linesFacts(section0: CriterionSection, seg: string, ctx?: ExtractContext): V2Candidate[] {
  if (!/\b(lines?|regimens?|LOTs?)\b/i.test(seg)) return [];
  const section = effectiveSection(section0, seg);
  const parsed = parseLines(seg, section);
  if (!parsed) return [];
  const specific =
    LINES_CLASS_SPECIFIC.test(seg) || LINES_SUBSET.test(seg) || LINES_MODAL_CLASS.test(seg) || linesClassAfterUnit(seg) || populationLabel(seg) || SUBGROUP_OPENER.test(seg) || COHORT_PREFIX.test(seg) ||
    LINES_ELIGIBLE_IF.test(seg) || UNLESS.test(seg) || LINES_ALT.test(seg) || LINES_ALT_AFTER.test(seg) || conflictingCounts(seg) || diseasePopulationClause(seg, ctx) ||
    /\b(cohort|part|arm)\s+[A-Z0-9]{1,3}\b/.test(seg) || /\bfor (the )?(metastatic|advanced|recurrent)\b[^.;]{0,40}\bor\b/i.test(seg);
  const out: V2Candidate[] = [];
  if (parsed.min !== undefined) out.push(specific ? { key: "min_prior_lines", value: "mentioned", quote: seg } : { key: "min_prior_lines", value: "required", param: parsed.min, quote: seg });
  if (parsed.max !== undefined) out.push(specific ? { key: "max_prior_lines", value: "mentioned", quote: seg } : { key: "max_prior_lines", value: "required", param: parsed.max, quote: seg });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Prior drug classes
// ---------------------------------------------------------------------------------------------
/** Treatment-history words near a drug mention. */
const DRUG_PRIOR = /\b(prior|previous(ly)?|preceding|received|receipt of|treated with|treatment with|therapy with|history of|exposure|exposed|na[iï]ve|pretreated|pre-treated|failed|failure of|resistant|refractory|relapsed|progress(ed|ion|ing)?|after|following|post-?|intolerant|lines?)\b/i;
/** Present/future treatment wording right before a drug mention. */
const DRUG_FUTURE = /\b(eligible (for|to)|candidates? for|planned|plan(s|ning)? to|scheduled|indicated|appropriate for|suitable for|to (receive|start|begin|initiate)|be treated with|(be|being|are|is|currently) (receiving|on|taking|treated)|receiving|initiat\w+|starting|willing|consider\w*|sensitivity to|benefit from|in combination with|combined with|plus|concurrent|concomitant|maintenance)\b/i;
/** Count limits before a drug ("no more than 1 prior bevacizumab regimen") are not exclusions of the drug. */
const DRUG_COUNT = /\b(no more than|not more than|up to|at most|maximum of|a maximum|fewer than|less than|only one|one prior|single prior|≤|<)\b/i;

/**
 * Is the drug mention negated ("no prior X, Y, or Z")? A negation opens a list of drugs until the clause
 * changes (period, colon, semicolon, "but/however/except") or a new predicate starts.
 */
function drugNegated(seg: string, index: number): boolean {
  const lead = seg.slice(Math.max(0, index - 140), index);
  const open = lead.lastIndexOf("(") > lead.lastIndexOf(")") ? lead.lastIndexOf("(") : -1;
  const start = Math.max(lead.lastIndexOf("."), lead.lastIndexOf(";"), lead.lastIndexOf(":"), open, lead.search(/\b(but|however|except|unless)\b[^]*$/i));
  const clause = lead.slice(start + 1);
  // "no more than 3 lines", "not less than" are counts, not negations of the drug.
  const near = new RegExp(LEAD_NEGATION.source.replace(/^\\b\(/, "\\b(?!(?:no|not)\\s+(?:more|less|fewer|greater|longer|earlier|later|sooner|within)\\b)("), "i").exec(clause);
  if (!near) return false;
  const after = clause.slice(near.index + near[0].length);
  // A new subject/predicate between the negation and the drug ends its scope ("no AEs and who received X").
  return !/\b(who|which|that|and (?:who|have|has|are|is|must|were|was)|but|also)\b/i.test(after);
}

function drugFacts(section0: CriterionSection, seg: string, ctx?: ExtractContext): V2Candidate[] {
  const out: V2Candidate[] = [];
  const section = effectiveSection(section0, seg);
  const incl = section === "inclusion";
  const multiGroup = (ctx?.groups.length ?? 0) >= 2;
  for (const [id, re] of Object.entries(DRUG_CLASS_PATTERNS) as [DrugClassId, RegExp][]) {
    const m = re.exec(seg);
    if (!m) continue;
    const key = `prior_drug:${id}` as FactKey;
    const before = seg.slice(Math.max(0, m.index - 100), m.index);
    const after = seg.slice(m.index + m[0].length, m.index + m[0].length + 40);
    const history = DRUG_HISTORY_STRONG.test(before) || /^\W{0,3}(\w+\W+){0,3}(refractory|resistant|exposed|naive|na[iï]ve|pretreated|failure|progression)\b/i.test(after);
    // "after / following / post" count as history only next to progression or relapse wording in an inclusion criterion.
    const weak = !history && DRUG_PRIOR.test(before) && incl && DRUG_PROGRESSION.test(before);
    const priorish = history || weak;
    if (!priorish && !DRUG_PRIOR.test(before)) continue;
    const around = seg.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30);
    const lead = leadClause(seg, m.index, 70);
    const option = WITH_OR_WITHOUT.test(seg.slice(Math.max(0, m.index - 25), m.index));
    const negated = !option && (drugNegated(seg, m.index) || /\b(na[iï]ve|not (been )?(previously )?(received|treated|exposed))\b/i.test(seg.slice(Math.max(0, m.index - 40), m.index + m[0].length + 25)));
    const context = EXAMPLE_CONTEXT.test(lead) || insideParens(seg, m.index) || option;
    const future = DRUG_FUTURE.test(seg.slice(Math.max(0, m.index - 70), m.index)) && !/\b(prior|previous(ly)?|received|refractory|progress\w*|after|following)\b/i.test(seg.slice(Math.max(0, m.index - 25), m.index));
    const count = DRUG_COUNT.test(seg.slice(Math.max(0, m.index - 50), m.index));
    const otherClassNear = Object.entries(DRUG_CLASS_PATTERNS).some(([other, re2]) => other !== id && re2.test(around));
    const alternatives = incl && (/\band\/or\b/i.test(around) || /\bor\s+(?:treatment|therapy|prior|previous|received|have)\b/i.test(seg.slice(m.index)) || (OR_NEAR.test(around) && otherClassNear) || LIST_CONTEXT.test(seg) || /\b(either|one of the following|any of|at least one of|at least 1 of|at least two of)\b/i.test(seg));
    // Exclusion naming one specific drug ("prior binimetinib") does not exclude the whole class.
    const classWord = /\b(inhibitors?|agents?|therap(y|ies)|antibod\w+|blockade|conjugates?|TKIs?|class|based|containing|directed|targeted|engagers?|BiTEs?|ICIs?|regimens?|chemotherapy|hormonal|endocrine|platinum|taxanes?|transplant\w*|CAR[- ]?T|fluoropyrimidines?|IMiDs?|hypomethylating)\b/i.test(m[0] + after.slice(0, 20));
    const singleDrug = !incl && !classWord;
    // "platinum-refractory/-resistant/-sensitive" is a disease status, "not refractory to X" says nothing about ever having had X.
    const statusWord = /^[- ]?(refractory|resistant|sensitive|free)\b/i.test(seg.slice(m.index + m[0].length, m.index + m[0].length + 14));
    const negatedStatus = negated && /\b(refractory|resistan\w*|progress\w*|fail\w*|intoleran\w*|relaps\w*)\b[^.;]{0,12}$/i.test(seg.slice(Math.max(0, m.index - 22), m.index));
    const ifAfter = /\bif\b/i.test(seg.slice(m.index + m[0].length, m.index + m[0].length + 60));
    const orEnd = /\b(?:or|OR)\s*$/.test(seg.trim()) || /\sOR\s/.test(seg);
    const genericImid = id === "imid" && /\b(?:other|any other)\s+immunomodulatory\b|CD40|checkpoint|PD-?1/i.test(seg);
    const conditionalOpener = /^\s*(?:[*\u2022-]\s*)*(?:\(?\w{1,3}[.)]\s*)?(?:if|when|where|should|in case)\b/i.test(seg) || /:\s*$/.test(seg);
    // Population-conditional requirement in a multi-disease trial ("Subjects with ovarian cancer must have received ...").
    const conditional = multiGroup && diseasePopulationClause(seg, ctx);
    const timing = DRUG_TIMING.test(seg);
    const demote =
      !priorish || singleDrug ||
      /\b(pneumonitis|toxicit\w*|immune[- ]related|irAEs?|adverse|discontinu\w*|contracepti\w*)\b/i.test(seg) ||
      future || count || WASHOUT.test(seg) || ALLOWED.test(seg) || UNLESS.test(seg) || context || (incl && COHORT_PREFIX.test(seg)) || /\b(hypersensitivity|allerg|contraindicat|intoleran)/i.test(seg) ||
      DRUG_REPRODUCTIVE.test(seg) || timing || DRUG_OPTIONAL.test(seg) || DRUG_STOP.test(seg.slice(Math.max(0, m.index - 45), m.index)) || DRUG_STUDY_PLAN.test(seg) || conditional || conditionalOpener || negatedStatus || ifAfter || (incl && orEnd) || genericImid || (statusWord && !incl);
    if (demote) {
      out.push({ key, value: "mentioned", quote: seg });
    } else if (incl) {
      if (alternatives && !negated) out.push({ key, value: "mentioned", quote: seg });
      else out.push({ key, value: negated ? "excluded" : "required", quote: seg });
    } else out.push({ key, value: negated ? "mentioned" : "excluded", quote: seg });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Measurable disease
// ---------------------------------------------------------------------------------------------
function measurableFacts(section0: CriterionSection, seg: string): V2Candidate[] {
  const m = MEASURABLE.exec(seg);
  if (!m) return [];
  const section = effectiveSection(section0, seg);
  if (/\bmeasurable residual disease\b|\bMRD\b/i.test(seg.slice(Math.max(0, m.index - 5), m.index + 40))) return [];
  if (section === "exclusion") return [{ key: "measurable_disease", value: NON_MEASURABLE.test(seg) || /\bonly\b/i.test(seg) ? "mentioned" : "mentioned", quote: seg }];
  if (NON_MEASURABLE.test(seg) && !MEASURABLE_OPTIONAL.test(seg.replace(NON_MEASURABLE, ""))) {
    // "must not have measurable disease" (e.g. adjuvant / no-evidence-of-disease trials)
    if (/\b(no|not have|without)\s+(radiographic(ally)?\s+)?(evidence of\s+)?measurable\b/i.test(seg)) return [{ key: "measurable_disease", value: "excluded", quote: seg }];
    return [{ key: "measurable_disease", value: "mentioned", quote: seg }];
  }
  if (MEASURABLE_OPTIONAL.test(seg) || MEASURABLE_DEFINITION.test(seg) || /\b(cohorts?|parts?|arms?)\s+[A-Z0-9]/.test(seg) || OR_NEAR.test(seg.slice(Math.max(0, m.index - 25), m.index + 40)) || COHORT_PREFIX.test(seg) || ALLOWED.test(seg) || PERMISSIVE.test(seg) || /\b(if|when)\b[^.;]{0,30}\bmeasurable\b/i.test(seg)) {
    return [{ key: "measurable_disease", value: "mentioned", quote: seg }];
  }
  if (/\b(must|have|has|with|presence of|at least|documented|evidence of|required|requires?|per|by|according to|defined)\b/i.test(seg) || /^\s*measurable/i.test(seg)) return [{ key: "measurable_disease", value: "required", quote: seg }];
  return [{ key: "measurable_disease", value: "mentioned", quote: seg }];
}

// ---------------------------------------------------------------------------------------------
// Relapsed / refractory / recurrent
// ---------------------------------------------------------------------------------------------
/** "relapsed or refractory", "recurrent/progressive" name one state; collapse them before looking for alternatives. */
const RR_PAIR = /\b(relapsed|relapsing|recurrent|refractory|progressive|progressed|persistent|resistant)\s*(\/|,|or|and\/or|and)\s*(relapsed|relapsing|recurrent|refractory|progressive|progressed|persistent|resistant)\b/gi;

function recurrentFacts(section0: CriterionSection, seg0: string): V2Candidate[] {
  const seg = seg0;
  const flat = seg0.replace(RR_PAIR, (x) => "relapsed".padEnd(x.length, " "));
  const m = RECURRENT.exec(flat);
  if (!m) return [];
  if (/\brecurrently\b|\bfear of\b|\b(tissue|sample|specimen|biopsy)\b[^.;]{0,40}\b(recurren|relapse|progress)/i.test(seg)) return [];
  if (RECURRENT_NOT_DISEASE.test(seg) || RECURRENT_NOT_DISEASE_V4.test(seg) || (OTHER_CANCER.test(seg) && /\b(curative|in remission|disease[- ]free|no (known )?active)\b/i.test(seg))) return [];
  // A header ending in a colon introduces criteria or alternatives ("Progressive disease manifest by either:").
  if (/:\s*$/.test(seg.trim()) && !/\b(relapsed|refractory|recurrent)\b/i.test(seg)) return [{ key: "recurrent", value: "mentioned", quote: seg }];
  // Conditionals, examples, parentheticals, trailing "or", negated predicates and bare list bullets are not a requirement to be relapsed/refractory.
  if (
    insideParens(seg, m.index) ||
    /^\s*(?:[*\u2022-]\s*)*(?:\(?\w{1,3}[.)]\s*)?(?:if|when|where|should)\b/i.test(seg) ||
    EXAMPLE_CONTEXT.test(seg.slice(Math.max(0, m.index - 60), m.index)) ||
    /\b(?:or|OR)\s*$/.test(seg.trim()) ||
    /\b(?:must not|should not|may not|cannot|no prior|not have received)\b|^\s*(?:[*\u2022-]\s*)*no\b/i.test(seg) ||
    (/^\s*[*\u2022]\s/.test(seg) && seg.trim().split(/\s+/).length <= 6) ||
    /\b(?:ideally|status of the)\b/i.test(seg) ||
    /\bpatients? only\b/i.test(seg) ||
    RECURRENT_NOT_REQUIREMENT.test(seg) ||
    /\bif\b[^.;]{0,40}\b(?:recurrence|relapse)\b/i.test(seg)
  ) return [{ key: "recurrent", value: "mentioned", quote: seg }];
  const orNear = OR_NEAR.test(flat.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)) || /\//.test(flat.slice(Math.max(0, m.index - 2), m.index + m[0].length + 2));
  const section = effectiveSection(section0, seg);
  const lead = leadClause(seg, m.index, 50);
  // A washout or timing rule ("progressed within 6 months of ...") still requires progression; keep.
  if (section === "exclusion") {
    if (LEAD_NEGATION.test(lead) || UNLESS.test(seg) || PERMISSIVE.test(seg) || OR_NEAR.test(seg.slice(Math.max(0, m.index - 25), m.index + m[0].length + 25)) || /\b(after|following|within|post)\b/i.test(seg) || /\bprior (malignan|cancer)/i.test(seg)) {
      return [{ key: "recurrent", value: "mentioned", quote: seg }];
    }
    if (/^\s*(\W\s*)?(recurrent|relapsed|refractory)\b/i.test(seg) || /\b(with|has|have)\s+(recurrent|relapsed|refractory)\b/i.test(seg)) return [{ key: "recurrent", value: "excluded", quote: seg }];
    return [{ key: "recurrent", value: "mentioned", quote: seg }];
  }
  if (/\b(intoleran\w*|ineligible|not (a )?candidates?|refus\w*|declin\w*|no (effective |available )?standard|for which no|unable to receive|not eligible|or metastatic|or unresectable|newly diagnosed)\b/i.test(seg)) return [{ key: "recurrent", value: "mentioned", quote: seg }];
  if (orNear || LEAD_NEGATION.test(lead) || NEW_OR_RECURRENT_ALT.test(seg) || ALLOWED.test(seg) || PERMISSIVE.test(seg) || COHORT_PREFIX.test(seg) || /\bif\b[^.;]{0,30}\b(relapsed|refractory|recurrent|progress)/i.test(seg) || LIST_CONTEXT.test(seg)) {
    return [{ key: "recurrent", value: "mentioned", quote: seg }];
  }
  return [{ key: "recurrent", value: "required", quote: seg }];
}

// ---------------------------------------------------------------------------------------------
// Other malignancy
// ---------------------------------------------------------------------------------------------
/** The phrase names the trial's own organ/disease (a distinctive word of a registered condition). */
const GENERIC_CONDITION_WORDS = new Set(["cancer", "cancers", "carcinoma", "malignant", "malignancy", "advanced", "metastatic", "recurrent", "refractory", "relapsed", "stage", "locally", "solid", "tumor", "tumors", "tumour", "neoplasm", "neoplasms", "disease", "primary", "unresectable", "patients", "adenocarcinoma", "squamous", "cell", "cells", "carcinomas", "lymphoma", "leukemia", "chronic", "acute", "newly", "diagnosed", "previously", "treated", "untreated"]);
function ownDiseaseNamed(phrase: string, conditions: readonly string[] = []): boolean {
  const words = new Set<string>();
  for (const c of conditions) for (const w of c.toLowerCase().match(/[a-z]{5,}/g) ?? []) if (!GENERIC_CONDITION_WORDS.has(w)) words.add(w);
  const low = phrase.toLowerCase();
  for (const w of words) if (new RegExp(String.raw`\b${w}\b`).test(low)) return true;
  return false;
}

function otherMalignancyFacts(section0: CriterionSection, seg: string, ctxConditions?: readonly string[]): V2Candidate[] {
  const m = OTHER_CANCER.exec(seg);
  if (!m) return [];
  // "prior malignancy" in the trial's own disease sense (e.g. "prior therapy for this malignancy") is not another cancer.
  if (/\b(this|the (current|study|primary|index)|their|underlying|target) (malignan|cancer|neoplasm|tumou?r)/i.test(m[0])) return [];
  if (/\b(therapy|treatment|chemotherapy|regimen|radiation|surgery|lines?)\s+(for|of)\s+(the\s+)?(malignan|cancer)/i.test(seg) && !/\b(other|another|second|additional)\b/i.test(m[0])) return [];
  const section = effectiveSection(section0, seg);
  const lead = leadClause(seg, m.index, 40);
  if (/\b(?:chemotherapy|therapy|treatment|radiation|radiotherapy|surgery|regimens?)s?\s+(?:for|of)\b/i.test(m[0]) || /\b(?:their|the) child\b/i.test(seg)) return [{ key: "other_malignancy", value: "mentioned", quote: seg }];
  // "other variant prostate cancer histology" / "Prior history of endometrial cancer" (the trial's own organ) are not "another cancer".
  const phrase = seg.slice(m.index, m.index + m[0].length + 30);
  if (/\b(histology|histologic\w*|variant|subtype)\b/i.test(phrase) && !/\bmalignanc/i.test(m[0])) return [{ key: "other_malignancy", value: "mentioned", quote: seg }];
  if (ownDiseaseNamed(phrase, ctxConditions) && !/\b(other|another|second|additional|any|besides|apart)\b/i.test(m[0]) && !/\b(other than|except|excluding|apart from)\b/i.test(seg)) return [{ key: "other_malignancy", value: "mentioned", quote: seg }];
  // "History of colorectal cancer" (a specific cancer, e.g. screening populations) is not "any other cancer".
  const nounAt = m.index + m[0].search(/(malignan|cancer|neoplasm|primary tumou?r|invasive|second primary)\w*\s*$/i);
  const specific = !/\b(other|another|second|additional|any)\b/i.test(m[0]) && /\b(breast|colorectal|colon|rectal|lung|prostate|hepatobiliary|liver|ovarian|bladder|kidney|renal|skin|cervical|thyroid|gastric|pancreatic|oral|mouth|head and neck|bilateral)\s+$/i.test(seg.slice(Math.max(0, nounAt - 25), nounAt));
  if (specific || /\bother than cancer\b|\bnot an exclusion\b|\bnot excluded\b/i.test(seg) || /\bwithin\s+\d+\s*(days?|weeks?|months?)\b|\b\d+\s*(days?|weeks?)\s+(prior|before|of)\b/i.test(seg) || /\b(therap(y|ies)|treatment)\s+for\s+(a\s+|the\s+)?(primary or secondary|primary|secondary)?\s*malignan/i.test(seg)) {
    return [{ key: "other_malignancy", value: "mentioned", quote: seg }];
  }
  const judgment = OTHER_CANCER_JUDGMENT.test(seg);
  if (judgment) return [{ key: "other_malignancy", value: "mentioned", quote: seg }];
  const years = /life expectancy|expected to (live|survive)/i.test(seg) ? null : YEARS_WINDOW.exec(seg);
  const yearsParam = years ? toNum(years[1] as string) : undefined;
  const active = OTHER_CANCER_ACTIVE.test(seg) || /\b(?:therapy|treatment|chemotherapy)\s+(?:for|of)\s+(?:the\s+)?other\b/i.test(seg);
  // "unless treated with curative intent [or in remission N years]": cured cancers are allowed at any time => active only.
  // "unless treated with curative intent OR in remission for N years": any cured cancer is allowed => active only.
  // "... curative intent AND disease-free for N years": the window is N. Concurrent/synchronous-only wording is active only.
  const hasYears = yearsParam !== undefined && yearsParam > 0 && yearsParam <= 10;
  const curativeOr = /\bcurative(?:ly)?\b[^.;]{0,50}\bor\b[^.;]{0,40}\b(?:remission|disease[- ]free|no evidence)/i.test(seg);
  const curativeCarve = UNLESS.test(seg) && /\bcurative(ly)?\b|\bcurative intent\b/i.test(seg) && (!hasYears || curativeOr) && !/\bwithin\b/i.test(seg);
  const concurrentOnly = /\b(?:synchronous|concurrent|concomitant|simultaneous)\b/i.test(seg) && !/\b(?:history|prior|previous|past)\b/i.test(seg);
  const param: FactParam | undefined = curativeCarve || (concurrentOnly && !hasYears) ? "active_only" : yearsParam !== undefined && yearsParam > 0 && yearsParam <= 10 ? yearsParam : active ? "active_only" : undefined;
  const fact = (): V2Candidate => (param !== undefined ? { key: "other_malignancy", value: "excluded", param, quote: seg } : { key: "other_malignancy", value: "excluded", quote: seg });
  if (section === "exclusion") {
    // A carve-out sentence alone ("Patients with ... treated more than 3 years ago are eligible") still implies the rule.
    // "History of other malignancies, except:" — the exception list (and its time window) follows in other clauses: unclear.
    if (/^\s*(\W\s*)?(exceptions?|except|unless|note)\b/i.test(seg) || COHORT_PREFIX.test(seg) || /\b(except|exceptions?)( for)?\s*:?\s*$/i.test(seg)) return [{ key: "other_malignancy", value: "mentioned", quote: seg }];
    return [fact()];
  }
  // Inclusion: "No other malignancy within 3 years" / "must not have" => excluded; otherwise unclear.
  if (LEAD_NEGATION.test(lead) || /\b(must not|should not|cannot|may not)\b/i.test(seg.slice(0, m.index + 5))) return [fact()];
  return [{ key: "other_malignancy", value: "mentioned", quote: seg }];
}

// ---------------------------------------------------------------------------------------------
// Infections: HIV, hepatitis B/C
// ---------------------------------------------------------------------------------------------
function hivFacts(section0: CriterionSection, seg: string): V2Candidate[] {
  const m = HIV.exec(seg);
  if (!m) return [];
  // Notes about testing ("HIV testing is not required") are not rules.
  if (/\btest(ing|s)?\b/i.test(seg) && !/\b(known|history|positive|infection|infected|seropositive|active|uncontrolled)\b/i.test(seg)) return [];
  const section = effectiveSection(section0, seg);
  // Only qualifiers attached to HIV itself count ("active hepatitis B or C, or HIV" does not make HIV "uncontrolled only").
  const window = seg.slice(Math.max(0, m.index - 25), m.index + 220).replace(/\b(active|chronic|uncontrolled)\s+(hepatitis|HBV|HCV)[^,;]*/gi, "");
  const controlled = HIV_CONTROLLED_CARVEOUT.test(window.replace(/\b(not|in)eligible\b|\bnot eligible\b/gi, ""));
  if (/^AIDS$/i.test(m[0]) && !/\bHIV\b|human immunodeficiency/i.test(seg)) return [{ key: "hiv", value: "excluded", param: "uncontrolled_only", quote: seg }];
  if (section === "exclusion") {
    if (LEAD_NEGATION.test(leadClause(seg, m.index, 40)) && !/\b(known|positive|history)\b/i.test(seg)) return [{ key: "hiv", value: "mentioned", quote: seg }];
    return [controlled ? { key: "hiv", value: "excluded", param: "uncontrolled_only", quote: seg } : { key: "hiv", value: "excluded", quote: seg }];
  }
  if (HIV_REQUIRED.test(seg) && !PERMISSIVE.test(seg) && !/\bif\b/i.test(seg)) return [{ key: "hiv", value: "required", quote: seg }];
  if (/\b(HIV[- ]?negative|negative (for )?HIV|no (known )?(history of )?HIV|not (have|be) HIV|HIV (status|test(ing)?) negative|seronegative)/i.test(seg)) return [{ key: "hiv", value: "excluded", quote: seg }];
  if (PERMISSIVE.test(seg) || controlled) return [{ key: "hiv", value: "excluded", param: "uncontrolled_only", quote: seg }];
  return [{ key: "hiv", value: "mentioned", quote: seg }];
}

function hepatitisFacts(section0: CriterionSection, seg: string): V2Candidate[] {
  const out: V2Candidate[] = [];
  const section = effectiveSection(section0, seg);
  const hits = ([["hepatitis_b", HEP_B], ["hepatitis_c", HEP_C]] as const).map(([key, re]) => ({ key, m: re.exec(seg) }));
  for (const { key, m } of hits) {
    if (!m) continue;
    if (/\b(vaccin|immuniz)/i.test(seg) && !/\b(infection|active|positive|chronic)\b/i.test(seg)) continue;
    if ((/\b(testing|tests?|screening)\b[^.;]{0,40}\b(required|performed|must be)\b|\bmust be (tested|screened)\b/i.test(seg) && !/\b(excluded|ineligible|not eligible|must not|exclude)\b/i.test(seg) && !/\b(known|active)\b/i.test(seg)) || HEP_CARVEOUT_LEAD.test(seg.slice(0, m.index))) {
      out.push({ key, value: "mentioned", quote: seg });
      continue;
    }
    // Instructions about confirmatory testing ("nucleic acid quantitation must be performed") are not eligibility rules.
    if (/\b(quantitation|quantification|PCR|viral load|DNA|RNA)\b[^.;]{0,40}\bmust be (performed|done|obtained|measured|checked)\b|\bnecessary\b[^.;]{0,20}\btest/i.test(seg)) {
      out.push({ key, value: "mentioned", quote: seg });
      continue;
    }
    // Qualifiers belong to the marker they sit next to: stop the window at the other hepatitis marker, and fall
    // back to the whole clause when a list shares one qualifier ("Active infections, including TB, HIV or hepatitis B").
    const other = hits.find((h) => h.key !== key)?.m ?? null;
    const clauseStart = Math.max(seg.lastIndexOf(".", m.index), seg.lastIndexOf(";", m.index), seg.lastIndexOf(":", m.index)) + 1;
    let lo = Math.max(0, m.index - 50);
    let hi = m.index + 200;
    if (other && other.index !== m.index) {
      if (other.index < m.index && other.index + other[0].length > lo) lo = other.index + other[0].length;
      if (other.index > m.index && other.index < hi) hi = other.index;
    }
    let window = seg.slice(lo, hi);
    if (!HEP_QUALIFIER.test(window)) window = seg.slice(Math.max(clauseStart, m.index - 110), m.index + 200);
    const activeNear = /\b(?:active|uncontrolled|ongoing|acute)\b(?!\s+(?:or|and\/or|\/)\s+chronic)[^.;]{0,30}$/i.test(seg.slice(Math.max(clauseStart, m.index - 60), m.index + m[0].length));
    // "active or chronic", "any positive test", "HBsAg reactive/positive" exclude every infection, not only active ones.
    const pastOk = /\b(core antibody|anti-?HBc|HBcAb)\b/i.test(seg) && /\b(HBsAg|surface antigen)\b[^.;]{0,15}\bnegative\b/i.test(seg);
    const blanket = !pastOk && !activeNear && /\b(chronic(?:ally)?\s+(?:active\s+)?(?:hepatitis|HBV|HCV|viral|infection|infected)|history of|reactive|any positive|seropositive)\b/i.test(window) && !/\b(unless|except|eligible|allowed|permitted|provided|undetectable|detectable|untreated|cured|resolved|treated|requir\w+|not on|needing|in need of|active disease|meet(?:s)? (?:the )?criteria)\b/i.test(window);
    const active = pastOk || activeNear || (!blanket && HEP_ACTIVE_CARVEOUT.test(window));
    // "chronic or active" / "active or chronic": every infection is excluded (the carve-out words below do not apply).
    const everyInfection = /\bchronic\s+(?:or|and\/or|\/)\s+active\b|\bactive\s+(?:or|and\/or|\/)\s+chronic\b/i.test(window);
    if (section === "exclusion") {
      if ((PERMISSIVE.test(seg) || ALLOWED.test(seg)) && !/\b(known|history|positive|active|uncontrolled|detectable)\b[^.;]{0,30}\b(hepatitis|HBV|HCV)/i.test(seg)) {
        // Who MAY join: a virologic condition (undetectable load, negative PCR, resolved infection) makes it an "active infection only" rule; liver-function or etiology conditions do not.
        out.push(HEP_VIROLOGIC_CONDITION.test(seg) && !HEP_NOT_INFECTION_RULE.test(seg) ? { key, value: "excluded", param: "active_only", quote: seg } : { key, value: "mentioned", quote: seg });
      } else if (HEP_NOT_INFECTION_RULE.test(seg) && (PERMISSIVE.test(seg) || ALLOWED.test(seg))) out.push({ key, value: "mentioned", quote: seg });
      else if (LEAD_NEGATION.test(leadClause(seg, m.index, 40)) && !/\b(known|positive|history|active)\b/i.test(seg)) out.push({ key, value: "mentioned", quote: seg });
      else out.push(active && !everyInfection && !HEP_TEST_DEFINED.test(seg.slice(m.index, m.index + 120)) ? { key, value: "excluded", param: "active_only", quote: seg } : { key, value: "excluded", quote: seg });
      continue;
    }
    // Inclusion: liver trials requiring viral etiology, negative tests, or "if HBV, must be on antivirals".
    if (/\b(HBV|HCV|hepatitis [BC])[- ](related|associated|etiology|induced)|\b(etiology|aetiology)\b/i.test(seg) && !OR_NEAR.test(window) && !/\bif\b/i.test(seg)) out.push({ key, value: "required", quote: seg });
    else if (/\bnegative\b|\bno (active|known|evidence of|history of)?\s*(chronic )?(hepatitis|HBV|HCV)/i.test(window) && !PERMISSIVE.test(seg)) out.push({ key, value: "excluded", ...(active && !/\bnegative\b/i.test(window) ? { param: "active_only" } : {}), quote: seg });
    else if (/\b(HBV|HCV|hepatitis [BC])[- ]?(HCC|related|associated)|\b(viral|non-viral)[- ]HCC\b/i.test(seg)) out.push({ key, value: "mentioned", quote: seg });
    else if (HEP_NOT_INFECTION_RULE.test(seg)) out.push({ key, value: "mentioned", quote: seg });
    else if ((PERMISSIVE.test(seg) && HEP_VIROLOGIC_CONDITION.test(seg)) || (/\b(if|must|should|need)\b/i.test(window) && /\b(antiviral|viral load|undetectable|DNA\s*<)/i.test(window))) out.push({ key, value: "excluded", param: "active_only", quote: seg });
    else out.push({ key, value: "mentioned", quote: seg });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Transplant, autoimmune, organ disease
// ---------------------------------------------------------------------------------------------
function transplantFacts(section0: CriterionSection, seg: string): V2Candidate[] {
  const out: V2Candidate[] = [];
  const section = effectiveSection(section0, seg);
  const organ = ORGAN_TRANSPLANT.exec(seg);
  if (organ) {
    const lead = leadClause(seg, organ.index, 40);
    if (section === "exclusion" && !EXAMPLE_CONTEXT.test(lead) && !TRANSPLANT_FUTURE.test(seg) && !LEAD_NEGATION.test(lead) && !/(≤|<|<=|within|less than)\s*\d+\s*(days?|weeks?|months?)/i.test(seg)) out.push({ key: "organ_transplant", value: "excluded", quote: seg });
    else if (section === "inclusion" && LEAD_NEGATION.test(lead)) out.push({ key: "organ_transplant", value: "excluded", quote: seg });
    else out.push({ key: "organ_transplant", value: "mentioned", quote: seg });
  }
  const allo = /\ballograft\b/i.test(seg) && /\borgan\b/i.test(seg) && !/\b(stem[- ]cell|HSCT|HCT|BMT|bone marrow|hematopoietic)\b/i.test(seg) ? null : ALLO_SCT.exec(seg);
  if (allo && !/\btissue\/solid organ\b|\bsolid organ\b/i.test(seg.slice(allo.index, allo.index + 40)) || (allo && /\b(stem[- ]cell|HSCT|SCT|HCT|BMT|bone marrow|hematopoietic)\b/i.test(seg))) {
    const a = allo as RegExpExecArray;
    const lead = leadClause(seg, a.index, 50);
    const future = TRANSPLANT_FUTURE.test(seg);
    const prior = TRANSPLANT_PRIOR.test(seg);
    if (section === "exclusion") {
      if (WASHOUT.test(seg) || /(≤|<|<=|within|less than)\s*\d+\s*(days?|weeks?|months?)|\b\d+\s*(days?|weeks?|months?)\s*(ago|prior|before|of)\b/i.test(seg) || /\b(failed|ineligible|not eligible|indication)\b/i.test(seg) || /\b(GVHD|GvHD|graft[- ]versus[- ]host)\b/i.test(seg) && !/\b(prior|history of|previous)\b[^.;]{0,20}\ballo/i.test(seg) || UNLESS.test(seg) || future && !prior || LEAD_NEGATION.test(lead) || PERMISSIVE.test(seg)) out.push({ key: "allo_sct", value: "mentioned", quote: seg });
      else out.push({ key: "allo_sct", value: "excluded", quote: seg });
    } else if (LEAD_NEGATION.test(lead) && !future) out.push({ key: "allo_sct", value: "excluded", quote: seg });
    // Required only when stated as a must ("must have relapsed after allo-HCT"), not as one of several qualifying routes.
    else if (prior && !future && /\b(must|required|requires|only)\b/i.test(seg) && !OR_NEAR.test(seg) && !/\b(permissible|allowed|may|eligible|indication|including|evolved|if)\b/i.test(seg) && !ALLOWED.test(seg)) out.push({ key: "allo_sct", value: "required", quote: seg });
    else out.push({ key: "allo_sct", value: "mentioned", quote: seg });
  }
  return out;
}

function autoimmuneFacts(section0: CriterionSection, seg: string): V2Candidate[] {
  const m = AUTOIMMUNE.exec(seg);
  if (!m) return [];
  const section = effectiveSection(section0, seg);
  const lead = leadClause(seg, m.index, 40);
  if ((EXAMPLE_CONTEXT.test(lead) || /\b(?:such as|including|e\.g\.?|for example)\b/i.test(seg.slice(0, m.index))) && !/^\s*(\W\s*)?(active|history|known|any)/i.test(seg)) return [{ key: "autoimmune", value: "mentioned", quote: seg }];
  // "(eg, autoimmune disease, active infection)" lists autoimmune disease as an example of a vague interfering condition;
  // "steroids are permitted in the absence of active autoimmune disease" is a steroid carve-out.
  if (/\b(?:eg|ie|e\.g|i\.e)\b[^.;]{0,25}$/i.test(seg.slice(0, m.index)) || /\b(?:interfere|hazard|condition or disease)\b/i.test(seg) && /\(\s*(?:eg|e\.g|such as)/i.test(seg) || /\bin the absence of\b[^.;]{0,15}$/i.test(seg.slice(0, m.index)) || /\b(?:inhaled|topical|replacement|physiologic)\b[^.;]{0,60}\b(?:permitted|allowed)\b/i.test(seg)) return [{ key: "autoimmune", value: "mentioned", quote: seg }];
  // Narrow subsets ("autoimmune disease affecting hair / with CNS involvement") are not "any autoimmune disease".
  if (/^\s*(\w+\s+){0,2}(affecting|involving|with (central|cns|neurolog))/i.test(seg.slice(m.index + m[0].length, m.index + m[0].length + 40))) return [{ key: "autoimmune", value: "mentioned", quote: seg }];
  // "history of", "known or suspected", "active or history" exclude any history: no carve-out param.
  // Time- or treatment-limited wording ("requiring systemic treatment", "in the past 2 years", "within 90 days") makes it an active-disease rule even after "history of".
  const limited = /\b(?:requir\w+|treated|treatment|therapy|immunosuppress\w*)\b[^.;]{0,40}\b(?:in|within|during) the (?:past|last|previous)\b|\b(?:requir\w+|resulting in)\b[^.;]{0,25}\b(?:systemic|immunosuppress\w*|steroids?|corticosteroids?|disease[- ]modifying)/i.test(seg) || /\b(?:in|within|during|over)\s+(?:the\s+)?(?:past|last|previous|preceding)\s+(?:\w+\s+){0,2}(?:days?|weeks?|months?|years?)\b|[≤<]\s*\d+\s*(?:days?|weeks?|months?|years?)|\bwithin\s+\w+\s+(?:days?|months?|years?)\b/i.test(seg);
  // Without such limits, any "history of / known or suspected / active or history" wording excludes every autoimmune patient (exceptions are carve-outs, not limits).
  const history = /\b(history|known or suspected|suspected|prior|known)\b/i.test(seg.slice(0, m.index + 5)) && !/\b(remote|well[- ]controlled)\b/i.test(seg) || /\b(?:or|and\/or) (?:a )?history\b|\bhistory (?:of )?(?:or|and\/or) active\b/i.test(seg);
  const active = limited || (!history && /\b(active|uncontrolled|ongoing|currently|symptomatic|requir\w+)\b/i.test(seg));
  if (section === "inclusion" && !/^\s*(\W\s*)?(no|must not|participants must not|patients must not)\b/i.test(seg)) return [{ key: "autoimmune", value: "mentioned", quote: seg }];
  if (section === "exclusion") {
    if (/^\s*(\W\s*)?(exceptions?|note)\b/i.test(seg) || (LEAD_NEGATION.test(lead) && !/\b(active|history|known)\b/i.test(seg))) return [{ key: "autoimmune", value: "mentioned", quote: seg }];
    return [active ? { key: "autoimmune", value: "excluded", param: "active_only", quote: seg } : { key: "autoimmune", value: "excluded", quote: seg }];
  }
  if (LEAD_NEGATION.test(lead)) return [active ? { key: "autoimmune", value: "excluded", param: "active_only", quote: seg } : { key: "autoimmune", value: "excluded", quote: seg }];
  return [{ key: "autoimmune", value: "mentioned", quote: seg }];
}

function organFacts(section0: CriterionSection, seg: string): V2Candidate[] {
  const out: V2Candidate[] = [];
  const section = effectiveSection(section0, seg);
  for (const [key, re] of [["heart_disease", HEART_DISEASE], ["kidney_disease", KIDNEY_DISEASE], ["liver_disease", LIVER_DISEASE]] as const) {
    const m = re.exec(seg);
    if (!m) continue;
    const lead = leadClause(seg, m.index, 40);
    // Lab-only criteria ("LVEF < 50%") are skipped by the pattern; a disease word next to a lab cut-off is still the disease.
    const labOnly = ORGAN_LAB.test(seg) && !/\b(history of|known|active|uncontrolled|symptomatic|clinically significant|requiring|class (II|III|IV|3|4))\b/i.test(seg);
    if (section === "exclusion") {
      if (EXAMPLE_CONTEXT.test(lead) && !/^\s*(\W\s*)?(clinically significant|significant|active|uncontrolled|history|known|any)/i.test(seg)) out.push({ key, value: "mentioned", quote: seg });
      else if (labOnly || PERMISSIVE.test(seg) || (LEAD_NEGATION.test(lead) && !/\b(known|history|active|significant)\b/i.test(seg))) out.push({ key, value: "mentioned", quote: seg });
      else out.push({ key, value: "excluded", quote: seg });
    } else if (LEAD_NEGATION.test(lead) && !labOnly && !PERMISSIVE.test(seg)) out.push({ key, value: "excluded", quote: seg });
    else out.push({ key, value: "mentioned", quote: seg });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Group status and stage setting
// ---------------------------------------------------------------------------------------------
function statusFacts(section0: CriterionSection, seg: string): V2Candidate[] {
  const out: V2Candidate[] = [];
  const section = effectiveSection(section0, seg);
  const incl = section === "inclusion";
  const pair = (key: FactKey, pos: RegExp, neg: RegExp | null) => {
    const p = pos.exec(seg);
    const n = neg ? neg.exec(seg) : null;
    if (!p && !n) return;
    if (p && n) return void out.push({ key, value: "mentioned", quote: seg });
    const hit = (p ?? n) as RegExpExecArray;
    const lead = leadClause(seg, hit.index, 40);
    if (insideParens(seg, hit.index) || /\b(defined as|is defined|definition)\b/i.test(seg) || /\b(therap\w*|treatment|agents?|use|radioisotope|setting of)\s+(for|in|of)\s+(the\s+)?(metastatic\s+)?$/i.test(seg.slice(Math.max(0, hit.index - 30), hit.index))) return void out.push({ key, value: "mentioned", quote: seg });
    const negated = LEAD_NEGATION.test(lead);
    const optional = OR_NEAR.test(seg.slice(Math.max(0, hit.index - 30), hit.index + hit[0].length + 30)) || LIST_CONTEXT.test(seg) || COHORT_PREFIX.test(seg) || PERMISSIVE.test(seg) || ALLOWED.test(seg);
    const presence: FactValue = p ? "required" : "excluded"; // inclusion of the positive form => required; of the opposite form => excluded
    if (incl) {
      if (optional) out.push({ key, value: "mentioned", quote: seg });
      else if (negated) out.push({ key, value: presence === "required" ? "excluded" : "mentioned", quote: seg });
      else out.push({ key, value: presence, quote: seg });
    } else if (negated || UNLESS.test(seg) || PERMISSIVE.test(seg) || EXAMPLE_CONTEXT.test(lead)) out.push({ key, value: "mentioned", quote: seg });
    else out.push({ key, value: presence === "required" ? "excluded" : "mentioned", quote: seg });
  };
  pair("castration_resistant", CRPC, CSPC);
  pair("mibc", MIBC, NMIBC);
  pair("rai_refractory", RAI_REFRACTORY, null);
  // Platinum: resistant and sensitive are separate keys (refractory counts as resistant).
  const pr = PLATINUM_RESISTANT.exec(seg);
  const ps = PLATINUM_SENSITIVE.exec(seg);
  if (pr && ps) out.push({ key: "platinum_resistant", value: "mentioned", quote: seg }, { key: "platinum_sensitive", value: "mentioned", quote: seg });
  else if (pr) pair("platinum_resistant", PLATINUM_RESISTANT, null);
  else if (ps) pair("platinum_sensitive", PLATINUM_SENSITIVE, null);
  // Resectability: "resectable" required vs "unresectable" (=> resectable patients excluded). Borderline is its own answer.
  const un = UNRESECTABLE.exec(seg);
  const re = RESECTABLE.exec(seg);
  if (BORDERLINE.test(seg) || (un && re)) {
    out.push({ key: "resectable", value: "mentioned", quote: seg });
  } else if (un) {
    const lead = leadClause(seg, un.index, 30);
    if (incl && !LEAD_NEGATION.test(lead) && !PERMISSIVE.test(seg) && !/\b(resectable|surgery)\b[^.;]{0,20}\bor\b/i.test(seg)) out.push({ key: "resectable", value: "excluded", quote: seg });
    else out.push({ key: "resectable", value: "mentioned", quote: seg });
  } else if (re) pair("resectable", RESECTABLE, null);
  return out;
}

function stageFacts(section0: CriterionSection, seg: string): V2Candidate[] {
  const out: V2Candidate[] = [];
  const section = effectiveSection(section0, seg);
  const la = LOCALLY_ADVANCED.exec(seg);
  if (la) {
    const near = seg.slice(Math.max(0, la.index - 40), la.index + la[0].length + 40);
    const optional = OR_NEAR.test(near) || /\//.test(near) || LIST_CONTEXT.test(seg) || COHORT_PREFIX.test(seg) || PERMISSIVE.test(seg) || /\bmetasta/i.test(seg) || /\bborderline\b|\b(defined|definition)\b/i.test(seg) || LOCALLY_ADVANCED_NOT_STATUS.test(seg) || insideParens(seg, la.index);
    if (section === "inclusion" && !optional && !LEAD_NEGATION.test(leadClause(seg, la.index, 30))) out.push({ key: "locally_advanced", value: "required", quote: seg });
    else out.push({ key: "locally_advanced", value: "mentioned", quote: seg });
  }
  const adj = ADJUVANT_SETTING.exec(seg);
  // "No evidence of disease" / "NED" is a post-treatment state only next to surgery or therapy wording.
  const ned = !adj ? ADJUVANT_NED.exec(seg) : null;
  const nedOk = !!ned && ADJUVANT_NED_CONTEXT.test(seg);
  const hit = adj ?? (nedOk ? ned : null);
  if (hit && section === "inclusion") {
    const near = seg.slice(Math.max(0, hit.index - 40), hit.index + hit[0].length + 40);
    const prior = /\b(prior|previous|history of|received|exposure|treatment|therapy|after (completion of )?adjuvant|completed adjuvant)\b[^.;]{0,60}\badjuvant\b/i.test(seg) && /adjuvant/i.test(hit[0]);
    const optional = OR_NEAR.test(near) || COHORT_PREFIX.test(seg) || PERMISSIVE.test(seg) || ALLOWED.test(seg) || prior || ADJUVANT_FUTURE.test(seg.replace(/\bresectable\b/gi, "")) || ADJUVANT_NOT_STATUS.test(seg) || insideParens(seg, hit.index) || /\bbrain metasta|\bprogression\b/i.test(seg) || (/\bneo-?adjuvant\b/i.test(near) && !/\bcomplete/i.test(near));
    if (!optional && !LEAD_NEGATION.test(leadClause(seg, hit.index, 25))) out.push({ key: "adjuvant_setting", value: "required", quote: seg });
    else out.push({ key: "adjuvant_setting", value: "mentioned", quote: seg });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Histology / subtype
// ---------------------------------------------------------------------------------------------
/** Histology ids a trial's own conditions/title mention (every pattern, every group). */
function conditionHistologies(conditions: readonly string[]): Set<string> {
  const text = conditions.join(" ; ");
  const ids = new Set<string>();
  for (const h of HISTOLOGY_PATTERNS) if (h.re.test(text) && !h.negated?.test(text)) ids.add(h.id);
  // "Squamous NSCLC" names one disease: the parent/child pair is not a list of competing diseases.
  if (ids.has("nsclc") && ids.has("lung_squamous")) ids.delete("lung_squamous");
  return ids;
}

function histologyFacts(section0: CriterionSection, seg: string, ctx: ExtractContext): V2Candidate[] {
  const section = effectiveSection(section0, seg);
  const hits: { key: FactKey; id: string; idx: number; negated: boolean; group: CancerGroupId }[] = [];
  for (const h of HISTOLOGY_PATTERNS) {
    if (!h.groups.some((g) => ctx.groups.includes(g))) continue;
    const neg = h.negated?.exec(seg);
    if (neg) {
      hits.push({ key: `histology:${h.id}` as FactKey, id: h.id, idx: neg.index, negated: true, group: h.groups[0] as CancerGroupId });
      continue;
    }
    const m = h.re.exec(seg);
    if (m) hits.push({ key: `histology:${h.id}` as FactKey, id: h.id, idx: m.index, negated: false, group: h.groups[0] as CancerGroupId });
  }
  if (hits.length === 0) return [];
  const out: V2Candidate[] = [];
  // Several histologies of the same group in one inclusion clause = a list of eligible types.
  const perGroup = new Map<CancerGroupId, number>();
  for (const h of hits) if (!h.negated) perGroup.set(h.group, (perGroup.get(h.group) ?? 0) + 1);
  const listy = LIST_CONTEXT.test(seg) || COHORT_PREFIX.test(seg) || /\b(cohort|arm|part)\s+[A-Z0-9]{1,2}\b/.test(seg) || /\b(including|such as|e\.g|i\.e)\b/i.test(seg);
  const gated = ctx.conditions !== undefined;
  const condIds = gated ? conditionHistologies(ctx.conditions ?? []) : new Set<string>();
  // Clause is about a response/definition rule, a second cancer, or treatment history rather than the diagnosis itself.
  const notDiagnosis = HISTOLOGY_DEFINITION.test(seg) || (section === "exclusion" && HISTOLOGY_SECOND_CANCER.test(seg));
  for (const h of hits) {
    const lead = leadClause(seg, h.idx, 50).replace(/^[^)]*\)/, "");
    const around = seg.slice(Math.max(0, h.idx - 30), h.idx + 50);
    const own = condIds.has(h.id);
    const competing = [...condIds].some((id) => id !== h.id);
    const confirmed = HISTOLOGY_CONFIRM.test(seg.slice(Math.max(0, h.idx - 70), h.idx + 12));
    const therapyBefore = HISTOLOGY_THERAPY.test(seg.slice(Math.max(0, h.idx - 90), h.idx));
    // Molecular/biologic qualifiers before the term ("Ph+ leukemia", "FLT3-mutated AML"), a sub-grade after it ("FL grade 3B"), transformation, testing notes and "For X," openers narrow or change the rule.
    const narrowed =
      (section === "exclusion" && h.id !== "all" && HISTOLOGY_QUALIFIER.test(seg.slice(Math.max(0, h.idx - 40), h.idx))) ||
      /\bgrade\s*(?:3\s*b|iii\s*b)\s*$/i.test(seg.slice(Math.max(0, h.idx - 14), h.idx)) ||
      /^\s*(?:[*\u2022-]\s*)*note\b/i.test(seg) ||
      (/^\s*[*\u2022]\s/.test(seg) && seg.trim().split(/\s+/).length <= 6) ||
      HISTOLOGY_SUBGRADE.test(seg.slice(h.idx, h.idx + 45)) ||
      HISTOLOGY_TRANSFORMED.test(seg) ||
      (section === "exclusion" && (HISTOLOGY_TESTING.test(seg) || /^\s*(?:[*\u2022-]\s*)*for\b/i.test(seg))) ||
      insideParens(seg, h.idx);
    if (notDiagnosis || narrowed || (therapyBefore && !confirmed)) {
      out.push({ key: h.key, value: "mentioned", quote: seg });
      continue;
    }
    if (h.negated) {
      out.push({ key: h.key, value: section === "inclusion" && !OR_NEAR.test(around) && !listy && (!gated || confirmed) && !ctx.alt ? "excluded" : "mentioned", quote: seg });
      continue;
    }
    const negLead = LEAD_NEGATION.test(lead) || /\b(other than|excluding|except)\b/i.test(lead);
    // "prior therapy for CLL", "treatment for rectal cancer", "blast phase CML": about treatment or a phase, not the histology rule.
    const aside = /\b(therap(y|ies)|treatments?|treated|treating|regimens?|agents?|drugs?|chemotherapy|transplant\w*|surgery|evaluation|testing|criteria)\s+(for|of|by)\s+(the\s+|their\s+|a\s+)?(\w+\s+){0,2}$/i.test(seg.slice(Math.max(0, h.idx - 45), h.idx)) || /\b(blast (phase|crisis)(\s+of)?|accelerated phase|transformed|therapy-related|secondary)\s+$/i.test(seg.slice(Math.max(0, h.idx - 25), h.idx));
    if (aside || (section === "inclusion" && listy)) {
      out.push({ key: h.key, value: "mentioned", quote: seg });
      continue;
    }
    if (section === "inclusion") {
      const multiple = (perGroup.get(h.group) ?? 0) > 1;
      // Required needs the trial's own disease: the condition list names it and no other disease, or names nothing and the clause is a plain diagnosis.
      const evidence = !gated || (own && !competing) || (condIds.size === 0 && ctx.groups.length === 1 && confirmed);
      if (negLead) out.push({ key: h.key, value: gated && !confirmed ? "mentioned" : "excluded", quote: seg });
      else if (!/\b(histolog\w*|cytolog\w*|patholog\w*|confirmed|diagnos\w*|documented|proven|must have|with (a )?(known )?)\b/i.test(seg) && !(/^\s*(\W\s*)?[A-Za-z-]+(\s+[A-Za-z-]+){0,4}\s*\.?$/.test(seg) && (!gated || (own && !competing)))) out.push({ key: h.key, value: "mentioned", quote: seg });
      else if (!evidence || ctx.alt || multiple || listy || OR_NEAR.test(around) || PERMISSIVE.test(seg) || ALLOWED.test(seg) || /\b(history of|prior|previous|transformed|transformation|secondary to|arising from|component|features|mixed)\b/i.test(seg)) out.push({ key: h.key, value: "mentioned", quote: seg });
      else out.push({ key: h.key, value: "required", quote: seg });
    } else {
      // Exclusion: "Mixed small cell histology", "uveal or mucosal melanoma" => excluded. Never the trial's own disease.
      if (own || negLead || UNLESS.test(seg) || PERMISSIVE.test(seg) || EXAMPLE_CONTEXT.test(lead) || /\b(after|following|with|del\(|deletion|t\(|acute promyelocytic|APL|therapy|treatment|transformation|transformed)\b/i.test(seg.slice(h.idx, h.idx + 60)) && !/^\s*(\W\s*)?(known |diagnosis of |patients with |participants with )?\S+(\s+\S+){0,3}\s*\.?$/i.test(seg) || /\b(prior|previous|history of|treated for)\b[^.;]{0,30}$/i.test(seg.slice(0, h.idx))) out.push({ key: h.key, value: "mentioned", quote: seg });
      else out.push({ key: h.key, value: "excluded", quote: seg });
    }
  }
  return out;
}

/** All family candidate facts in one clause of one criterion. Pure; exported for tests. */
/** The clause (or its criterion's header) limits the rule to one cohort, part, arm or subgroup. */
export function cohortSpecific(seg: string): boolean {
  return COHORT_PREFIX.test(seg) || /\(\s*[\w\s-]{1,25}\s+(?:cohort|arm|group)\s*\)/i.test(seg) || /\bbackfill\s+cohorts?\b|\bin the (?:dose[- ])?(?:expansion|escalation)\b|\b[Rr]egimens?\s+[A-Z]\d?\b/.test(seg) || /\bcohorts?\s+only\b|\b(?:dose[- ])?(?:expansion|escalation)\s+(?:cohorts?|parts?|phase)\b/i.test(seg) || /\b([Cc]ohorts?|[Pp]arts?|[Aa]rms?|[Mm]odules?|[Gg]roups?|[Ss]teps?|[Ee]scalation|[Ee]xpansion|[Bb]ackfill)\s+[A-Z0-9]{1,3}[a-z]?\b(?!\s*(cells?|years?|weeks?|months?|days?|%))/.test(seg) || /\b(additional|specific) (inclusion|exclusion|eligibility) criteria for\b|\bfor (participants|patients|subjects) (with|in|enrolled|receiving)\b|\b(dose[- ]escalation|dose[- ]expansion|backfill|phase 1[ab]?|phase 2)( cohort| part| portion)?\s*(only)?\s*[:)]/i.test(seg);
}

/** Families whose rule usually holds trial-wide even when stated per part (the lenient merge handles parts). */
const COHORT_EXEMPT = new Set<string>(["ecog_max"]);

/** Families whose directional facts are demoted when the clause is one option of a list or belongs to a named sub-population. */
const POPULATION_FAMILIES = new Set<string>(["histology", "lines", "prior_drug", "recurrent", "stage", "biomarker_v2"]);

/** True when a clause is an option under an "one of the following" header or is addressed to a named sub-population. */
export function subPopulationClause(section: CriterionSection, seg: string, alt = false): boolean {
  const s = effectiveSection(section, seg);
  return (alt && s === "inclusion") || populationLabel(seg) || SUBGROUP_OPENER.test(seg);
}

export function v2FactsForSegment(section: CriterionSection, seg: string, ctx: ExtractContext): V2Candidate[] {
  const all = rawV2Facts(section, seg, ctx);
  const cohort = ctx.cohort || cohortSpecific(seg);
  const sub = subPopulationClause(section, seg, ctx.alt);
  if (!cohort && !sub) return all;
  return all.map((f) => (f.value === "mentioned" || (cohort && COHORT_EXEMPT.has(f.key)) || (!cohort && !POPULATION_FAMILIES.has(familyOf(f.key) ?? "")) ? f : { key: f.key, value: "mentioned" as const, quote: f.quote }));
}

function rawV2Facts(section: CriterionSection, seg: string, ctx: ExtractContext): V2Candidate[] {
  return [
    ...performanceFacts(section, seg),
    ...brainFacts(section, seg),
    ...linesFacts(section, seg, ctx),
    ...drugFacts(section, seg, ctx),
    ...measurableFacts(section, seg),
    ...recurrentFacts(section, seg),
    ...otherMalignancyFacts(section, seg, ctx.conditions),
    ...hivFacts(section, seg),
    ...hepatitisFacts(section, seg),
    ...transplantFacts(section, seg),
    ...autoimmuneFacts(section, seg),
    ...organFacts(section, seg),
    ...statusFacts(section, seg),
    ...stageFacts(section, seg),
    ...histologyFacts(section, seg, ctx),
  ];
}

/**
 * Lenient merge for parameterized keys when several criteria state them: the rule that excludes the
 * fewest patients wins (highest ECOG ceiling, lowest minimum and highest maximum line count, shortest
 * other-cancer window, and carve-outs over blanket exclusions). Returns true if `next` should replace `prev`.
 */
export function moreLenient(key: string, prev: { value: FactValue; param?: FactParam }, next: { value: FactValue; param?: FactParam }): boolean {
  if (prev.value !== next.value) return false;
  const a = prev.param;
  const b = next.param;
  // Washout windows are timing rules on top of the criterion set: a blanket rule is kept over a window.
  if (isScopedParam(b)) return false;
  if (isScopedParam(a)) return true;
  if (b === undefined) return false;
  if (a === undefined) return true; // a carve-out/threshold beats a blanket rule
  if (typeof a === "number" && typeof b === "number") {
    if (key === "min_prior_lines" || key === "other_malignancy") return b < a;
    return b > a; // ecog_max, max_prior_lines
  }
  return typeof a === "number" && typeof b === "string"; // "active_only" beats a years window
}
