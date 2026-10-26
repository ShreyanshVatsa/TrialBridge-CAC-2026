/** Patient profile: definite answers only, each with the question it came from. Part of the criterion resolver (./index.ts). */
import type { BiomarkerId } from "@/config/biomarkers";
import { CANCER_GROUPS, type CancerGroupId } from "@/config/cancer-groups";
import type { QuestionDef, QuestionnaireState } from "@/lib/types/questionnaire";
import { activeQuestions, isNonResponse, isNonResponseId } from "@/lib/questionnaire/rules";

/** An inclusive numeric range; hi may be Infinity ("3 or more"). */
export type Range = readonly [lo: number, hi: number];

/** What the resolver knows about the patient. A field is absent when the answer is a non-response or not asked. */
export interface ResolverProfile {
  age?: number;
  sex?: "female" | "male";
  group?: CancerGroupId;
  /** Histology ids the patient's cancer is / is not (from the subtype option's catalog effects). */
  histologyIs?: ReadonlySet<string>;
  histologyIsNot?: ReadonlySet<string>;
  /** Extent of disease (solid tumors): the `spread` answer. */
  spread?: "not_spread" | "nearby" | "distant" | "removed";
  /** ECOG band, e.g. "0-1" -> [0, 1]. */
  ecog?: Range;
  /** Prior lines of therapy for this cancer; newly diagnosed / no treatment -> [0, 0]. */
  lines?: Range;
  /** Previously treated with systemic therapy for this cancer. */
  treated?: boolean;
  brainMets?: "none" | "treated_stable" | "active";
  measurable?: boolean;
  otherCancer?: "no" | "over_2y" | "recent";
  // Health history (definite answers only).
  hiv?: "no" | "controlled" | "other";
  hepatitis?: "no" | "hep_b" | "hep_c";
  transplant?: "none" | "organ" | "allo" | "auto";
  autoimmune?: "no" | "yes_inactive" | "yes_active";
  /** Serious organ problems named by a doctor; empty = "none of these". */
  organs?: ReadonlySet<"kidney" | "liver" | "heart">;
  pregnant?: boolean;
  inOtherTrial?: boolean;
  biomarkers?: Readonly<Partial<Record<BiomarkerId, "positive" | "negative">>>;
  /** Profile field -> question ids its value rests on. */
  sources: Readonly<Record<string, readonly string[]>>;
}

export const ECOG_BANDS: Record<string, Range> = { "0-1": [0, 1], "2": [2, 2], "3-4": [3, 4] };
export const LINE_BANDS: Record<string, Range> = { "1": [1, 1], "2": [2, 2], "3plus": [3, Infinity] };
export const SYSTEMIC = new Set(["chemotherapy", "immunotherapy", "targeted_therapy", "hormone_therapy", "stem_cell_transplant"]);

/**
 * Definite answers of the counted questions (applicable and prerequisites holding, as the matcher uses them).
 * Non-responses ("unknown", skip, prefer not, deferred, not tested) leave the field absent.
 */
export function profileFromState(state: QuestionnaireState, catalog: readonly QuestionDef[]): ResolverProfile {
  const sources: Record<string, string[]> = {};
  const note = (field: string, q: string) => {
    const list = (sources[field] ??= []);
    if (!list.includes(q)) list.push(q);
  };
  const p: Mutable<ResolverProfile> = { sources };
  const counted = new Map<string, QuestionDef>(activeQuestions(state, catalog).map((q) => [q.id, q]));
  const a = (id: string) => (counted.has(id) && !isNonResponse(state.answers[id]) ? state.answers[id] : undefined);

  const age = state.answers.age;
  if (typeof age === "number" && Number.isFinite(age)) {
    p.age = age;
    note("age", "age");
  }
  const group = state.answers.cancer_type;
  if (typeof group === "string" && CANCER_GROUPS.some((g) => g.id === group)) {
    p.group = group as CancerGroupId;
    note("group", "cancer_type");
  }
  const sex = a("sex");
  if (sex === "female" || sex === "male") {
    p.sex = sex;
    note("sex", "sex");
  }

  const subtype = a("subtype");
  const eff = typeof subtype === "string" ? counted.get("subtype")?.effects.find((e) => e.option === subtype) : undefined;
  if (eff) {
    const is = new Set<string>();
    const isNot = new Set<string>();
    for (const r of eff.facts) {
      if (!r.fact.startsWith("histology:")) continue;
      const h = r.fact.slice("histology:".length);
      if (r.whenRequired === "support") is.add(h);
      else if (r.whenRequired === "conflict") isNot.add(h);
    }
    if (is.size || isNot.size) {
      p.histologyIs = is;
      p.histologyIsNot = isNot;
      note("histology", "subtype");
    }
  }

  const spread = a("spread");
  if (spread === "not_spread" || spread === "nearby" || spread === "distant" || spread === "removed") {
    p.spread = spread;
    note("spread", "spread");
  }
  const ecog = a("daily_activity");
  if (typeof ecog === "string" && ECOG_BANDS[ecog]) {
    p.ecog = ECOG_BANDS[ecog];
    note("ecog", "daily_activity");
  }

  // Treated status and line count: disease status, treatments and lines must not contradict each other.
  const status = a("disease_status");
  const treatments = a("treatments");
  const lines = a("lines");
  const lineBand = typeof lines === "string" ? LINE_BANDS[lines] : undefined;
  const votes: { treated: boolean; q: string }[] = [];
  if (status === "new") votes.push({ treated: false, q: "disease_status" });
  else if (status === "recurrent" || status === "on_treatment") votes.push({ treated: true, q: "disease_status" });
  if (Array.isArray(treatments) && !treatments.some(isNonResponseId)) {
    if (treatments.length === 1 && treatments[0] === "none") votes.push({ treated: false, q: "treatments" });
    else if (treatments.some((t) => SYSTEMIC.has(t))) votes.push({ treated: true, q: "treatments" });
  }
  if (lineBand) votes.push({ treated: true, q: "lines" });
  const first = votes[0];
  if (first && votes.every((v) => v.treated === first.treated)) {
    p.treated = first.treated;
    for (const v of votes) note("treated", v.q);
    if (!first.treated) {
      p.lines = [0, 0];
      for (const v of votes) note("lines", v.q);
    } else if (lineBand) {
      p.lines = lineBand;
      note("lines", "lines");
    }
  }

  const brain = a("brain_mets");
  if (brain === "none" || brain === "treated_stable" || brain === "active") {
    p.brainMets = brain;
    note("brainMets", "brain_mets");
  }
  const meas = a("measurable");
  if (meas === "yes" || meas === "no") {
    p.measurable = meas === "yes";
    note("measurable", "measurable");
  }
  const other = a("other_cancer");
  if (other === "no" || other === "over_2y" || other === "recent") {
    p.otherCancer = other;
    note("otherCancer", "other_cancer");
  }

  const hiv = a("hiv");
  if (hiv === "no" || hiv === "controlled" || hiv === "other") {
    p.hiv = hiv;
    note("hiv", "hiv");
  }
  const hep = a("hepatitis");
  if (hep === "no" || hep === "hep_b" || hep === "hep_c") {
    p.hepatitis = hep;
    note("hepatitis", "hepatitis");
  }
  const tx = a("transplant");
  if (tx === "none" || tx === "organ" || tx === "allo" || tx === "auto") {
    p.transplant = tx;
    note("transplant", "transplant");
  }
  const auto = a("autoimmune");
  if (auto === "no" || auto === "yes_inactive" || auto === "yes_active") {
    p.autoimmune = auto;
    note("autoimmune", "autoimmune");
  }
  const organs = a("organ_problems");
  if (Array.isArray(organs) && organs.length > 0 && !organs.some(isNonResponseId)) {
    // A multi-select answer: an organ not picked is one the patient does not report.
    p.organs = new Set(organs.filter((o): o is "kidney" | "liver" | "heart" => o === "kidney" || o === "liver" || o === "heart"));
    note("organs", "organ_problems");
  }
  const preg = a("pregnancy");
  if (preg === "yes" || preg === "no") {
    p.pregnant = preg === "yes";
    note("pregnant", "pregnancy");
  } else if (p.sex === "male") {
    p.pregnant = false;
    note("pregnant", "sex");
  }
  const trial = a("in_other_trial");
  if (trial === "yes" || trial === "no") {
    p.inOtherTrial = trial === "yes";
    note("inOtherTrial", "in_other_trial");
  }

  const markers: Partial<Record<BiomarkerId, "positive" | "negative">> = {};
  for (const qid of ["biomarkers", "deep_biomarkers"]) {
    const grid = a(qid);
    if (!grid || typeof grid !== "object" || Array.isArray(grid)) continue;
    for (const [m, v] of Object.entries(grid)) {
      if (v !== "positive" && v !== "negative") continue;
      markers[m as BiomarkerId] = v;
      note(`biomarker:${m}`, qid);
    }
  }
  if (Object.keys(markers).length) p.biomarkers = markers;
  return p;
}

export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** What a criterion is resolved against: the trial's cancer groups and conditions, and optional answer numbering. */
export interface ResolveContext {
  groups: readonly CancerGroupId[];
  conditions?: readonly string[];
  /** Question id -> numbered answer id ("A3"), when the caller numbers answers; fills `answerIds`. */
  answerIds?: Readonly<Record<string, string>>;
}
