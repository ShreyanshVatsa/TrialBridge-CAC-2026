/** Small display formatters shared by UI components. Pure functions, no I/O. */

/** "PHASE1", "PHASE2" -> "1/2"; "EARLY_PHASE1" -> "Early 1"; "NA" -> "". The word "Phase" comes from translated messages. */
export function formatPhases(phases: readonly string[]): string {
  const parts = phases
    .filter((p) => p && p.toUpperCase() !== "NA")
    .map((p) => {
      const up = p.toUpperCase();
      if (up.startsWith("EARLY_PHASE")) return `Early ${up.replace("EARLY_PHASE", "")}`;
      return up.replace(/^PHASE/, "");
    });
  if (parts.length === 0) return "";
  return parts.join("/");
}

/** Format an ISO date ("2026-09-30" or full timestamp) for display without timezone drift. */
export function formatDate(iso: string, locale = "en-US"): string {
  const d = /^\d{4}-\d{2}(-\d{2})?$/.test(iso) ? new Date(`${iso.length === 7 ? `${iso}-01` : iso}T00:00:00Z`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(d);
}

export function formatNumber(n: number, locale = "en-US"): string {
  return new Intl.NumberFormat(locale).format(n);
}

export function formatMiles(miles: number): string {
  return miles < 10 ? miles.toFixed(1) : String(Math.round(miles));
}

export function officialUrl(nctId: string): string {
  return `https://clinicaltrials.gov/study/${encodeURIComponent(nctId)}`;
}

export function trialHref(nctId: string): string {
  return `/trial/?id=${encodeURIComponent(nctId)}`;
}

/** Duck-typed DataLoadError code (lib/data loaders throw errors with a `code`). */
export function loadErrorCode(err: unknown): "network" | "not_found" | "invalid" | "timeout" | "unknown" {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: unknown }).code;
    if (code === "network" || code === "not_found" || code === "invalid" || code === "timeout") return code;
  }
  return "unknown";
}
