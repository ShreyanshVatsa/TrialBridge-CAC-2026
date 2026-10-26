/** Pure decision logic for `npm run local` (no I/O, unit tested in scripts/local-plan.test.ts). */

export type LocalMode = "default" | "national" | "seed" | "demo";

export interface LocalState {
  mode: LocalMode;
  rebuild: boolean;
  modelFilesPresent: boolean;
  /** Version string from public/data/meta.json, or null when the file is missing or unreadable. */
  dataVersion: string | null;
  criteriaSqlPresent: boolean;
  devVarsPresent: boolean;
  /** mtime (ms) of out/index.html, or null when there is no build. */
  buildMtimeMs: number | null;
  /** Newest mtime (ms) among sources and data, or null if unknown. */
  newestSourceMtimeMs: number | null;
}

export interface LocalPlan {
  fetchModels: boolean;
  /** null = keep the current data. */
  ingest: "seed" | "national" | null;
  createDevVars: boolean;
  build: boolean;
  reasons: string[];
}

export const isNationalVersion = (v: string | null): boolean => typeof v === "string" && v.startsWith("national-");

export function planLocal(s: LocalState): LocalPlan {
  const reasons: string[] = [];
  const fetchModels = !s.modelFilesPresent;
  if (fetchModels) reasons.push("embedding model / ONNX runtime files missing");

  let ingest: LocalPlan["ingest"] = null;
  const haveData = s.dataVersion !== null && s.criteriaSqlPresent;
  if (s.mode === "national") {
    ingest = "national";
    reasons.push("national ingest requested");
  } else if (s.mode === "seed") {
    ingest = "seed";
    reasons.push("seed ingest requested explicitly");
  } else if (s.mode === "demo") {
    // `npm run demo` must work offline and in minutes: keep whatever data is there, else build the committed seed.
    if (!haveData) {
      ingest = "seed";
      reasons.push("no data found, building the committed seed dataset");
    }
  } else if (!haveData || !isNationalVersion(s.dataVersion)) {
    // National (all US cancer trials) is the standard. Seed data is never auto-chosen, but local.ts falls back to it if the download fails.
    ingest = "national";
    reasons.push(haveData ? "seed data found; upgrading to national" : "no data found, fetching national cancer trials");
  }

  const createDevVars = !s.devVarsPresent;
  if (createDevVars) reasons.push(".dev.vars missing");

  let build = false;
  if (s.rebuild) {
    build = true;
    reasons.push("--rebuild requested");
  } else if (s.buildMtimeMs === null) {
    build = true;
    reasons.push("no built output in ./out");
  } else if (ingest !== null) {
    build = true;
    reasons.push("data changes, rebuild needed");
  } else if (s.newestSourceMtimeMs !== null && s.newestSourceMtimeMs > s.buildMtimeMs) {
    build = true;
    reasons.push("sources or data are newer than the build");
  }
  return { fetchModels, ingest, createDevVars, build, reasons };
}

export type AiMode = { mode: "mock" } | { mode: "real"; providers: string[] };

/** A provider is live only with a key set AND dataTermsVerified. Names only; never values. */
export function aiMode(providers: readonly { name: string; keyEnv: string; dataTermsVerified: boolean }[], env: Record<string, string>): AiMode {
  const live = providers.filter((p) => (env[p.keyEnv] ?? "").trim() !== "" && p.dataTermsVerified).map((p) => p.name);
  return live.length ? { mode: "real", providers: live } : { mode: "mock" };
}

/** Parse KEY=VALUE lines (comments and blanks skipped). */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

export function nodeOk(version: string, min = 22): boolean {
  return Number(version.replace(/^v/, "").split(".")[0]) >= min;
}
