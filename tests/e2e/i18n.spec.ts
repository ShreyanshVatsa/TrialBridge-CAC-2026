import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { chooseLanguage } from "./i18n-helpers";
import { sampleTrialId, settle } from "./helpers";

const id = sampleTrialId();

async function expectNoSeriousViolations(page: Page, label: string) {
  await settle(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).exclude("iframe").analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}

const CASES: { tag: string; dir: "ltr" | "rtl"; h1: RegExp }[] = [
  { tag: "es", dir: "ltr", h1: /Encuentre\s+estudios\s+clínicos/ },
  { tag: "ar", dir: "rtl", h1: /[؀-ۿ]/ },
  { tag: "zh-Hans", dir: "ltr", h1: /[一-鿿]/ },
];

for (const c of CASES) {
  test(`language ${c.tag}: lang/dir, translated UI, note, persistence, axe, no overflow`, async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    const csp: string[] = [];
    page.on("console", (m) => /Content Security Policy/i.test(m.text()) && csp.push(m.text()));
    await page.goto("/");
    await expect(page.locator("h1")).toHaveText(/Find\s+cancer\s+clinical\s+trials/);
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await chooseLanguage(page, c.tag);
    await expect(page.locator("h1")).toHaveText(c.h1);
    await expect(page.locator("html")).toHaveAttribute("lang", c.tag);
    await expect(page.locator("html")).toHaveAttribute("dir", c.dir);
    // Machine-translated note, dismissible.
    await expect(page.getByTestId("translation-note")).toBeVisible();
    await page.getByTestId("translation-note").getByRole("button").click();
    await expect(page.getByTestId("translation-note")).toHaveCount(0);
    // Locale file fetched on demand from the same origin; font pack stylesheet only for non-Latin scripts.
    expect(requests.some((u) => u.endsWith(`/i18n/${c.tag}.json`))).toBe(true);
    if (c.tag !== "es") expect(requests.some((u) => /\/fonts\/noto\/noto-[a-z]+\.css$/.test(u))).toBe(true);
    else expect(requests.some((u) => u.includes("/fonts/noto/"))).toBe(false);
    await expectNoSeriousViolations(page, `landing-${c.tag}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", c.tag);
    await expect(page.locator("html")).toHaveAttribute("dir", c.dir);
    await expect(page.locator("h1")).toHaveText(c.h1);
    expect(csp).toEqual([]);
    // Back to English restores ltr.
    await chooseLanguage(page, "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.locator("h1")).toHaveText(/Find\s+cancer\s+clinical\s+trials/);
  });

  test(`language ${c.tag}: trial Q&A shows the always-visible 988/911 line and crisis box`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("tb-lang", t), c.tag);
    await page.goto(`/trial/?id=${id}`);
    const line = page.getByTestId("crisis-line").first();
    await expect(line).toBeVisible();
    await expect(line).toContainText("988");
    await expect(line).toContainText("911");
    await expect(line.locator('[lang="en"]')).toContainText("988");
    await expectNoSeriousViolations(page, `trial-${c.tag}`);
  });
}

test("picker: search by native and English name, keyboard, Escape", async ({ page }) => {
  await page.goto("/");
  const trigger = page.locator('header button[aria-haspopup="dialog"]').first();
  await trigger.click();
  const box = page.getByRole("combobox");
  await expect(box).toBeFocused();
  await box.fill("viet");
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option").first()).toContainText("Tiếng Việt");
  await box.fill("espanol");
  await expect(page.getByRole("option")).toHaveCount(1);
  await box.fill("zzzz");
  await expect(page.getByRole("option")).toHaveCount(0);
  await box.fill("french");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await chooseLanguage(page, "en");
});

test("browser language only suggests a switch (no auto-switch)", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "es-MX" });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("region").getByRole("button", { name: "Español" })).toBeVisible();
  await page.getByRole("region").getByRole("button", { name: "Español" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await ctx.close();
});
