import type { MinimizedProfile } from "@/lib/types/analysis";
import { sha256Hex, stableStringify } from "./crypto";

/** Analysis results are cached for 30 days. */
export const ANALYSIS_TTL_SECONDS = 30 * 86_400;

/** Cache key = hash(minimized profile + sorted NCT IDs + data version + prompt version). */
export async function analysisCacheKey(profile: MinimizedProfile, nctIds: readonly string[], dataVersion: string, promptVersion: string): Promise<string> {
  const material = stableStringify({ profile, ids: [...new Set(nctIds)].sort(), dataVersion, promptVersion });
  return `an:${await sha256Hex(material)}`;
}
