/**
 * Real-browser timings of the search path, read from the User Timing marks the app sets (lib/match/search.ts,
 * lib/match/embedder.ts, components/find/find-flow.tsx) and from the Resource Timing API.
 *
 *   npx tsx scripts/perf/search-timings.ts [--url=http://localhost:8790] [--runs=3] [--json]
 *
 * Needs a built site served locally (`npm run build`, then `npx wrangler dev --port 8790 --assets out --env-file
 * tests/e2e/keyless.env`) and Playwright's Chromium. Each run opens `/find/?demo=1` (the sample patient) twice in a fresh
 * browser context: COLD (empty caches: model, ORT runtime, shards all downloaded) and WARM (same context, second
 * navigation: Cache Storage holds the model files, the HTTP cache the shards). Reports, per run, time from search start
 * to results, the shard/model/index/ranking steps, the worker's model-load and embed times, bytes by kind (transfer
 * size, so compressed where the server compresses), and main-thread long tasks (>50 ms) between search start and results.
 */
import { chromium, type Page } from "@playwright/test";

const argv = process.argv.slice(2);
const opt = (n: string, d: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;
const URL_BASE = opt("url", "http://localhost:8790");
const RUNS = Number(opt("runs", "3"));
const JSON_OUT = argv.includes("--json");
/** Optional network throttle (download Mbps) applied through CDP to every run, including worker requests. */
const MBPS = Number(opt("mbps", "0"));

interface Timings {
  phase: "cold" | "warm";
  navToResultsMs: number;
  searchToResultsMs: number;
  steps: Record<string, number>;
  embed: { loadMs: number; embedMs: number } | null;
  judgeMs: number | null;
  analysisMs: number | null;
  bytesKB: Record<string, number>;
  longTasks: { count: number; totalMs: number; maxMs: number };
}

const INIT = `
  window.__tbLong = [];
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__tbLong.push({ start: e.startTime, dur: e.duration }); }).observe({ type: "longtask", buffered: true });
  } catch {}
`;

async function measure(page: Page, phase: "cold" | "warm"): Promise<Timings> {
  // Worker requests (model, ORT runtime) never appear in the page's Resource Timing: count them at the protocol level.
  const seen = new Set<string>();
  const workerKB: Record<string, number> = {};
  const onResponse = async (r: import("@playwright/test").Response) => {
    const u = new URL(r.url()).pathname;
    if (!(u.startsWith("/models/") || u.startsWith("/ort/")) || seen.has(u)) return;
    seen.add(u);
    const kind = u.startsWith("/models/") ? "model" : "wasm";
    const sizes = await r.request().sizes().catch(() => ({ responseBodySize: 0 }));
    workerKB[kind] = (workerKB[kind] ?? 0) + Math.round(sizes.responseBodySize / 1024);
  };
  page.on("response", onResponse);
  await page.goto(`${URL_BASE}/find/?demo=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => performance.getEntriesByName("tb:results").length > 0, null, { timeout: 180_000 });
  // Give the judge/analysis (mock provider locally) a moment, without waiting for them if they never come.
  await page.waitForFunction(() => performance.getEntriesByName("tb:judge").length > 0, null, { timeout: 20_000 }).catch(() => undefined);
  page.off("response", onResponse);
  // The body is a string: tsx/esbuild would otherwise inject `__name` helpers into a function it serializes for the page.
  const timings = (await page.evaluate(`(() => {
    const ph = ${JSON.stringify(phase)};
    const t = (name) => { const e = performance.getEntriesByName(name)[0]; return e ? e.startTime : null; };
    const start = t("tb:search:start");
    const results = t("tb:results");
    const steps = {};
    let prev = start;
    for (const s of ["shards", "vector", "index", "ranked", "hydrated", "done"]) {
      const x = t("tb:search:" + s);
      if (x === null) continue;
      steps[s] = Math.round(x - prev);
      prev = x;
    }
    const embedEntry = performance.getEntriesByName("tb:embed:result")[0];
    const bytes = {};
    for (const r of performance.getEntriesByType("resource")) {
      const u = new URL(r.name).pathname;
      const kind = u.startsWith("/models/") ? "model" : u.startsWith("/ort/") ? "wasm" : u.startsWith("/data/") ? "data" : u.startsWith("/_next/") ? "app" : u.startsWith("/fonts/") ? "fonts" : "other";
      bytes[kind] = (bytes[kind] || 0) + (r.transferSize || r.encodedBodySize || 0);
    }
    const long = (window.__tbLong || []).filter((e) => e.start >= start && e.start <= results);
    const judge = t("tb:judge");
    const analysis = t("tb:analysis");
    const kb = {};
    for (const k of Object.keys(bytes)) kb[k] = Math.round(bytes[k] / 1024);
    return {
      phase: ph,
      navToResultsMs: Math.round(results),
      searchToResultsMs: Math.round(results - start),
      steps,
      embed: embedEntry && embedEntry.detail ? embedEntry.detail : null,
      judgeMs: judge === null ? null : Math.round(judge - results),
      analysisMs: analysis === null ? null : Math.round(analysis - results),
      bytesKB: kb,
      longTasks: { count: long.length, totalMs: Math.round(long.reduce((a, e) => a + e.dur, 0)), maxMs: Math.round(Math.max(0, ...long.map((e) => e.dur))) },
    };
  })()`)) as Timings;
  for (const [k, v] of Object.entries(workerKB)) timings.bytesKB[k] = (timings.bytesKB[k] ?? 0) + v;
  return timings;
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const out: Timings[] = [];
  for (let i = 0; i < RUNS; i++) {
    const ctx = await browser.newContext();
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    if (MBPS > 0) {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: (MBPS * 1024 * 1024) / 8, uploadThroughput: (MBPS * 1024 * 1024) / 8 });
    }
    out.push(await measure(page, "cold"));
    out.push(await measure(page, "warm"));
    await ctx.close();
  }
  await browser.close();
  if (JSON_OUT) {
    console.log(JSON.stringify(out, null, 1));
    return;
  }
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? (s[Math.floor((s.length - 1) / 2)] as number) : NaN;
  };
  for (const phase of ["cold", "warm"] as const) {
    const rows = out.filter((r) => r.phase === phase);
    const stepKeys = [...new Set(rows.flatMap((r) => Object.keys(r.steps)))];
    console.log(`\n${phase.toUpperCase()} (median of ${rows.length} runs${MBPS > 0 ? `, ${MBPS} Mbps throttle` : ""})`);
    console.log(`  navigation -> results ${med(rows.map((r) => r.navToResultsMs))} ms; search start -> results ${med(rows.map((r) => r.searchToResultsMs))} ms`);
    console.log(`  steps: ${stepKeys.map((k) => `${k} ${med(rows.map((r) => r.steps[k] ?? NaN))} ms`).join(", ")}`);
    console.log(`  worker: model load ${med(rows.map((r) => r.embed?.loadMs ?? NaN))} ms, embed ${med(rows.map((r) => r.embed?.embedMs ?? NaN))} ms`);
    console.log(`  after results: judge ${med(rows.map((r) => r.judgeMs ?? NaN))} ms, analysis ${med(rows.map((r) => r.analysisMs ?? NaN))} ms (mock provider locally)`);
    const kinds = [...new Set(rows.flatMap((r) => Object.keys(r.bytesKB)))];
    console.log(`  transfer KB: ${kinds.map((k) => `${k} ${med(rows.map((r) => r.bytesKB[k] ?? 0))}`).join(", ")}`);
    console.log(`  long tasks (search -> results): count ${med(rows.map((r) => r.longTasks.count))}, total ${med(rows.map((r) => r.longTasks.totalMs))} ms, max ${med(rows.map((r) => r.longTasks.maxMs))} ms`);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
