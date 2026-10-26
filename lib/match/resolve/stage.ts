/** Extent of disease (the `spread` answer). Part of the criterion resolver (./index.ts). */
import type { SplitCriterion } from "@/lib/ingest/criteria-split";
import type { ResolverProfile } from "./profile";
import type { Verdict, Checked } from "./facts";
import { SUBGROUP_RULE } from "./text";

/** Metastases named by site are a finding, not the extent of disease; a treatment's setting is not the patient's stage. */
export const STAGE_NOISE = [
  /\b(?:brain|cns|central nervous system|leptomeningeal|spinal|spinal cord|bone|liver|lung|hepatic|pulmonary|nodal|lymph node|peritoneal|skin|cutaneous|osseous|visceral|extracranial|intracranial)(?:[- ]only)?[- ](?:only\s+)?metasta\w*/gi,
  /\bmetasta\w*\s+(?:to|in|of|involving)\s+(?:the\s+)?(?:brain|cns|central nervous system|bones?|spine|spinal cord|liver|lungs?|leptomeninges|lymph nodes?|skin)\b/gi,
  /\b(?:in|for)\s+(?:the\s+|their\s+)?(?:\w+[- ])?(?:metastatic|advanced|recurrent|adjuvant|neo-?adjuvant|locally advanced|unresectable|curative|palliative|first[- ]line|1L|2L)\s+(?:disease\s+)?setting\b/gi,
  /\b(?:therap\w*|treatments?|treated|chemotherapy|immunotherapy|endocrine|hormonal|regimens?|lines?|cycles?|doses?|courses?|agents?|drugs?|surgery|radiation|radiotherapy|SoC|standard of care|received|receipt of|given|administered)\s+(?:for|in|of|as)\s+(?:the\s+|their\s+)?(?:\w+\s+){0,3}?(?:metastatic|advanced|recurrent|unresectable|locally advanced|early[- ]stage|localized)\b(?:\s+(?:disease|cancer|tumou?rs?|setting|\w+))?/gi,
  /\bhistory of\s+(?:\w+\s+){0,2}(?:metasta\w*)/gi,
];
export const STAGE_MET = /\bmetastatic\b|\bstage\s*(?:iv|4)[a-c]?\b|\bdistant\s+(?:metasta\w*|disease|spread)|\bM1[a-c]?\b/i;
export const STAGE_NON_MET = /\bnon-?metastatic\b|\bno (?:evidence of |known |clinical or radiographic evidence of )?(?:distant )?metasta\w*|\bwithout (?:distant )?metasta\w*|\bM0\b|\bnegative for (?:any )?(?:distant )?metasta\w*|\babsence of (?:distant )?metasta\w*|\b(?:must not|cannot|may not|should not|do not|does not|not)\s+(?:have|had|be|present with)\s+(?:\w+\s+){0,4}?(?:metastatic|stage\s*(?:iv|4)\b|distant)/i;
/** The stage word describes something else: pain from metastases, a subgroup's own rule, a lesion site. */
export const STAGE_OTHER_ROLE = /\b(?:due to|secondary to|from|related to|caused by|pain|symptoms?|complications?|lesions? (?:of|in)|biopsy of|sites? of)\s+(?:\w+\s+){0,2}?(?:metastatic|metasta\w*|stage\s*(?:iv|4))\b/i;
/** An exclusion item that is about the extent of disease itself, not a long rule that mentions it. */
export const STAGE_EXCLUSION_HEAD = /^\W*(?:[A-Za-z0-9 /-]{2,40}:\s*)?(?:(?:known|documented|definitive|clinical or radiologic(?:al)? evidence of|evidence of|presence of|history of|current|patients? with|participants? with|subjects? with|has|have|having|diagnosis of|confirmed)\s+)*(?:(?:\w+[- ]){0,3}?)(?:metastatic|stage\s*(?:iv|4)[a-c]?|distant metasta\w*|M1[a-c]?)\b[^.;:]{0,60}[.;]?\s*$/i;
export const STAGE_ADVANCED = /\blocally advanced\b|\badvanced\b|\bunresectable\b|\binoperable\b|\bnot amenable to (?:curative |surgical )?(?:resection|surgery|local therapy)/i;
export const STAGE_EARLY = /\bearly[- ]stage\b|\blocali[sz]ed\b|\bstage\s*(?:0|i{1,3}|[1-3])[a-c]?\b/i;
/** The stage words belong to a resection or adjuvant context ("completely resected stage II"), where `removed` patients fit. */
export const STAGE_RESECTED = /\bresect|\badjuvant\b|\bafter (?:definitive )?surgery\b|\bpost-?operative\b|\bno evidence of (?:residual )?disease\b|\bNED\b/i;

/**
 * Extent of disease stated by the item against the `spread` answer. Only the plain cases are settled: metastatic /
 * stage IV / distant disease, non-metastatic, advanced or unresectable, and early-stage / stage I-III wording that does
 * not also offer stage IV. Site-specific metastases and treatment settings are ignored (STAGE_NOISE).
 */
export function checkStage(text: string, p: ResolverProfile, section: SplitCriterion["section"]): Checked | null {
  if (SUBGROUP_RULE.test(text) || STAGE_OTHER_ROLE.test(text)) return null;
  let t = text;
  for (const re of STAGE_NOISE) t = t.replace(re, " ");
  if (section === "exclusion" && !STAGE_EXCLUSION_HEAD.test(t)) return null;
  const nonMet = STAGE_NON_MET.test(t);
  // "No metastatic disease" is a non-metastatic statement, not a metastatic one.
  const met = STAGE_MET.test(t.replace(new RegExp(`${STAGE_NON_MET.source}(?:\\s*\\([^)]*\\))?`, "gi"), " "));
  const advanced = STAGE_ADVANCED.test(t);
  const early = STAGE_EARLY.test(t);
  if (!met && !nonMet && !advanced && !early) return null;
  const open = (): Checked => ({ key: "stage", verdict: "open", questions: [] });
  const sp = p.spread;
  if (!sp) return open();
  const q = p.sources.spread ?? [];
  const out = (verdict: Verdict): Checked => ({ key: "stage", verdict, questions: q });
  if (section === "exclusion") {
    // "Metastatic disease", "stage IV": excluded for distant spread; anything else stays open.
    if (met && !nonMet && !early) return out(sp === "distant" ? "fail" : "ok");
    return open();
  }
  if (met && nonMet) return open(); // "metastatic or non-metastatic"
  if (nonMet) return out(sp === "distant" ? "fail" : "ok");
  if (met) {
    if (early && !advanced) return open(); // "stage I-IV", "any stage"
    if (sp === "distant") return out("ok");
    if (sp === "nearby") return out(advanced || /\bstage\s*(?:iii|3)\b/i.test(t) ? "ok" : "fail");
    if (sp === "removed") return STAGE_RESECTED.test(t) ? open() : out("fail");
    return out("fail");
  }
  if (advanced) {
    if (sp === "distant" || sp === "nearby") return out("ok");
    if (sp === "not_spread") return out("fail");
    return open();
  }
  // Early-stage wording only.
  if (sp === "distant") return out("fail");
  if (sp === "not_spread") return out("ok");
  return open();
}
