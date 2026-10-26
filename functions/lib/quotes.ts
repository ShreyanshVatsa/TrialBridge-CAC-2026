import { normalizeWs } from "@/lib/ingest/parse";
import type { CriterionAssessment, TrialAnalysis } from "@/lib/types/analysis";
import type { ServerTrial } from "./trials";

/** Normalize for verbatim comparison: unify quotes/dashes and collapse whitespace; case-sensitive. */
function norm(s: string): string {
  return normalizeWs(s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-")).replace(/^[\s"'.…]+|[\s"'.…]+$/g, "");
}

interface QuoteCheck {
  analyses: TrialAnalysis[];
  total: number;
  failed: number;
}

/**
 * Keep only criterion quotes that appear verbatim in that trial's own official criteria.
 * If a quote is found in a different criterion than claimed, the reference is corrected.
 * Analyses for trials that were not requested are dropped entirely.
 */
export function verifyQuotes(analyses: readonly TrialAnalysis[], trials: readonly ServerTrial[]): QuoteCheck {
  const byId = new Map(trials.map((t) => [t.id, t]));
  let total = 0;
  let failed = 0;
  const out: TrialAnalysis[] = [];
  const seen = new Set<string>();
  for (const a of analyses) {
    const trial = byId.get(a.nctId);
    if (!trial || seen.has(a.nctId)) continue;
    seen.add(a.nctId);
    const criteria: CriterionAssessment[] = [];
    for (const c of a.criteria) {
      total++;
      const q = norm(c.quote);
      if (q.length < 8) {
        failed++;
        continue;
      }
      const claimed = (c.section === "inclusion" ? trial.inclusion : trial.exclusion).find((x) => x.n === c.number);
      if (claimed && norm(claimed.text).includes(q)) {
        criteria.push(c);
        continue;
      }
      const where =
        trial.inclusion.find((x) => norm(x.text).includes(q)) ? { section: "inclusion" as const, list: trial.inclusion } : { section: "exclusion" as const, list: trial.exclusion };
      const found = where.list.find((x) => norm(x.text).includes(q));
      if (found) criteria.push({ ...c, section: where.section, number: found.n });
      else failed++;
    }
    out.push({ ...a, criteria });
  }
  return { analyses: out, total, failed };
}
