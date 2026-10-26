import { z } from "zod";
import { CancerGroupIdSchema } from "./trial";

/**
 * Access Intelligence aggregates (/data/access.json), computed at ingestion from barrier flags.
 * Counts are compact tuples: [trials, anyBarrier, englishRequired, upperAgeLimit, disabilityExclusion].
 */
export const CountsTupleSchema = z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.number().int()]);
export type CountsTuple = z.infer<typeof CountsTupleSchema>;

export const AccessSiteSchema = z.object({
  facility: z.string(),
  city: z.string(),
  /** Postal code, e.g. "MA". */
  state: z.string(),
  counts: CountsTupleSchema,
  groups: z.partialRecord(CancerGroupIdSchema, CountsTupleSchema),
});
export type AccessSite = z.infer<typeof AccessSiteSchema>;

export const AccessDataSchema = z.object({
  dataDate: z.string(),
  dataVersion: z.string(),
  /** Minimum trials for a site to be listed. */
  minSiteTrials: z.number().int(),
  totals: CountsTupleSchema,
  byGroup: z.partialRecord(CancerGroupIdSchema, CountsTupleSchema),
  /** State postal code -> counts (a trial counts in every state where it has a site). */
  byState: z.record(z.string(), CountsTupleSchema),
  byStateGroup: z.record(z.string(), z.partialRecord(CancerGroupIdSchema, CountsTupleSchema)),
  sites: z.array(AccessSiteSchema),
});
export type AccessData = z.infer<typeof AccessDataSchema>;
