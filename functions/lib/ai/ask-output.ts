import { z } from "zod";
import { normalizeWs } from "@/lib/ingest/parse";
import { CitationSchema, RefusalReasonSchema, type Citation } from "@/lib/types/ask";
import type { ServerTrial } from "../trials";
import { ProviderError } from "./types";
import type { AskModelOutput } from "./mock-ask";

const Loose = z.object({
  kind: z.enum(["answer", "not_in_text", "refusal"]),
  refusalReason: RefusalReasonSchema.nullable().optional(),
  answer: z.string().min(1),
  citations: z
    .array(z.object({ section: z.enum(["inclusion", "exclusion", "summary", "title"]), number: z.coerce.number().int().positive().nullable().optional(), quote: z.string() }))
    .default([]),
});

export function parseAskOutput(raw: string): AskModelOutput {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ProviderError("invalid_output", "no JSON");
  let json: unknown;
  try {
    json = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new ProviderError("invalid_output", "malformed JSON");
  }
  const p = Loose.safeParse(json);
  if (!p.success) throw new ProviderError("invalid_output", "schema");
  return {
    kind: p.data.kind,
    refusalReason: p.data.kind === "refusal" ? (p.data.refusalReason ?? "off_topic") : null,
    answer: p.data.answer.trim().slice(0, 1200),
    citations: p.data.citations.map((c) => ({ section: c.section, number: c.section === "inclusion" || c.section === "exclusion" ? (c.number ?? null) : null, quote: c.quote.slice(0, 1500) })),
  };
}

const norm = (s: string) => normalizeWs(s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"')).replace(/^[\s"'.…]+|[\s"'.…]+$/g, "");

/** Keep only citations whose quote appears verbatim in the referenced part of the trial's own text. */
export function verifyCitations(citations: readonly Citation[], trial: ServerTrial): Citation[] {
  const out: Citation[] = [];
  for (const c of citations) {
    const q = norm(c.quote);
    if (q.length < 8) continue;
    let source: string | undefined;
    if (c.section === "title") source = trial.title;
    else if (c.section === "summary") source = trial.summary;
    else source = (c.section === "inclusion" ? trial.inclusion : trial.exclusion).find((x) => x.n === c.number)?.text;
    if (source && norm(source).includes(q)) {
      const parsed = CitationSchema.safeParse(c);
      if (parsed.success) out.push(parsed.data);
    }
  }
  return out.slice(0, 5);
}
