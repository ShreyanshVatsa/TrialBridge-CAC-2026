/**
 * Deterministic criterion splitter (no LLM): ClinicalTrials.gov eligibilityCriteria text ->
 * numbered, atomic-as-written items `{ id: "I1".."In" | "E1".."En", section, text, scope? }`.
 *
 * Two layers:
 *  - `splitSegments`: every visual unit of the text (bullet at any depth, paragraph, label line) with its depth.
 *    This is the granularity of TrialGPT's gold items, so the gold check (scripts/eval/trialgpt) runs on it.
 *  - `splitCriteria`: segments grouped into criteria. Nested sub-bullets and "...:" lines with their children stay
 *    with the parent, so "one of the following:" lists stay whole. Cohort/arm/part headers become `scope`.
 *    Never splits on "and"/"or"; a standalone "OR"/"AND" line joins its neighbours into one item.
 *
 * Text stays verbatim (markdown escapes removed, whitespace inside a line collapsed, lines of one item joined by "\n").
 * Text before any section header is inclusion.
 */
import { unescapeMarkdown } from "./parse";

export const CRITERIA_VERSION = 2;

export type SplitSection = "inclusion" | "exclusion";

export interface SplitCriterion {
  id: string;
  section: SplitSection;
  text: string;
  scope?: string;
}

interface Segment {
  section: SplitSection;
  /** 0 = top level. */
  depth: number;
  kind: "bullet" | "para" | "label" | "connector" | "cont" | "header";
  /** Header line that also carried a criterion after the colon (emitted as the next segment). */
  hasRest?: boolean;
  text: string;
  /** Scope in force for this segment (cohort/arm/part header above it). */
  scope?: string;
  /** For label/bullet segments that are themselves a scope header. */
  isScopeHeader?: boolean;
}

// Bullets: *, -, --, •, ·, o, ▪, numbers "1." "1)" "(1)", letters "a." "a)" "(a)", roman "i." "iv)".
const BULLET = /^(\s*)(?:(--?|[*•·▪◦●○■□➢►–—]|o(?=\s))|(\d{1,3})[.)](?!\d)|\((\d{1,3}|[a-z]|[ivx]{1,5})\)|([ivx]{1,5})[.)]|([a-z])[.)](?![a-z]))\s+/i;
const CONNECTOR = /^(?:and|or|and\/or|-or-|- or -|\(or\)|or:)$/i;
const SECTION_HEADER = /^(?:key|main|general|additional|other|specific|major|study|core|principal)?\s*(inclusion|exclusion|eligibility)(?:\s+(?:criteria|criterion|requirements?))?\b\s*(.*)$/i;
const NEUTRAL_HEADER = /^(?:eligibility\s+criteria|eligibility|criteria)\s*:?$/i;
const SCOPE_WORD = /\b(?:(?:cohorts?|arms?|parts?|phase|group|module|sub-?study|substudy|stage|step|segment|treatment\s+group)\s+(?:[A-Z]{1,2}\d{0,2}[a-z]?|\d{1,2}[a-z]?(?:\s*[a-z])?|[IVX]{1,4}[ab]?|one|two|three)\b|dose[- ]?(?:escalation|expansion|finding)|(?:expansion|escalation|run-?in|extension|randomi[sz]ed|non-?randomi[sz]ed|safety\s+lead-?in)\s+(?:phase|part|portion|cohorts?|stage)|(?:phase|part)\s+(?:1|2|3|i{1,3})[ab]?\b)/i;
const SCOPE_RESET = /^(?:for\s+)?(?:all|both)\s+(?:(?:cohorts?|arms?|parts?|patients|participants|subjects|groups?)\b)/i;
const ONE_OF = /\b(?:one|1|any|either|at least (?:one|1|two|2))\s+(?:\(\d\)\s+)?of\s+the\s+following\b/i;

function clean(line: string): string {
  return line.replace(/\*\*|__/g, "").replace(/[ \t ]+/g, " ").trim();
}

function markerOf(m: RegExpExecArray): "sym" | "num" | "alpha" | "roman" {
  if (m[2]) return "sym";
  if (m[3]) return "num";
  if (m[4]) return /^\d+$/.test(m[4]) ? "num" : /^[ivx]+$/i.test(m[4]) && m[4].length > 1 ? "roman" : "alpha";
  if (m[5]) return "roman";
  return "alpha";
}

interface HeaderHit {
  section: SplitSection | null;
  /** Scope named in the header ("Inclusion Criteria for Part B:" -> "Part B"). */
  scope?: string;
  /** Text after the header on the same line that is itself a criterion ("Inclusion criteria: age >= 18"). */
  rest?: string;
}

/** Section header detection on a bullet-stripped, bold-stripped line. */
export function sectionHeader(line: string): HeaderHit | null {
  const s = clean(line).replace(/^#+\s*/, "");
  if (!s || s.length > 140) return null;
  if (NEUTRAL_HEADER.test(s)) return { section: null };
  // "Cancer Survivor Inclusion Criteria:" / "Donor exclusion criteria" -> section + scope from the prefix.
  const pre = /^(.{2,50}?)\s+(inclusion|exclusion)\s+(?:criteria|criterion)\s*:?\s*$/i.exec(s);
  if (pre && !/^(?:key|main|general|additional|other|specific|major|study|core|principal)$/i.test((pre[1] ?? "").trim()) && !/\b(?:must|have|has|meet|meets|any|all|no|not|see|the following)\b/i.test(pre[1] ?? "")) {
    const label = (pre[1] ?? "").replace(/[-–:,]\s*$/, "").trim();
    return { section: (pre[2] ?? "").toLowerCase() === "exclusion" ? "exclusion" : "inclusion", ...(label ? { scope: label } : {}) };
  }
  if (/^non[- ]?inclusion\s+criteria\s*:?\s*$/i.test(s)) return { section: "exclusion" };
  const m = SECTION_HEADER.exec(s);
  if (!m) return null;
  const kind = (m[1] ?? "").toLowerCase();
  const hasCriteriaWord = /\b(criteria|criterion|requirements?)\b/i.test(s.slice(0, (m[1] ?? "").length + 30));
  let rest = (m[2] ?? "").trim();
  if (!hasCriteriaWord && !/^:/.test(rest) && rest !== "") return null; // "Exclusion of patients with ..." is a criterion
  if (kind === "eligibility" && !hasCriteriaWord) return null;
  // What follows the header words: a scope label ("for Part A", "(Cohort 2)", "- HL participant:"), a filler
  // ("include:", "are as follows:"), or an inline criterion ("Inclusion criteria: age >= 18").
  let scope: string | undefined;
  const lead = /^[-–:.]/.test(rest);
  const dashLead = /^[-–]/.test(rest);
  rest = rest.replace(/^[-–:.]\s*/, "");
  const FILLER = /^(?:include|includes|are|is|as follows|apply|applies|will be|must)\b[^.]{0,60}:?$/i;
  const CRITERION_WORDS = /\b(?:must|have|has|had|received|prior|age|years?|diagnos\w*|confirmed|history|patients? with|>|<|≥|≤)\b/i;
  let m2: RegExpExecArray | null;
  if ((m2 = /^\(([^)]{1,80})\)\s*:?\s*(.*)$/.exec(rest))) {
    scope = (m2[1] ?? "").trim();
    rest = (m2[2] ?? "").trim();
  } else if ((m2 = /^(?:for|in)\s+([^:]{1,80}?)\s*(?::\s*(.*))?$/i.exec(rest))) {
    scope = (m2[1] ?? "").trim();
    rest = (m2[2] ?? "").trim();
  } else if (FILLER.test(rest)) {
    rest = "";
  } else if ((m2 = /^([^:.;]{1,80}?)\s*:\s*(.*)$/.exec(rest)) && !CRITERION_WORDS.test(m2[1] ?? "")) {
    scope = (m2[1] ?? "").trim();
    rest = (m2[2] ?? "").trim();
  } else if (rest && !lead && hasCriteriaWord && rest.length <= 40 && !/[.;,]/.test(rest) && !CRITERION_WORDS.test(rest)) {
    scope = rest; // "Inclusion Criteria Patient"
    rest = "";
  } else if (rest && !lead) {
    return null; // "Inclusion criteria were met by ..." is prose, not a header
  } else if (rest && dashLead && rest.length <= 60 && !/[.;:]/.test(rest) && !CRITERION_WORDS.test(rest)) {
    scope = rest;
    rest = "";
  }
  if (FILLER.test(rest)) rest = "";
  if (scope && (/^(?:all|both)\b/i.test(scope) || FILLER.test(scope) || /^(?:the\s+)?(?:patients?|participants?|subjects?|(?:this\s+|the\s+)?study|enrollment|registration|randomi[sz]ation|eligibility)$/i.test(scope))) scope = undefined;
  const section: SplitSection | null = kind === "exclusion" ? "exclusion" : kind === "inclusion" ? "inclusion" : null;
  return { section, ...(scope ? { scope } : {}), ...(rest.length >= 3 ? { rest } : {}) };
}

/** Cohort/arm/part header ("Cohort A:", "Part 2 (dose expansion):", "For patients in Arm B:") -> its label. */
export function scopeHeader(text: string): string | null {
  const s = clean(text);
  const colon = s.endsWith(":");
  // Without a colon only a bare label counts ("Phase 1", "PART B", "STEP 1 REGISTRATION AND RANDOMIZATION").
  if (s.length > 120 || (!colon && (s.length > 45 || /[.;,]/.test(s)))) return null;
  const body = (colon ? s.slice(0, -1) : s).trim();
  if (SCOPE_RESET.test(body)) return "";
  const head = body.slice(0, 70);
  if (!SCOPE_WORD.test(head)) return null;
  // A criterion that merely mentions a phase/part ("Must have completed phase 2 therapy including:") is not a header.
  const residue = body
    .replace(/\([^)]*\)/g, " ")
    .replace(new RegExp(SCOPE_WORD.source, "gi"), " ")
    .replace(/\b(?:for|in|enrolled|enrolling|assigned|patients|participants|subjects|the|only|to|and|or|eligible|criteria|specific|additional|cohorts?|arms?|parts?|of|study|treatment|who|are|will|be|enrolling)\b/gi, " ");
  if (/\b(?:must|should|have|has|had|received|receive|prior|previous|defined|following|including|include|with|require[sd]?|meet|history|diagnosis)\b/i.test(residue)) return null;
  if (residue.replace(/[^a-z]/gi, "").length > (colon ? 40 : 30)) return null;
  return body.replace(/^(?:for\s+)?(?:patients|participants|subjects)\s+(?:in|enrolled\s+in|enrolling\s+(?:in|to)|assigned\s+to)\s+/i, "").replace(/^for\s+/i, "").trim();
}

/** Every visual unit of the criteria text, with section, depth and scope. */
export function splitSegments(raw: string): Segment[] {
  const text = unescapeMarkdown((raw ?? "").replace(/\r\n?/g, "\n")).replace(/<!--[\s\S]*?-->/g, "");
  const out: Segment[] = [];
  let section: SplitSection = "inclusion";
  let scope: string | undefined;
  /** Depth-0 bullet scope header with nested children: scope lasts until the next depth-0 unit. */
  let bulletScope = false;
  // Indentation stack of bullet levels within the current section.
  let indents: number[] = [];
  let topMarker: string | null = null;
  let cur: Segment | null = null;
  let blankBefore = true;
  let labelIndent = 0;

  const push = (seg: Segment) => {
    out.push(seg);
    cur = seg;
  };
  const resetLists = () => {
    indents = [];
    topMarker = null;
  };

  for (const rawLine of text.split("\n")) {
    if (!rawLine.trim()) {
      blankBefore = true;
      continue;
    }
    const m = BULLET.exec(rawLine);
    const indent = m ? (m[1] ?? "").replace(/\t/g, "    ").length : (/^\s*/.exec(rawLine)?.[0] ?? "").replace(/\t/g, "    ").length;
    const body = clean(m ? rawLine.slice(m[0].length) : rawLine);
    const wasBlank = blankBefore;
    blankBefore = false;
    if (!body) continue;

    // Section headers (bulleted or not).
    const hdr = sectionHeader(body);
    if (hdr && (!m || indent === 0 || hdr.section)) {
      if (hdr.section) section = hdr.section;
      scope = hdr.scope;
      bulletScope = false;
      resetLists();
      cur = null;
      out.push({ section, depth: 0, kind: "header", text: body, ...(scope ? { scope } : {}), ...(hdr.rest ? { hasRest: true } : {}) });
      if (hdr.rest) push({ section, depth: 0, kind: "para", text: hdr.rest, ...(scope ? { scope } : {}) });
      continue;
    }

    if (CONNECTOR.test(body)) {
      push({ section, depth: cur ? (cur as Segment).depth : 0, kind: "connector", text: body, ...(scope ? { scope } : {}) });
      continue;
    }

    if (m) {
      const mk = markerOf(m);
      let depth: number;
      const prevSeg = cur as Segment | null;
      if (indents.length === 0 && prevSeg && prevSeg.kind === "label" && !prevSeg.isScopeHeader && indent >= labelIndent + 2) {
        // "Adequate labs defined as:" followed by indented bullets: the bullets are the label's children.
        indents = [labelIndent, indent];
        topMarker = null;
        depth = 1;
      } else if (indents.length === 0) {
        indents = [indent];
        topMarker = mk;
        depth = 0;
      } else {
        while (indents.length > 1 && indent < (indents[indents.length - 1] as number)) indents.pop();
        const last = indents[indents.length - 1] as number;
        if (indent > last + 1) {
          indents.push(indent);
        } else if (indent < (indents[0] as number)) {
          indents = [indent];
        }
        depth = indents.length - 1;
        // Same indent but a subordinate marker type (letters/romans under numbers) = nested.
        if (depth === 0 && topMarker === "num" && (mk === "alpha" || mk === "roman") && cur) depth = 1;
        if (depth === 0 && topMarker && topMarker !== "num" && mk === "num" && cur && (cur as Segment).text.endsWith(":") && (cur as Segment).depth === 0) depth = 1;
        if (depth === 0 && topMarker && mk !== topMarker && (mk === "alpha" || mk === "roman") && cur && (cur as Segment).depth >= 0 && topMarker !== "alpha") depth = 1;
      }
      if (depth === 0 && bulletScope) {
        bulletScope = false;
        scope = undefined;
      }
      // Children of a bulleted scope header ("* Part 1:" + nested bullets) are top-level items within that scope.
      if (bulletScope && depth > 0) depth--;
      const sc = depth === 0 && body.endsWith(":") ? scopeHeader(body) : null;
      if (sc !== null) {
        scope = sc || undefined;
        bulletScope = true;
        push({ section, depth, kind: "bullet", text: body, isScopeHeader: true, ...(scope ? { scope } : {}) });
        continue;
      }
      push({ section, depth, kind: "bullet", text: body, ...(scope ? { scope } : {}) });
      continue;
    }

    // Non-bullet line.
    const prev = cur as Segment | null;
    // A line under a bullet (no blank line, or indented past the list) is a continuation: its own segment (the gold
    // granularity) that `splitCriteria` keeps with the bullet's item. Unindented lines elsewhere are new paragraphs.
    const scNb = indent === 0 ? scopeHeader(body) : null;
    const continuation = scNb === null && prev && prev.kind === "bullet" && !wasBlank;
    const indentedCont = scNb === null && prev && wasBlank && (prev.kind === "bullet" || prev.kind === "cont") && indents.length > 0 && indent > (indents[0] as number);
    const contAfterCont = scNb === null && prev && prev.kind === "cont" && !wasBlank;
    if (prev && (continuation || indentedCont || contAfterCont)) {
      push({ section, depth: prev.depth, kind: "cont", text: body, ...(prev.scope ? { scope: prev.scope } : {}) });
      continue;
    }
    // New paragraph or label line: lists restart beneath it.
    resetLists();
    if (bulletScope) {
      bulletScope = false;
      scope = undefined;
    }
    const sc = scopeHeader(body);
    if (sc !== null) {
      scope = sc || undefined;
      push({ section, depth: 0, kind: "label", text: body, isScopeHeader: true, ...(scope ? { scope } : {}) });
      continue;
    }
    labelIndent = indent;
    push({ section, depth: 0, kind: body.endsWith(":") ? "label" : "para", text: body, ...(scope ? { scope } : {}) });
  }
  return out;
}

/** Group segments into criteria and number them per section. */
/**
 * A bare heading with no criterion in it ("Criteria:", "Patient Eligibility Criteria:", "Treatment eligibility"):
 * up to three label words, then one heading word. Real criteria with more words ("No exclusion criteria",
 * "Does not meet inclusion criteria") do not match.
 */
const HEADING_ONLY = /^(?!(?:no|not|none|without|do|does)\b)(?:[A-Za-z-]+\s+){0,3}?(?:criteria|criterion|eligibility|inclusion|exclusion)\s*:?$/i;

export function splitCriteria(raw: string): SplitCriterion[] {
  const segs = splitSegments(raw);
  type Item = { section: SplitSection; lines: string[]; scope?: string };
  const items: Item[] = [];
  let open: Item | null = null;
  /** A depth-0 label (non-bullet "...:" line) waiting to see whether children follow. */
  let label: { seg: Segment; oneOf: boolean } | null = null;
  /** Children of a "one of the following:" label are collected into the label's item until the next paragraph. */
  let oneOfItem: Item | null = null;
  let joinNext = false;

  const start = (seg: Segment, text: string): Item => {
    const it: Item = { section: seg.section, lines: [text], ...(seg.scope ? { scope: seg.scope } : {}) };
    items.push(it);
    return it;
  };

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i] as Segment;
    if (seg.kind === "header") {
      open = null;
      label = null;
      oneOfItem = null;
      joinNext = false;
      continue;
    }
    if (seg.kind === "cont") {
      if (open && open.section === seg.section) open.lines.push(seg.depth > 0 ? `${"  ".repeat(seg.depth)}${seg.text}` : seg.text);
      else open = start(seg, seg.text);
      continue;
    }
    if (seg.kind === "connector") {
      if (open && open.section === seg.section) {
        open.lines.push(seg.text);
        joinNext = true;
      }
      continue;
    }
    if (seg.isScopeHeader) {
      open = null;
      label = null;
      oneOfItem = null;
      joinNext = false;
      continue;
    }
    if (joinNext && open && open.section === seg.section) {
      open.lines.push(seg.depth > 0 ? `- ${seg.text}` : seg.text);
      joinNext = false;
      continue;
    }
    joinNext = false;
    if (seg.kind === "label") {
      const next = segs[i + 1];
      const oneOf = ONE_OF.test(seg.text);
      label = { seg, oneOf };
      oneOfItem = null;
      open = null;
      // Label with nested (depth>0) children, or a "one of the following" label: becomes the parent item.
      if (next && next.section === seg.section && next.kind === "bullet" && !next.isScopeHeader && (next.depth > 0 || oneOf)) {
        open = start(seg, seg.text);
        if (oneOf) oneOfItem = open;
        label = null;
      } else if (!next || next.kind !== "bullet" || next.section !== seg.section) {
        // A "...:" line followed by a paragraph or nothing is a criterion of its own (verbatim).
        open = start(seg, seg.text);
        label = null;
      }
      continue;
    }
    if (seg.kind === "para") {
      label = null;
      oneOfItem = null;
      open = start(seg, seg.text);
      continue;
    }
    // bullet
    if (oneOfItem && oneOfItem.section === seg.section) {
      oneOfItem.lines.push(`${"  ".repeat(seg.depth)}- ${seg.text}`);
      continue;
    }
    if (seg.depth > 0 && open && open.section === seg.section) {
      open.lines.push(`${"  ".repeat(seg.depth - 1)}- ${seg.text}`);
      continue;
    }
    void label;
    open = start(seg, seg.text);
  }

  const out: SplitCriterion[] = [];
  const n = { inclusion: 0, exclusion: 0 };
  for (const it of items) {
    const text = it.lines.join("\n").trim();
    if (text.length < 2 || HEADING_ONLY.test(text)) continue;
    n[it.section]++;
    // Inline cohort prefix ("Cohort A: must have ...") sets scope when no header did.
    let scope = it.scope;
    if (!scope) {
      const inl = /^((?:for\s+)?(?:patients\s+in\s+)?[^:]{1,40}?):\s+\S/.exec(text);
      if (inl && SCOPE_WORD.test(inl[1] ?? "") && !/\b(?:must|have|has|prior|received)\b/i.test(inl[1] ?? "")) scope = (inl[1] ?? "").trim();
    }
    out.push({ id: `${it.section === "inclusion" ? "I" : "E"}${n[it.section]}`, section: it.section, text, ...(scope ? { scope } : {}) });
  }
  return out;
}
