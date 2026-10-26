import AxeBuilder from "@axe-core/playwright";
import { chooseLanguage } from "./i18n-helpers";
import { expect, test, type Page } from "@playwright/test";
import { answerCurrent, answerEssentials, completeIntake, freshFind, RESULTS_HEADING, sampleTrialId, settle, SUMMARY_HEADING } from "./helpers";

const id = sampleTrialId();

async function expectNoSeriousViolations(page: Page, label: string) {
  await settle(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).exclude("iframe").analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}

const pages: [string, string, RegExp | string][] = [
  ["landing", "/", /Find\s+cancer\s+clinical\s+trials/],
  ["find", "/find/", /cancer/i],
  ["trial", `/trial/?id=${id}`, id],
  ["access", "/access/", "Trials analyzed"],
  ["privacy", "/privacy/", /privacy/i],
  ["methodology", "/methodology/", /how/i],
  ["about", "/about/", /TrialBridge/],
  ["for-sites", "/for-sites/", /sites/i],
  ["404", "/no-such-page/", /not found/i],
];

for (const [label, url, ready] of pages) {
  for (const theme of ["light", "dark"] as const) {
    test(`axe: ${label} (${theme}) has no serious/critical violations`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.addInitScript((t) => localStorage.setItem("tb-theme", t), theme);
      await page.goto(url);
      await expect(page.getByText(ready).first()).toBeVisible();
      await expectNoSeriousViolations(page, `${label}/${theme}`);
    });
  }
}

test("axe: results view and Spanish UI", async ({ page }) => {
  await completeIntake(page, { cancer: "Breast cancer" });
  await expect(page.getByText(RESULTS_HEADING)).toBeVisible({ timeout: 90_000 });
  await expectNoSeriousViolations(page, "results");
  await page.goto("/");
  await chooseLanguage(page, "es");
  await expect(page.locator("h1")).toHaveText(/Encuentre/);
  await expectNoSeriousViolations(page, "landing-es");
});

/** Questionnaire views (first adaptive question, biomarker grid when asked, summary) at 320/390/1280 px, light and dark. */
for (const width of [320, 390, 1280]) {
  for (const theme of ["light", "dark"] as const) {
    test(`axe: questionnaire views at ${width}px (${theme})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.addInitScript((t) => localStorage.setItem("tb-theme", t), theme);
      await freshFind(page);
      await expectNoSeriousViolations(page, `q-start/${width}/${theme}`);
      await answerEssentials(page, { cancer: "Breast cancer" });
      const summary = page.getByRole("heading", { name: SUMMARY_HEADING });
      const seen = new Set<string>();
      for (let i = 0; i < 12 && !(await summary.isVisible()); i++) {
        const card = page.locator("section[data-question]").last();
        await expect(card).toBeVisible();
        const type = (await card.getByRole("table").count()) > 0 ? "grid" : (await card.getByRole("checkbox").count()) > 0 ? "multi" : "single";
        if (!seen.has(type)) {
          seen.add(type);
          await card.locator("details summary").first().click().catch(() => undefined);
          await expectNoSeriousViolations(page, `q-${type}/${width}/${theme}`);
        }
        await answerCurrent(page, "unknown");
        await expect(summary.or(page.locator("section[data-question]").last())).toBeVisible();
      }
      await expect(summary).toBeVisible();
      await expectNoSeriousViolations(page, `q-summary/${width}/${theme}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    });
  }
}
