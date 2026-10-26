/** Treatment history (disease status, treatments, lines). Part of the criterion resolver (./index.ts). */
import type { SplitCriterion } from "@/lib/ingest/criteria-split";
import type { Range, ResolverProfile } from "./profile";
import type { Verdict, Checked } from "./facts";
import { mentionsDrug, UNTREATED_NON_CANCER, CARVE_OUT, SUBGROUP_RULE, PERMISSIVE_ITEM } from "./text";

/** "newly diagnosed", "previously untreated", "no prior systemic therapy": the item wants an untreated patient. */
export const UNTREATED_REQUIRED = /\b(?:newly diagnosed|previously untreated|treatment[- ]na[iï]ve|therapy[- ]na[iï]ve|untreated|no (?:prior|previous) (?:systemic |anti-?cancer )?(?:therapy|treatment)|not (?:have )?(?:previously )?(?:received|had|been treated with) (?:any )?(?:prior |previous )?(?:systemic |anti-?cancer )?(?:therapy|treatment))\b/i;
/** Wording that makes a treatment-history item about one class, drug, toxicity or count rather than "any treatment". */
export const TREATMENT_SPECIFIC = /\banti-?(?:[A-Z]|\w+-)|\b(?:chemotherap\w*|immunotherap\w*|targeted|endocrine|hormon\w*|radiat\w*|radiotherap\w*|ADCs?|antibod\w*|inhibit\w*|agents?|directed|specific|toxicit\w*|recover\w*|unresolved|adverse|investigational|vaccine|transplant\w*|CAR-?T|cell therap\w*|degrader|conjugate|platinum|taxane|anthracycline|maintenance|consolidation|intervening|study (?:drug|treatment)|\d+\s*(?:lines?|regimens?)|(?:one|two|three|four|five)\s*(?:lines?|regimens?)|lines? of|regimens?)\b/i;
/** Plain "any prior systemic therapy" exclusion wording. */
export const PRIOR_SYSTEMIC_EXCLUSION = /\b(?:any|prior|previous|received|receipt of)\s+(?:prior\s+|previous\s+)?(?:systemic|anti-?cancer|anti-?neoplastic)\s+(?:anti-?cancer\s+)?(?:therapy|therapies|treatments?)\b|\bprior (?:systemic )?(?:therapy|treatment) (?:for|in)\b/i;
/** "relapsed or refractory", "progressed on prior therapy", "after at least one prior line": the item wants a treated patient. */
export const TREATED_REQUIRED = /\b(?:relapsed|refractory|previously treated|pre-?treated|progress(?:ed|ion|ing) (?:on|after|following|during|despite)|failed|failure of|intolerant to|after (?:at least )?(?:one|1|two|2|three|3|\d+) (?:or more )?(?:prior |previous )?(?:lines?|regimens?|therap)|at least (?:one|1|two|2|three|3|\d+) (?:prior |previous )?(?:lines?|regimens?|systemic))\b/i;
/** The treatment history is counted in one setting ("for metastatic disease", "in the recurrent setting"). */
export const SETTING_QUALIFIED = /\b(?:for|in)\s+(?:the\s+|their\s+)?(?:\w+[- ]){0,3}?(?:metastatic|advanced|recurrent|unresectable|inoperable|locally advanced|relapsed)\b/i;

/** Lines of therapy received after progression, when the answers say so (newly diagnosed = 0). */
export function priorLines(p: ResolverProfile): Range | undefined {
  return p.lines;
}

/**
 * Treated-status verdict for one item, from the questionnaire's treated flag and line count. The rule families behind
 * these keys are below the precision gate on whole-trial facts, so only items whose own wording is unambiguous are
 * settled here: a plain "untreated required" or "treated required" statement (inclusion) or a plain "prior therapy"
 * exclusion, with no carve-out, no option wording and nothing addressed to a subgroup. A setting qualifier ("for
 * metastatic disease") is answered by the line count after progression, not by the treated flag.
 */
export function checkTreated(text: string, p: ResolverProfile, section: SplitCriterion["section"]): Checked | null {
  if (CARVE_OUT.test(text) || PERMISSIVE_ITEM.test(text) || UNTREATED_NON_CANCER.test(text) || SUBGROUP_RULE.test(text)) return null;
  const untreated = UNTREATED_REQUIRED.test(text);
  const treated = TREATED_REQUIRED.test(text);
  const lines = priorLines(p);
  const q = [...(p.sources.treated ?? []), ...(p.sources.lines ?? [])];
  const out = (verdict: Verdict): Checked => ({ key: "treated", verdict, questions: q });
  const specific = TREATMENT_SPECIFIC.test(text) || mentionsDrug(text);
  if (section === "inclusion") {
    if (untreated === treated) return null; // neither, or both ("relapsed or newly diagnosed")
    if (untreated) {
      // "No prior therapy with CDK4/6 inhibition" is about one class: not settled by the treated flag.
      if (specific && !/\b(?:newly diagnosed|previously untreated|treatment[- ]na[iï]ve)\b/i.test(text)) return null;
      if (SETTING_QUALIFIED.test(text)) return lines ? out(lines[0] >= 1 ? "fail" : "ok") : out("open");
      return p.treated === undefined ? out("open") : out(p.treated ? "fail" : "ok");
    }
    return p.treated === undefined ? out("open") : out(p.treated ? "ok" : "fail");
  }
  // Exclusion: plain "any prior systemic therapy (for metastatic disease)" excludes a treated patient; anything about
  // a class, a named drug, a count, toxicity or a washout window is not settled here.
  if (!PRIOR_SYSTEMIC_EXCLUSION.test(text) || specific || /\bwithin\b|\bwash-?out\b/i.test(text)) return null;
  if (SETTING_QUALIFIED.test(text)) return lines ? out(lines[0] >= 1 ? "fail" : "ok") : out("open");
  return p.treated === undefined ? out("open") : out(p.treated ? "fail" : "ok");
}
