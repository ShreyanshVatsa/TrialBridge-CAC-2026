/**
 * Startup self-check for `npm run local` (also `npm run local:check` against a running server).
 * Pure over an injected fetch so it is unit tested with a fake.
 */
export interface CheckResult { name: string; ok: boolean; detail: string }
export interface SelfCheck { results: CheckResult[]; ok: boolean; summary: string }
type F = typeof fetch;

const MODEL_PATH = "/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx";

export const describeData = (version: string, total: number): string =>
  `${version.startsWith("national-") ? "National" : version.startsWith("seed") ? "Seed" : version}, ${total.toLocaleString("en-US")} trials`;

/** Minimal valid /api/analyze body: coarse minimized profile only, plus real NCT IDs from the loaded data. */
export function buildAnalyzeBody(cancerType: string, nctIds: string[]) {
  return {
    profile: { v: 2, cancerType, ageBracket: "60-69", spread: "not_sure", treatments: ["not_sure"], biomarkers: {}, pregnant: "not_sure", concurrentTrial: "not_sure", language: "en" },
    nctIds: nctIds.slice(0, 3),
    turnstileToken: "local-self-check",
  };
}

/** `liveAi`: the server uses real providers, so the AI check reads /api/health only (no request spends free-tier tokens). */
export async function runSelfCheck(base: string, f: F = fetch, opts: { expectMock?: boolean; liveAi?: boolean } = {}): Promise<SelfCheck> {
  const results: CheckResult[] = [];
  const add = (name: string, ok: boolean, detail: string) => results.push({ name, ok, detail });
  const attempt = async (name: string, fn: () => Promise<string>) => {
    try { add(name, true, await fn()); } catch (e) { add(name, false, e instanceof Error ? e.message : String(e)); }
  };
  const get = async (p: string, init?: RequestInit) => {
    const r = await f(base + p, { signal: AbortSignal.timeout(30_000), ...init });
    if (!r.ok) throw new Error(`${p} answered HTTP ${r.status}`);
    return r;
  };
  let version = "";
  let total = 0;
  let manifest: { shardBase: string; groups: Record<string, string[]> } | null = null;

  await attempt("home page", async () => { await get("/"); return "HTTP 200"; });
  await attempt("find page (/find/)", async () => { await get("/find/"); return "HTTP 200"; });
  await attempt("data version + trial count", async () => {
    const m = (await (await get("/data/meta.json")).json()) as { dataVersion?: string; totalTrials?: number };
    if (typeof m.dataVersion !== "string" || typeof m.totalTrials !== "number" || m.totalTrials < 1) throw new Error("meta.json is missing dataVersion/totalTrials");
    version = m.dataVersion; total = m.totalTrials;
    return describeData(version, total);
  });
  let group = "";
  let ids: string[] = [];
  await attempt("data shard loads and parses", async () => {
    manifest = (await (await get("/data/manifest.json")).json()) as NonNullable<typeof manifest>;
    const entry = Object.entries(manifest.groups).find(([, s]) => s[0] && s[0] !== "solid-basket");
    if (!entry) throw new Error("manifest lists no shards");
    group = entry[0];
    const cards = (await (await get(`${manifest.shardBase}/${entry[1][0]}/cards.json`)).json()) as { id?: string }[];
    ids = cards.map((c) => c.id ?? "").filter((i) => /^NCT\d{8}$/.test(i));
    if (!Array.isArray(cards) || ids.length === 0) throw new Error("shard has no trial cards");
    return `${entry[1][0]}: ${cards.length} trials`;
  });
  await attempt("embedding model served", async () => {
    const len = (await (await get(MODEL_PATH)).arrayBuffer()).byteLength;
    if (len < 1_000_000) throw new Error(`model file is only ${len} bytes (run npm run models:fetch)`);
    return `${(len / 1e6).toFixed(1)} MB`;
  });
  await attempt("API + AI analysis", async () => {
    const health = (await (await get("/api/health")).json()) as { ai?: string };
    if (opts.expectMock && health.ai !== "mock") throw new Error(`expected the mock AI provider but the server reports "${health.ai ?? "unknown"}"`);
    if (opts.liveAi) {
      if (health.ai !== "live") throw new Error(`expected real AI but the server reports "${health.ai ?? "unknown"}"`);
      return "real AI provider configured (not called, to save its free-tier limit)";
    }
    if (!ids.length) throw new Error("skipped: no trial IDs from the shard check");
    const r = await f(`${base}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base, "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify(buildAnalyzeBody(group, ids)),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await r.text();
    let body: { status?: string; error?: unknown } | null = null;
    try { body = JSON.parse(text); } catch { /* reported below */ }
    if (!body) throw new Error(`/api/analyze returned non-JSON (HTTP ${r.status})`);
    if (!r.ok) throw new Error(`/api/analyze answered HTTP ${r.status}: ${JSON.stringify(body).slice(0, 120)}`);
    return `HTTP 200, status=${body.status ?? "ok"}${opts.expectMock ? ", mock provider" : ""}`;
  });
  await attempt("service worker script", async () => {
    const t = await (await get("/sw.js")).text();
    if (!t.includes("service worker") && !t.includes("addEventListener")) throw new Error("/sw.js does not look like a service worker");
    return "served";
  });

  const ok = results.every((r) => r.ok);
  const summary = ok ? `All ${results.length} checks passed. ${version ? describeData(version, total) : ""}`.trim() : `${results.filter((r) => !r.ok).length} of ${results.length} checks FAILED`;
  return { results, ok, summary };
}

export function printSelfCheck(c: SelfCheck, log: (m: string) => void = console.log) {
  log("\nSelf-check:");
  for (const r of c.results) log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}: ${r.detail}`);
  log(`  => ${c.ok ? "PASS" : "FAIL"}: ${c.summary}\n`);
}

// CLI: `npm run local:check [-- --port=8787 | --url=http://localhost:8787]`
if (process.argv[1]?.endsWith("local-check.ts")) {
  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
  const base = arg("url") ?? `http://localhost:${arg("port") ?? 8787}`;
  runSelfCheck(base)
    .then((c) => { printSelfCheck(c); process.exit(c.ok ? 0 : 1); })
    .catch((e) => { console.error(e); process.exit(1); });
}
