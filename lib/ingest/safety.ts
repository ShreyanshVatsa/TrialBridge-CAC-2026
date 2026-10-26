/** Ingestion safety gates: keep the last good dataset when a run looks wrong. */
const MAX_INVALID_FRACTION = 0.05;
const MAX_DROP_FRACTION = 0.4;

interface SafetyInput {
  rawCount: number;
  invalidCount: number;
  builtCount: number;
  /** Previous dataset of the SAME source (null if none). */
  previousCount: number | null;
}

/** Returns an abort reason, or null when the new dataset may replace the old one. */
export function ingestAbortReason(s: SafetyInput): string | null {
  if (s.builtCount === 0) return "no valid trials were produced";
  const invalid = s.invalidCount / Math.max(1, s.rawCount);
  if (invalid > MAX_INVALID_FRACTION) return `${(invalid * 100).toFixed(1)}% of records failed validation (limit 5%)`;
  if (s.previousCount !== null && s.builtCount < s.previousCount * (1 - MAX_DROP_FRACTION)) {
    return `trial count dropped from ${s.previousCount} to ${s.builtCount} (more than 40%)`;
  }
  return null;
}
