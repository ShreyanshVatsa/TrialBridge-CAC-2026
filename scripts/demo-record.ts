/**
 * `npm run demo:record`: record real AI answers for the sample patient, so `npm run demo` replays them instantly.
 *
 * Needs the app running with real AI (`npm run local`, a key in .dev.vars). It opens the sample patient's results,
 * waits for the criterion judge and the explanations, asks the demo questions on the first result, and repeats
 * until a pass adds nothing new (free-tier limits can leave a batch unanswered; unanswered batches are never cached).
 * Then it copies the cached answers (hash keys only, no profile) from the local database to RECORDING.
 *   --url=http://localhost:8787   the running app
 *   --passes=3                    most passes
 *   --keep                        add to the answers already cached instead of starting clean
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

export const RECORDING = "data/demo/recorded-ai.json";
/** Cache prefixes worth replaying: explanations, criterion judge, trial Q&A. */
export const RECORDED_PREFIXES = ["an:", "mj:", "ask:"] as const;
/** Asked on the first result's trial page (the demo's Q&A). */
const DEMO_QUESTIONS = ["What performance status is required?", "What prior treatments does this trial require?"];
/** Pause between passes so a free tier's per-minute token limit refills. */
const PASS_GAP_MS = 65_000;

const argv = process.argv.slice(2);
const opt = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const base = opt("url") ?? "http://localhost:8787";
const passes = Number(opt("passes") ?? 3);
const keep = argv.includes("--keep");

function d1(sql: string): { key: string; value: string }[] {
  const r = spawnSync("npx", ["wrangler", "d1", "execute", "trialbridge", "--local", "--json", "--command", sql], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`wrangler d1 execute failed: ${r.stderr.slice(0, 300)}`);
  return (JSON.parse(r.stdout) as { results: { key: string; value: string }[] }[])[0]?.results ?? [];
}

const prefixWhere = RECORDED_PREFIXES.map((p) => `key LIKE '${p}%'`).join(" OR ");
const recordedCount = () => d1(`SELECT key, value FROM kv WHERE ${prefixWhere}`).length;

async function samplePass(page: Page): Promise<{ analyze: string; match: string }> {
  let analyze = "", match = "";
  page.on("response", async (r) => {
    if (r.url().endsWith("/api/analyze")) analyze = ((await r.json().catch(() => ({}))) as { status?: string }).status ?? "error";
    if (r.url().endsWith("/api/match")) match = ((await r.json().catch(() => ({}))) as { status?: string }).status ?? "error";
  });
  await page.goto(`${base}/find/?demo=1`, { waitUntil: "load" });
  for (let i = 0; i < 360 && !analyze; i++) await page.waitForTimeout(500);
  // The first result's trial page, then each demo question.
  await page.getByRole("link", { name: /Ask about this trial/i }).first().click();
  await page.waitForURL(/\/trial\//);
  for (const q of DEMO_QUESTIONS) {
    const box = page.locator("#ask textarea");
    await box.waitFor();
    await box.fill(q);
    const answered = page.waitForResponse((r) => r.url().endsWith("/api/ask"), { timeout: 120_000 });
    await page.locator("#ask button[type=submit]").click();
    await answered;
    await page.waitForTimeout(1500);
  }
  return { analyze, match };
}

async function main() {
  const health = (await (await fetch(`${base}/api/health`)).json()) as { ai?: string };
  if (health.ai !== "live") throw new Error(`${base} is not using real AI (health says "${health.ai}"). Start it with npm run local and a key in .dev.vars.`);
  // Start clean (unless --keep) so the recording holds only this sample patient's answers.
  if (!keep) d1(`DELETE FROM kv WHERE ${prefixWhere} OR key LIKE 'rl:%'`);
  const browser = await chromium.launch();
  let before = recordedCount();
  for (let pass = 1; pass <= passes; pass++) {
    d1("DELETE FROM kv WHERE key LIKE 'rl:%'");
    const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
    const r = await samplePass(page);
    await page.close();
    const now = recordedCount();
    console.log(`pass ${pass}: explanations ${r.analyze || "none"}, judge ${r.match || "none"}, ${now} answers cached (+${now - before})`);
    if (pass > 1 && now === before) break;
    before = now;
    if (pass < passes) await new Promise((res) => setTimeout(res, PASS_GAP_MS));
  }
  await browser.close();
  const rows = d1(`SELECT key, value FROM kv WHERE ${prefixWhere} ORDER BY key`);
  mkdirSync(path.dirname(RECORDING), { recursive: true });
  writeFileSync(RECORDING, `${JSON.stringify({ recordedAt: new Date().toISOString(), rows }, null, 1)}\n`);
  console.log(`Wrote ${rows.length} recorded answers to ${RECORDING}. npm run demo replays them.`);
}

main().catch((e) => {
  console.error(`demo:record: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
