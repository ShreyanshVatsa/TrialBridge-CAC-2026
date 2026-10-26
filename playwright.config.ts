import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against the real static export + Worker API via `wrangler dev`
 * (local D1, mock AI provider, Turnstile test keys). Build first: `npm run build`.
 * The Worker loads tests/e2e/keyless.env instead of .dev.vars, so real AI keys never reach e2e and
 * the deterministic mock provider is always used (`npm run dev` / `wrangler dev` still read .dev.vars).
 */
const PORT = Number(process.env.PW_PORT ?? 8788);
const ASSETS = process.env.PW_ASSETS ?? ".wrangler/e2e-out";
export default defineConfig({
  testDir: "tests/e2e",
  // Overridable so parallel local runs don't clobber each other's artifacts.
  outputDir: process.env.PW_OUTPUT_DIR ?? "test-results",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["line"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: {
    // Serves a snapshot of ./out (taken by `npm run test:e2e`) so a concurrent `next build` can't disturb the run.
    command: `npx wrangler dev --port ${PORT} --assets ${ASSETS} --env-file tests/e2e/keyless.env`,
    url: `http://localhost:${PORT}/api/health`,
    // Never silently reuse a server already on the port: it may be an orphan with real keys (.dev.vars)
    // or a stale asset snapshot. Playwright then fails fast with "port already used"; stop the old
    // `wrangler dev`, pick another PW_PORT, or opt in with PW_REUSE_SERVER=1 when you started it yourself.
    reuseExistingServer: process.env.PW_REUSE_SERVER === "1",
    timeout: 180_000,
    stdout: "ignore",
  },
});
