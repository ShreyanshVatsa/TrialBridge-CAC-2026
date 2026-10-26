/**
 * Shared judging contract for the vignette benchmark: the label set and gains, the instructions every judge gets, the
 * per-vignette packet (patient + pooled trials), the judgment file schema and verbatim-quote verification.
 * Judgments are provisional (not clinician-reviewed) and are labelled as such everywhere they are reported.
 */
import { z } from "zod";
import type { TrialCard } from "../../../lib/types/trial";
import type { Vignette } from "./schema";

export const LABELS = ["eligible", "possibly", "excluded", "not_relevant"] as const;
export type Label = (typeof LABELS)[number];
/** Graded relevance gain per label (nDCG): a clear fit is worth most, a plausible fit still counts, the rest nothing. */
export const GAIN: Readonly<Record<Label, number>> = { eligible: 3, possibly: 2, excluded: 0, not_relevant: 0 };

export const EvidenceSchema = z.strictObject({
  section: z.enum(["inclusion", "exclusion"]),
  n: z.number().int().positive(),
  /** Verbatim span of that criterion. */
  quote: z.string().min(3),
  verdict: z.enum(["met", "not_met", "unknown"]),
});
export const JudgmentSchema = z.strictObject({
  nctId: z.string().regex(/^NCT\d{8}$/),
  label: z.enum(LABELS),
  evidence: z.array(EvidenceSchema).max(8),
  note: z.string().max(400).optional(),
});
export type Judgment = z.infer<typeof JudgmentSchema>;
export const JudgmentFileSchema = z.strictObject({
  judge: z.string(),
  model: z.string(),
  vignette: z.string(),
  judgedAt: z.string(),
  labels: z.array(JudgmentSchema),
});
export type JudgmentFile = z.infer<typeof JudgmentFileSchema>;

export const INSTRUCTIONS = `You are judging whether a clinical trial is a reasonable match for a (synthetic) cancer patient, the way a research
coordinator would at pre-screening. Read the patient, then each trial's title, conditions and numbered eligibility
criteria. For EACH trial output one label:
- "eligible": the trial studies this patient's disease and situation, and no criterion that the patient's description
  can be checked against rules them out.
- "possibly": the trial fits the patient's disease and situation, but something the description does not tell you
  (a lab value, an exact prior drug, test status, timing) decides it, or the fit is partial (e.g. the patient's
  subtype is one of several cohorts). A trial to discuss with the care team.
- "excluded": the trial is about this patient's disease, but a specific criterion clearly rules them out on facts the
  description DOES state (wrong subtype, stage, prior lines, a required biomarker the patient is negative for, an
  excluded prior drug, brain metastases, performance status, age, sex, etc.).
- "not_relevant": the trial is for a different disease or population (another cancer type, healthy volunteers,
  caregivers, children when the patient is an adult, prevention/screening of people without this cancer), or is not a
  treatment-relevant study for this patient.
Rules: judge only from the text given; never assume facts the description does not state; unknown facts make a trial
"possibly", never "excluded". Each label must cite 1-4 pieces of evidence, each a VERBATIM substring (copy exactly,
including capitalisation) of ONE numbered criterion, with its section ("inclusion" | "exclusion"), number n, and a
verdict: "met" (the patient satisfies it), "not_met" (the patient fails it) or "unknown". For "excluded" at least one
verdict must be "not_met". For "not_relevant" cite the criterion (or use the inclusion criterion that names the disease)
that shows the mismatch. Output ONLY JSON: {"labels":[{"nctId":"NCT...","label":"...","evidence":[{"section":"inclusion","n":2,"quote":"...","verdict":"met"}],"note":"<=200 chars optional"}]} with one entry per trial, in the order given.`;

export interface PacketTrial {
  id: string;
  title: string;
  conditions: string[];
  phases: string[];
  minAge: number | null;
  maxAge: number | null;
  sex: string;
  inclusion: { n: number; text: string }[];
  exclusion: { n: number; text: string }[];
}
export interface Packet {
  vignette: string;
  patient: string;
  trials: PacketTrial[];
}

const humanize = (s: string) => s.replace(/_/g, " ");

/** The patient as a judge sees them: the free text plus the structured answers spelled out. */
export function patientText(v: Vignette): string {
  const parts = [`Age ${v.age}, ${v.sex}. Cancer group: ${humanize(v.group)}.`];
  for (const [q, a] of Object.entries(v.answers)) {
    const val = typeof a === "string" ? humanize(a) : Array.isArray(a) ? a.map(humanize).join(", ") : Object.entries(a).map(([m, s]) => `${m} ${humanize(s)}`).join(", ");
    parts.push(`${humanize(q)}: ${val}.`);
  }
  return `${v.freeText}\n\nStructured answers (option ids; "unknown" means the patient does not know): ${parts.join(" ")}`;
}

export function packetTrial(card: TrialCard): PacketTrial {
  return { id: card.id, title: card.title, conditions: card.conditions, phases: card.phases, minAge: card.minAge, maxAge: card.maxAge, sex: card.sex, inclusion: card.inclusion, exclusion: card.exclusion };
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Problems with one judgment against the trial text: unknown trial, wrong criterion number, non-verbatim quote, label/verdict rule. */
export function verifyJudgment(j: Judgment, trial: PacketTrial | undefined): string[] {
  const problems: string[] = [];
  if (!trial) return [`${j.nctId}: not in the packet`];
  for (const e of j.evidence) {
    const c = (e.section === "inclusion" ? trial.inclusion : trial.exclusion).find((x) => x.n === e.n);
    if (!c) problems.push(`${j.nctId}: ${e.section} ${e.n} does not exist`);
    else if (!norm(c.text).includes(norm(e.quote))) problems.push(`${j.nctId}: quote not in ${e.section} ${e.n}`);
  }
  if (j.evidence.length === 0) problems.push(`${j.nctId}: no evidence`);
  if (j.label === "excluded" && !j.evidence.some((e) => e.verdict === "not_met")) problems.push(`${j.nctId}: excluded without a not_met verdict`);
  return problems;
}
