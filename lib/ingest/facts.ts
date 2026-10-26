import { BIOMARKERS } from "@/config/biomarkers";
import {
  ALLOWED,
  ALT_HEADER,
  ALTERNATIVE_NEAR,
  CONCURRENT_TRIAL,
  EXAMPLE_CONTEXT,
  LIST_CONTEXT,
  OR_NEAR,
  OTHER_MALIGNANCY,
  OTHER_STAGES,
  UNLESS,
  V2_MARKER_ASSERTED,
  V2_MARKER_PERMISSIVE,
  V2_MARKER_SUBGROUP_AFTER,
  V2_MARKER_TESTING,
  LOCAL_METASTASES_ONLY,
  METASTATIC,
  NEGATION,
  NEGATIVE_WORDS,
  NEWLY_DIAGNOSED,
  NON_METASTATIC,
  POSITIVE_WORDS,
  PREGNANCY,
  PREVIOUSLY_TREATED,
  PRIOR_CONTEXT,
  THERAPY_NOT_HISTORY,
  THERAPY_PATTERNS,
  THERAPY_PLANNED_LEAD,
  THERAPY_SPECIMEN_AFTER,
  THERAPY_SPECIMEN_LEAD,
  TRIPLE_NEGATIVE,
  WASHOUT,
} from "@/config/criteria";
import type { CancerGroupId } from "@/config/cancer-groups";
import type { Criterion, CriterionSection, Fact, FactKey, FactParam, FactValue } from "@/lib/types/trial";
import { cohortSpecific, diseasePopulationClause, effectiveSection, moreLenient, subPopulationClause, v2FactsForSegment } from "./eligibility-facts";

/** `quote` is set for catalog families (the clause); legacy facts quote the whole criterion. */
/** Biomarkers added with the questionnaire (§1.4): stricter direction rules than the first markers. */
const V2_BIOMARKERS = new Set<string>(["MET", "RET", "HPV", "CLDN18", "PH", "NPM1", "TP53", "MGMT", "PIK3CA", "ESR1", "PALB2", "KIT"]);

type Candidate = { key: FactKey; value: FactValue; param?: FactParam; quote?: string };

/** Strength order when one key is found several times: a directional fact beats "mentioned". */
const STRENGTH: Record<FactValue, number> = { required: 2, excluded: 2, mentioned: 1 };

/** Split a criterion into clause-level segments so a negation or list in one sentence cannot affect another. */
export function segments(text: string): string[] {
  const guarded = text.replace(/\b(e\.g|i\.e|vs|approx|incl|etc)\./gi, (m) => m.replace(".", "\u0001"));
  return guarded
    .split(/\n+|(?<=[.;?!])\s+(?=[A-Z0-9(\[*\u2022-])|\s+(?=\d{1,2}(?:\.\d{1,2})+\.?\s+[A-Z])|(?<=\S)\s+(?=[*•]\s+\S)/)
    .map((x) => x.replace(/\u0001/g, ".").trim())
    .filter(Boolean);
}

/** Extract rule-layer candidate facts from a single criterion (v1 families; `v2: true` adds the v2 families). Pure; exported for tests. */
export function factsForCriterion(section: CriterionSection, text: string, opts: { v2?: boolean; groups?: readonly CancerGroupId[]; conditions?: readonly string[] } = {}): Candidate[] {
  const best = new Map<FactKey, Candidate>();
  const segs = segments(text);
  // A criterion that opens with a cohort/part header ("Part B:", "Additional criteria for participants with mCRPC:")
  // makes every clause in it cohort-specific.
  const cohort = segs.length > 1 && cohortSpecific(segs[0] ?? "");
  // Clauses under an "one of the following indications:" header are options, not requirements (reset by the next numbered item).
  let alt = false;
  for (const seg of segs) {
    if (/^\s*\d{1,2}[.)]\s/.test(seg) && !ALT_HEADER.test(seg)) alt = false;
    const v2 = opts.v2 ? v2FactsForSegment(section, seg, { groups: opts.groups ?? [], cohort, alt, ...(opts.conditions ? { conditions: opts.conditions } : {}) }) : [];
    const demote = opts.v2 && (cohort || cohortSpecific(seg) || subPopulationClause(section, seg, alt));
    const own = factsForSegment(section, seg, opts.groups ?? []).map((c) => (demote && c.quote !== undefined && c.value !== "mentioned" ? { key: c.key, value: "mentioned" as const, quote: c.quote } : c));
    for (const c of [...own, ...v2]) {
      const prev = best.get(c.key);
      if (!prev || STRENGTH[c.value] > STRENGTH[prev.value] || (STRENGTH[c.value] === STRENGTH[prev.value] && moreLenient(c.key, prev, c))) best.set(c.key, c);
    }
    if (ALT_HEADER.test(seg) && /[:;]\s*$|following/i.test(seg)) alt = true;
  }
  // "History of other malignancy, except for:" followed by an exception list: take the window from the list.
  const om = best.get("other_malignancy");
  if (opts.v2 && om && om.value === "excluded" && om.param === undefined && om.quote) {
    const at = segs.findIndex((x) => x === om.quote);
    if (at >= 0 && /\b(?:except(?:ion|ions)?(?: for| of)?|unless|other than|with the exception of)\s*:?\s*$/i.test(segs[at] as string)) {
      const tail = segs.slice(at + 1, at + 9).join(" ");
      const yr = /\b(?:free|remission|no evidence|diagnosed|treated|treatment|ago|since|prior|years? (?:of|from))\b[^.;]{0,50}?\b(\d{1,2}|one|two|three|four|five|ten)\s*(?:\(\d+\)\s*)?years?\b|\b(\d{1,2}|one|two|three|four|five|ten)\s*years?\b[^.;]{0,40}\b(?:free|remission|no evidence|ago|since|disease)\b/i.exec(tail);
      const n = yr ? Number(yr[1] ?? yr[2]) || ({ one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10 } as Record<string, number>)[(yr[1] ?? yr[2] ?? "").toLowerCase()] : undefined;
      const param: FactParam | undefined = n && n > 0 && n <= 10 ? n : /\b(?:curative|cured|curatively|no evidence of disease|complete remission|NED)\b/i.test(tail) ? "active_only" : undefined;
      if (param !== undefined) best.set("other_malignancy", { ...om, param });
    }
  }
  return [...best.values()];
}

/** Exclusion naming the setting of prior therapy: "prior systemic therapy for metastatic disease". */
const PRIOR_SYSTEMIC_FOR_STAGE = /\b(?:prior|previous|any)\s+(?:systemic|anti-?cancer|cancer-directed)\s+(?:therapy|therapies|treatments?)\s+(?:for|in)\s+(?:the\s+)?(?:metastatic|advanced|recurrent|unresectable)\b/i;
/** "have not received any prior therapy (for this cancer)". */
const NOT_RECEIVED_PRIOR = /\b(?:not|never)\s+(?:have\s+|has\s+)?(?:previously\s+)?(?:received|had|undergone|been treated with)\s+(?:any\s+)?(?:prior\s+|previous\s+)?(?:systemic\s+|anti-?cancer\s+)?(?:therapy|therapies|treatments?)\b/i;
const WINDOW_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, twelve: 12 };

/**
 * The two narrow "previously treated is excluded" patterns ("prior systemic therapy for metastatic disease",
 * "have not received any prior therapy"). The previously_treated key as a whole is below the precision gate
 * (eval/facts-labels-v3.json, 6/10), but none of its labeled errors came from these, so the resolver may still settle
 * them.
 */
export function preciseTreatedExclusion(section: CriterionSection, text: string): boolean {
  return section === "exclusion" ? PRIOR_SYSTEMIC_FOR_STAGE.test(text) : NOT_RECEIVED_PRIOR.test(text) && !ALLOWED.test(text) && !UNLESS.test(text);
}

/**
 * Washout window of an exclusion clause as a scoped param ("within 4 weeks" -> "within_4_weeks", "28 days prior to"
 * -> "within_28_days"; half-lives or an unparsed window -> "window"); null when the clause states no window.
 */
function washoutParam(text: string): string | null {
  const m = /\bwithin\s+(?:the\s+)?(?:(?:last|past|previous|prior)\s+)?(\d{1,3}|one|two|three|four|five|six|eight|twelve)\s*(?:\(\d+\)\s*)?(day|week|month|year)s?\b/i.exec(text) ?? /\b(\d{1,3})\s*(day|week|month|year)s?\s+(?:prior|before|of)\b/i.exec(text);
  if (m) {
    const n = WINDOW_WORDS[(m[1] ?? "").toLowerCase()] ?? Number(m[1]);
    return `within_${n}_${(m[2] ?? "").toLowerCase()}s`;
  }
  return WASHOUT.test(text) ? "window" : null;
}

/** Collapse "X1 or X2" when both sides match the same marker pattern, so the "or" no longer reads as an option. */
function sameMarkerAlternatives(window: string, pattern: RegExp): string {
  const src = pattern.source;
  const flags = pattern.flags.replace("g", "");
  return window.replace(new RegExp(`(${src})\\s*(?:,|\\/|\\bor\\b|\\band\\/or\\b)\\s*(?=${src})`, `${flags}g`), "$1 ");
}

/** True when an unclosed "(" precedes `index`, i.e. the match sits inside a parenthetical. */
function insideParens(text: string, index: number): boolean {
  const before = text.slice(0, index);
  return before.lastIndexOf("(") > before.lastIndexOf(")");
}

function factsForSegment(section: CriterionSection, text: string, groups: readonly CancerGroupId[] = []): Candidate[] {
  const out: Candidate[] = [];
  const incl = section === "inclusion";

  // Prior treatments. Exclusion: having had it rules you out; a washout window ("within 4 weeks") excludes only
  // inside the window, so it carries a scoped param (isScopedParam) and never acts as a blanket exclusion.
  const win = incl ? null : washoutParam(text);
  for (const [key, re] of Object.entries(THERAPY_PATTERNS) as [keyof typeof THERAPY_PATTERNS, RegExp][]) {
    const m = re.exec(text);
    if (!m || (!PRIOR_CONTEXT.test(text) && !win)) continue;
    const before = text.slice(Math.max(0, m.index - 60), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 30);
    // Tissue sources, planned procedures, organization names and reproductive status are not treatment history;
    // in inclusion text, a therapy offered as one option ("relapse after HSCT or CAR T") is not required.
    if (THERAPY_SPECIMEN_LEAD.test(before) || THERAPY_SPECIMEN_AFTER.test(after) || THERAPY_PLANNED_LEAD.test(before) || THERAPY_NOT_HISTORY.test(text) || (incl && OR_NEAR.test(text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)))) {
      out.push({ key, value: "mentioned" });
      continue;
    }
    // Negation only counts when it precedes the therapy word closely, inside the same clause
    // ("no prior chemotherapy"); the clause starts after the last comma/semicolon/colon.
    const lead = text.slice(Math.max(0, m.index - 60), m.index);
    const clause = lead.slice(Math.max(lead.lastIndexOf(","), lead.lastIndexOf(";"), lead.lastIndexOf(":")) + 1);
    const negated = NEGATION.test(clause) || /na[iï]ve/i.test(text.slice(m.index, m.index + m[0].length + 20));
    const context = EXAMPLE_CONTEXT.test(lead) || insideParens(text, m.index) || UNLESS.test(text);
    if (win && !negated && !context && !ALLOWED.test(text)) out.push({ key, value: "excluded", param: win });
    else if (WASHOUT.test(text) || ALLOWED.test(text) || context) out.push({ key, value: "mentioned" });
    else if (incl) out.push({ key, value: negated ? "excluded" : "required" });
    // Exclusion: "not (yet) treated with X" describes people lacking X, so having had X is not an exclusion.
    else out.push({ key, value: negated ? "mentioned" : "excluded" });
  }

  // Metastatic disease. Brain/bone-metastasis-only exclusions do not exclude metastatic disease in general.
  // Alternatives ("Stage III or IV", "advanced or metastatic", "primary or metastatic") never decide it.
  // "Prior systemic therapy for metastatic disease" (exclusion) rules out previously treated patients; the stage
  // words name the setting of that therapy, not a metastatic-disease exclusion.
  const priorForStage = !incl && PRIOR_SYSTEMIC_FOR_STAGE.test(text);
  if (priorForStage) out.push({ key: "previously_treated", value: "excluded" });
  // "Patients who have not received any prior therapy" (inclusion): previously treated patients are excluded.
  if (incl && NOT_RECEIVED_PRIOR.test(text) && !ALLOWED.test(text) && !UNLESS.test(text)) out.push({ key: "previously_treated", value: "excluded" });
  if (priorForStage) {
    /* the stage words describe the prior therapy's setting: no metastatic fact */
  } else if (NON_METASTATIC.test(text)) out.push({ key: "metastatic", value: incl ? "excluded" : "mentioned" });
  else {
    const mm = METASTATIC.exec(text);
    if (mm) {
      const near = text.slice(Math.max(0, mm.index - 45), mm.index + mm[0].length + 30);
      // Brain/CNS-only mentions and "may have / allowed" wording say who may join, not that metastatic disease is required.
      const alternative = ALTERNATIVE_NEAR.test(near) || OTHER_STAGES.test(text) || UNLESS.test(text) || (incl && (LOCAL_METASTASES_ONLY.test(text) || ALLOWED.test(text)));
      if (alternative) out.push({ key: "metastatic", value: "mentioned" });
      else if (incl) out.push({ key: "metastatic", value: "required" });
      else if (OTHER_MALIGNANCY.test(text)) out.push({ key: "metastatic", value: "mentioned" });
      else if (!LOCAL_METASTASES_ONLY.test(text)) out.push({ key: "metastatic", value: "excluded" });
    }
  }

  const untreatedWording = NEWLY_DIAGNOSED.test(text);
  if (incl && untreatedWording) out.push({ key: "newly_diagnosed", value: "required" });
  const pt = PREVIOUSLY_TREATED.exec(text);
  if (incl && pt) {
    // "No documented progression ...", "previously untreated ... or recurrent" do not mean "previously treated".
    const lead = text.slice(Math.max(0, pt.index - 40), pt.index);
    // An alternative after the match counts too ("relapsed or newly diagnosed"), but not another treated word
    // ("relapsed or refractory").
    if (untreatedWording || NEGATION.test(lead) || ALTERNATIVE_NEAR.test(text.slice(Math.max(0, pt.index - 25), pt.index)) || /^\s*(?:\w+\s+)?(?:or|and\/or)\s+(?!(?:relapsed|refractory|progressive|progressing|previously treated|resistant)\b)/i.test(text.slice(pt.index + pt[0].length, pt.index + pt[0].length + 25))) {
      out.push({ key: "previously_treated", value: "mentioned" });
    } else out.push({ key: "previously_treated", value: "required" });
  }

  // Pregnancy: exclusion criteria, or inclusion requiring a negative pregnancy test / not pregnant.
  if (PREGNANCY.test(text) && (!incl || /negative|not (be )?pregnant|non-?pregnant/i.test(text))) out.push({ key: "pregnancy", value: "excluded" });

  if (CONCURRENT_TRIAL.test(text)) {
    if (!incl || NEGATION.test(text)) out.push({ key: "concurrent_trial", value: "excluded" });
  }

  // Triple-negative breast cancer required => HER2-positive and HR-positive patients are excluded.
  // Only when TNBC is the criterion's subject, not one item in a list of tumor types or an "either ... or" option.
  const tn = TRIPLE_NEGATIVE.exec(text);
  const listy = LIST_CONTEXT.test(text);
  if (incl && tn) {
    const tnList = /[,;/]\s*$/.test(text.slice(Math.max(0, tn.index - 4), tn.index)) || /^\s*[,;/]/.test(text.slice(tn.index + tn[0].length, tn.index + tn[0].length + 3));
    const tnAlt = OR_NEAR.test(text.slice(Math.max(0, tn.index - 25), tn.index + tn[0].length + 40)) || /\beither\b/i.test(text);
    if (listy || tnList || tnAlt) out.push({ key: "biomarker:HER2", value: "mentioned" }, { key: "biomarker:HR", value: "mentioned" });
    else out.push({ key: "biomarker:HER2", value: "excluded" }, { key: "biomarker:HR", value: "excluded" });
  }

  // Biomarkers: direction from positive/negative wording near the marker.
  // An inclusion list of three or more markers ("driver mutation (EGFR, ALK, ROS1, RET)") offers options.
  const markerCount = BIOMARKERS.filter((b) => b.pattern.test(text)).length;
  const markerList = incl && markerCount >= 3 && (text.match(/,/g) ?? []).length >= 2;
  for (const b of BIOMARKERS) {
    const m = b.pattern.exec(text);
    if (!m) continue;
    // "anti-EGFR antibody" names a drug, not the patient's marker status.
    if (/\banti-?\s*$/i.test(text.slice(Math.max(0, m.index - 6), m.index))) {
      if (!out.some((o) => o.key === `biomarker:${b.id}`)) out.push({ key: `biomarker:${b.id}`, value: "mentioned" });
      continue;
    }
    // The marker's own suffix ("HER2-", "HER2+", "HER2-negative", "EGFR mutation") is decisive;
    // otherwise look at nearby words. This keeps "HR+/HER2-" from reading as HER2-positive.
    // "HR-positive" / "ER-negative": the pattern's own "[+-]" would eat the hyphen of a joined word and
    // read "HR-positive" as HR-negative. A sign followed by a letter is a hyphen; re-read the word.
    const joined = /[+-]$/.test(m[0]) && /^[a-z]/i.test(text.slice(m.index + m[0].length, m.index + m[0].length + 1));
    const token = joined ? m[0].slice(0, -1) : m[0];
    const suffix = text.slice(m.index + token.length, m.index + token.length + 16);
    let pos: boolean;
    let neg: boolean;
    if (token.endsWith("+")) {
      pos = true;
      neg = false;
    } else if (token.endsWith("-")) {
      pos = false;
      neg = true;
    } else if (/^\s*(\+|-?\s*positive|-?\s*pos\b|amplif|overexpress|mutat|mutant|fusion|rearrang|-?\s*high\b|(promoter |gene )?methylat|-(associated|related|driven|mediated)\b)/i.test(suffix)) {
      pos = true;
      neg = false;
    } else if (/^\s*([-−](?![a-z0-9])|-?\s*negative|-?\s*neg\b|wild|-?\s*low\b|0\b|(promoter |gene )?unmethylat)/i.test(suffix)) {
      pos = false;
      neg = true;
    } else {
      const window = text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30);
      pos = POSITIVE_WORDS.test(window);
      neg = NEGATIVE_WORDS.test(window);
    }
    let value: FactValue = "mentioned";
    // Catalog markers: test-status or permissive wording without a decisive suffix stays "mentioned".
    const decisive = token.endsWith("+") || token.endsWith("-") || /^\s*(\+|\(\+\)|-?\s*positive|-?\s*negative|amplif|mutat|fusion|rearrang|(promoter )?(un)?methylat|-?\s*high\b|-?\s*low\b)/i.test(suffix);
    // Catalog markers offered as one of several alternatives ("MET or RET", lists) are never required/excluded.
    if (V2_BIOMARKERS.has(b.id) && (OR_NEAR.test(text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)) || LIST_CONTEXT.test(text) || /,\s*$/.test(text.slice(Math.max(0, m.index - 3), m.index)) || /^\s*,/.test(text.slice(m.index + m[0].length, m.index + m[0].length + 3)))) pos = neg = false;
    // Catalog markers: permissive/procedural/conditional wording, specimen-testing text, sub-group clauses and bare list bullets never decide.
    const v2Weak = V2_BIOMARKERS.has(b.id) && (V2_MARKER_PERMISSIVE.test(text) || (V2_MARKER_TESTING.test(text) && !V2_MARKER_ASSERTED.test(text)) || /\bor\s*$/i.test(text.trim()) || diseasePopulationClause(text, { groups }) || /^\s*(?:participants|patients|subjects)\s+with\s+(?:\w+\s+){0,3}(?:cancers?|carcinomas?)\s+(?:will|must|should|are)\b/i.test(text) || (/^\s*[*\u2022]\s/.test(text) && text.trim().split(/\s+/).length <= 6) || (section === "exclusion" && V2_MARKER_SUBGROUP_AFTER.test(text.slice(m.index + m[0].length, m.index + m[0].length + 40))));
    if (v2Weak) pos = neg = false;
    if (V2_BIOMARKERS.has(b.id) && !decisive && (/\b(status|analys[ie]s|testing|tested|test results?|assay|performed|known|may have|regardless|independent of|either|unknown|pending|e\.g|such as|including)\b/i.test(text) || insideParens(text, m.index))) pos = neg = false;
    // In inclusion text a marker offered as one of several options ("A or B", "one of the following cancers") is not required.
    // "BRCA1 or BRCA2": alternatives naming the same marker are one requirement, not options.
    const orWindow = sameMarkerAlternatives(text.slice(Math.max(0, m.index - 20), m.index + m[0].length + 25), b.pattern);
    const optional = incl && (listy || markerList || OR_NEAR.test(orWindow));
    if (pos !== neg && !optional) {
      // inclusion+positive => required; inclusion+negative => positive patients excluded;
      // exclusion+positive => excluded; exclusion+negative => negative patients excluded (positive required).
      // Catalog markers read inclusion text phrased as an exclusion ("... will be excluded") as an exclusion.
      const inclusionLike = V2_BIOMARKERS.has(b.id) ? effectiveSection(section, text) === "inclusion" : incl;
      if (inclusionLike) value = pos ? "required" : "excluded";
      else value = pos ? "excluded" : "required";
    }
    if (out.some((o) => o.key === `biomarker:${b.id}`)) continue; // TNBC rule already set it
    out.push(V2_BIOMARKERS.has(b.id) ? { key: `biomarker:${b.id}`, value, quote: text } : { key: `biomarker:${b.id}`, value });
  }
  return out;
}

/**
 * Rule layer: one fact per key with a verbatim quote and criterion reference.
 * Keeps the first directional occurrence (inclusion before exclusion), else the first mention.
 */
export function extractRuleFacts(inclusion: Criterion[], exclusion: Criterion[], groups: readonly CancerGroupId[] = [], conditions: readonly string[] = []): Fact[] {
  const best = new Map<FactKey, Fact>();
  const scan = (section: CriterionSection, list: Criterion[]) => {
    for (const c of list) {
      for (const cand of factsForCriterion(section, c.text, { v2: true, groups, conditions })) {
        const prev = best.get(cand.key);
        if (prev && STRENGTH[prev.value] > STRENGTH[cand.value]) continue;
        if (prev && STRENGTH[prev.value] === STRENGTH[cand.value] && !moreLenient(cand.key, prev, cand)) continue;
        // Catalog facts quote the clause; it must be a verbatim substring of the criterion (else quote the criterion).
        const quote = cand.quote && c.text.includes(cand.quote) ? cand.quote : c.text;
        best.set(cand.key, { key: cand.key, value: cand.value, quote, ref: { section, n: c.n }, source: "rule", ...(cand.param !== undefined ? { param: cand.param } : {}) });
      }
    }
  };
  scan("inclusion", inclusion);
  scan("exclusion", exclusion);
  return [...best.values()];
}
