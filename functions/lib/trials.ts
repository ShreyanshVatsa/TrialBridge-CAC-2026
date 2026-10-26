import { z } from "zod";
import { BarrierSchema, CancerGroupIdSchema, CriterionSchema, FactSchema, SplitCriterionSchema } from "@/lib/types/trial";

/** The backend's own copy of a trial's official text (from ingestion; never from the browser). */
export const ServerTrialSchema = z.object({
  id: z.string().regex(/^NCT\d{8}$/),
  title: z.string(),
  summary: z.string(),
  inclusion: z.array(CriterionSchema),
  exclusion: z.array(CriterionSchema),
  minAge: z.number().nullable(),
  maxAge: z.number().nullable(),
  groups: z.array(CancerGroupIdSchema),
  facts: z.array(FactSchema),
  barriers: z.array(BarrierSchema),
  /** Split criteria (optional: rows from older ingests have none, and the criterion judge then skips the trial). */
  criteria: z.array(SplitCriterionSchema).optional(),
  criteriaVersion: z.number().int().positive().optional(),
});
export type ServerTrial = z.infer<typeof ServerTrialSchema>;

export interface TrialStore {
  /** Load trials by NCT ID; unknown IDs are omitted. Order follows `ids`. */
  getTrials(ids: readonly string[]): Promise<ServerTrial[]>;
}

export class D1TrialStore implements TrialStore {
  constructor(private readonly db: D1Database) {}

  async getTrials(ids: readonly string[]): Promise<ServerTrial[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const { results } = await this.db.prepare(`SELECT nct_id, payload FROM trials WHERE nct_id IN (${placeholders})`).bind(...ids).all<{ nct_id: string; payload: string }>();
    const byId = new Map<string, ServerTrial>();
    for (const r of results) {
      try {
        const parsed = ServerTrialSchema.safeParse(JSON.parse(r.payload));
        if (parsed.success) byId.set(r.nct_id, parsed.data);
      } catch {
        // A corrupt row is skipped rather than failing the whole request.
      }
    }
    return ids.map((id) => byId.get(id)).filter((t): t is ServerTrial => t !== undefined);
  }
}

export class MemoryTrialStore implements TrialStore {
  private readonly byId: Map<string, ServerTrial>;
  constructor(trials: readonly ServerTrial[]) {
    this.byId = new Map(trials.map((t) => [t.id, t]));
  }
  async getTrials(ids: readonly string[]): Promise<ServerTrial[]> {
    return ids.map((id) => this.byId.get(id)).filter((t): t is ServerTrial => t !== undefined);
  }
}
