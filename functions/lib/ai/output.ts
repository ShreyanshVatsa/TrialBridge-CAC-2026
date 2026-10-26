import { z } from "zod";
import { AssessmentSchema, FitLevelSchema, NctIdSchema, TrialAnalysisSchema, type TrialAnalysis } from "@/lib/types/analysis";
import { CriterionSectionSchema } from "@/lib/types/trial";
import { ProviderError } from "./types";

/** Lenient shape for raw model output: extra keys are stripped, arrays are clamped before strict validation. */
const LooseOutput = z.object({
  trials: z.array(
    z.object({
      nctId: NctIdSchema,
      fitLevel: FitLevelSchema,
      criteria: z
        .array(
          z.object({
            section: CriterionSectionSchema,
            number: z.coerce.number().int().positive(),
            quote: z.string(),
            assessment: AssessmentSchema,
            explanation: z.string(),
          }),
        )
        .default([]),
      doctorQuestions: z.array(z.string()).default([]),
      summary: z.string(),
    }),
  ),
});

/** Extract the JSON object from model text (tolerates code fences / leading prose). */
function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ProviderError("invalid_output", "no JSON object in output");
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new ProviderError("invalid_output", "malformed JSON");
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Parse and validate model output into strict TrialAnalysis objects. Throws ProviderError("invalid_output"). */
export function parseModelOutput(raw: string): TrialAnalysis[] {
  const loose = LooseOutput.safeParse(extractJson(raw));
  if (!loose.success) throw new ProviderError("invalid_output", "output failed schema validation");
  const out: TrialAnalysis[] = [];
  for (const t of loose.data.trials) {
    const candidate = {
      nctId: t.nctId,
      fitLevel: t.fitLevel,
      criteria: t.criteria
        .filter((c) => c.quote.trim() && c.explanation.trim())
        .slice(0, 12)
        .map((c) => ({ section: c.section, number: c.number, quote: c.quote.slice(0, 2000), assessment: c.assessment, explanation: clip(c.explanation.trim(), 600) })),
      doctorQuestions: t.doctorQuestions.map((q) => clip(q.trim(), 300)).filter(Boolean).slice(0, 5),
      summary: clip(t.summary.trim() || "-", 400),
    };
    const strict = TrialAnalysisSchema.safeParse(candidate);
    if (strict.success) out.push(strict.data);
  }
  if (out.length === 0) throw new ProviderError("invalid_output", "no valid trial analyses");
  return out;
}
