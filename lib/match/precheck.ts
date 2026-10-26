import type { BiomarkerId } from "@/config/biomarkers";
import type { IntakeAnswers, Treatment } from "@/lib/types/intake";
import { isScopedParam, type Fact } from "@/lib/types/trial";
import type { PrecheckNote } from "@/lib/types/match";
import type { FactPolicyMap, QuestionDef, QuestionnaireState } from "@/lib/types/questionnaire";
import { applyPolicy, compileState, factRelation, type CompiledAnswer } from "@/lib/questionnaire/rules";
import { qualifiedMarkerFact } from "./marker-qualifier";

/** A pre-check note for one trial fact (carries direction and source for FACT_WEIGHT / RELIABILITY). */
function toNote(f: Fact, kind: PrecheckNote["kind"]): PrecheckNote {
  const note: PrecheckNote = { key: f.key, kind, quote: f.quote, ref: f.ref, value: f.value, source: f.source };
  if (f.confidence !== undefined) note.confidence = f.confidence;
  return note;
}

/** Which intake treatment answers correspond to which prior-treatment fact. */
const TREATMENT_FACTS: Record<string, Exclude<Treatment, "none" | "not_sure">> = {
  prior_chemotherapy: "chemotherapy",
  prior_radiation: "radiation",
  prior_surgery: "surgery",
  prior_immunotherapy: "immunotherapy",
  prior_targeted_therapy: "targeted_therapy",
};

/**
 * Rule-based eligibility pre-check: compare intake answers with a trial's stored facts.
 * Only definite answers can create conflicts or support; "not sure", "don't know", and
 * "prefer not to say" never penalize. "mentioned" facts (direction unknown) and facts where the
 * rule and LLM layers disagree (needsReview) are ignored.
 */
interface PrecheckAnswers {
  spread: IntakeAnswers["spread"];
  /** Legacy treatment list; the AI-side profile may also list hormone_therapy / stem_cell_transplant (no rule facts for those). */
  treatments: readonly string[];
  biomarkers: IntakeAnswers["biomarkers"];
  pregnant: IntakeAnswers["pregnant"];
  inAnotherTrial: "yes" | "no" | "not_sure";
}

export function precheck(answers: PrecheckAnswers, facts: readonly Fact[]): PrecheckNote[] {
  const notes: PrecheckNote[] = [];
  const t = new Set<string>(answers.treatments);
  const treatmentsKnown = !t.has("not_sure");
  const hadNone = t.has("none") && t.size === 1;
  const hadAny = treatmentsKnown && !hadNone;
  const add = (f: Fact, kind: PrecheckNote["kind"]) => notes.push(toNote(f, kind));

  for (const f of facts) {
    if (f.value === "mentioned" || f.needsReview || isScopedParam(f.param) || qualifiedMarkerFact(f)) continue; // uncertain facts, time windows and qualified marker wording never penalize
    const treatment = TREATMENT_FACTS[f.key];
    if (treatment) {
      if (!treatmentsKnown) continue;
      const had = t.has(treatment);
      if (f.value === "excluded" && had) add(f, "conflict");
      else if (f.value === "required" && !had) add(f, "conflict");
      else if (f.value === "required" && had) add(f, "support");
      continue;
    }
    switch (f.key) {
      case "metastatic":
        if (answers.spread === "yes") add(f, f.value === "excluded" ? "conflict" : "support");
        else if (answers.spread === "no" && f.value === "required") add(f, "conflict");
        break;
      case "newly_diagnosed":
      case "previously_treated": {
        // required previously_treated / excluded newly_diagnosed want a treated patient; the other two an untreated one.
        const wantsTreated = (f.key === "previously_treated") === (f.value === "required");
        if (wantsTreated ? hadNone : hadAny) add(f, "conflict");
        else if (wantsTreated ? hadAny : hadNone) add(f, "support");
        break;
      }
      case "pregnancy":
        if (answers.pregnant === "yes") add(f, "conflict");
        break;
      case "concurrent_trial":
        if (answers.inAnotherTrial === "yes") add(f, "conflict");
        break;
      default:
        if (f.key.startsWith("biomarker:")) {
          const status = answers.biomarkers[f.key.slice("biomarker:".length) as BiomarkerId];
          if (status === "positive") add(f, f.value === "excluded" ? "conflict" : "support");
          else if (status === "negative" && f.value === "required") add(f, "conflict");
        }
    }
  }
  return notes;
}

/**
 * Catalog-driven pre-check (QUESTIONNAIRE_SPEC §3.1). Each answered question's chosen
 * option(s) carry FactRules; a trial fact becomes a conflict if any answer conflicts with it, else a support
 * if any answer supports it. Non-responses (unknown, skip, prefer not, deferred, not tested) compile to no
 * rules, so they never create notes. "mentioned" and needsReview facts are ignored, and the fact policy
 * (penalize=false) switches off key families that are below the precision gate.
 */
export function evaluateAnswers(state: QuestionnaireState, catalog: readonly QuestionDef[], facts: readonly Fact[], policy?: FactPolicyMap): PrecheckNote[] {
  return answerEvaluator(compileState(state, catalog), policy)(facts);
}

/**
 * How many of a trial's directional criteria (required/excluded facts) the patient's answers say nothing about:
 * no answered question carries a rule for that fact key. Non-responses compile to no rules, so every "don't know"
 * adds to this count and to nothing else. Shown as "N criteria we could not check", never used to rank.
 */
export function unknownCounter(compiled: readonly CompiledAnswer[]): (facts: readonly Fact[]) => number {
  const covered = new Set<string>();
  for (const c of compiled) for (const k of c.rules.keys()) covered.add(k);
  return (facts) => {
    const seen = new Set<string>();
    for (const f of facts) if (f.value !== "mentioned" && !f.needsReview && !isScopedParam(f.param) && !covered.has(f.key)) seen.add(f.key);
    return seen.size;
  };
}

/**
 * Same as `evaluateAnswers`, but the answers are compiled once and reused for many trials. Ranking checks hundreds
 * of trials against the SAME answers, and compiling them per trial (walking the catalog, prerequisites and
 * option effects each time) was most of the pre-check's cost.
 */
export function answerEvaluator(compiled: readonly CompiledAnswer[], policy?: FactPolicyMap): (facts: readonly Fact[]) => PrecheckNote[] {
  const empty = compiled.every((c) => c.rules.size === 0);
  return (facts) => {
    const notes: PrecheckNote[] = [];
    if (empty) return notes;
    for (const f of facts) {
      if (qualifiedMarkerFact(f)) continue; // "other than EGFR", "T790M": a plain test result does not settle these
      const rel = applyPolicy(factRelation(compiled, f), f.key, policy);
      if (rel !== "neutral") notes.push(toNote(f, rel));
    }
    return notes;
  };
}
