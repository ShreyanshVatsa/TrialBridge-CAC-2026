import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { completeIntake, RESULTS_HEADING } from "./helpers";

const BUDGETS = (JSON.parse(readFileSync("perf/budgets.json", "utf8")) as { bytes: { coldSearchKB: { data: number; model: number; wasm: number } } }).bytes.coldSearchKB;

/**
 * First-search latency (cold cache) and repeat-search latency, with transferred bytes by kind.
 * Latency budgets are generous (local machine) and logged in the test output; the bytes transferred per kind are
 * held to perf/budgets.json (cold search: model + wasm + the data for one group plus ZIP/manifest files).
 */
test("first-search and repeat-search latency", async ({ page }) => {
  const bytes: Record<string, number> = {};
  // Transformers.js requests each model file twice while loading. A real browser serves the second request from its
  // HTTP cache (the files are `immutable`), but Playwright's browser context does not, so count each model/wasm file once:
  // that is the cold download a visitor actually pays.
  const seenOnce = new Set<string>();
  page.on("response", async (r) => {
    const u = new URL(r.url()).pathname;
    if (u.startsWith("/models/") || u.startsWith("/ort/")) {
      if (seenOnce.has(u)) return;
      seenOnce.add(u);
    }
    const kind = u.startsWith("/models/") ? "model" : u.startsWith("/ort/") ? "wasm" : u.startsWith("/data/") ? "data" : u.startsWith("/_next/") ? "app" : "other";
    const len = (await r.request().sizes().catch(() => ({ responseBodySize: 0 }))).responseBodySize;
    bytes[kind] = (bytes[kind] ?? 0) + len;
  });
  const tStart = Date.now();
  await completeIntake(page, { cancer: "Breast cancer" });
  const intakeMs = Date.now() - tStart;
  const t0 = Date.now();
  await expect(page.getByText(RESULTS_HEADING)).toBeVisible({ timeout: 90_000 });
  const first = Date.now() - t0;
  await expect(page.getByText(/Meaning-based search couldn't load/i)).toHaveCount(0);

  await completeIntake(page, { cancer: "Breast cancer", zip: "10032" });
  const t1 = Date.now();
  await expect(page.getByText(RESULTS_HEADING)).toBeVisible({ timeout: 90_000 });
  const repeat = Date.now() - t1;
  const kb = Object.fromEntries(Object.entries(bytes).map(([k, v]) => [k, Math.round(v / 1024)]));
  console.log(`PERF intake-automation ${intakeMs} ms (shards + model prefetched meanwhile), first-search ${first} ms, repeat-search ${repeat} ms, KB transferred ${JSON.stringify(kb)}`);
  expect(first).toBeLessThan(30_000);
  expect(repeat).toBeLessThan(10_000);
  // Two searches in two breast ZIPs: one group download plus small ZIP/manifest/meta files.
  expect(kb.data ?? 0).toBeLessThanOrEqual(BUDGETS.data + 200);
  expect(kb.model ?? 0).toBeLessThanOrEqual(BUDGETS.model);
  expect(kb.wasm ?? 0).toBeLessThanOrEqual(BUDGETS.wasm);
});
