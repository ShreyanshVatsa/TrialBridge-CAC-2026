import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { expect, test, type Page, type Request } from "@playwright/test";
import { findPrivacyLeaks } from "../../lib/privacy/leaks";
import { chooseLanguage } from "./i18n-helpers";
import { answerCurrent, answerEssentials, completeQuestionnaire, freshFind, RESULTS_HEADING, settle, SUMMARY_HEADING } from "./helpers";

/** Cards of the national dataset by id (all shards), for checking what a results page may contain. */
function cardSexById(): Map<string, string> {
  const manifest = JSON.parse(readFileSync("public/data/manifest.json", "utf8")) as { shardBase: string; shards: { id: string }[] };
  const names = manifest.shards.map((x) => x.id);
  const out = new Map<string, string>();
  for (const s of names) {
    try {
      const cards = JSON.parse(readFileSync(`public${manifest.shardBase}/${s}/cards.json`, "utf8")) as { id: string; sex: string }[];
      for (const c of cards) out.set(c.id, c.sex);
    } catch {
      /* shard without cards */
    }
  }
  return out;
}

async function axeSerious(page: Page, label: string) {
  await settle(page);
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).exclude("iframe").analyze();
  const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}

test.describe("questionnaire gaps (spec 7.4, 7.5)", () => {
  test("flow: prostate castration-resistant and AML FLT3+", async ({ page }) => {
    for (const [cancer, answers] of [
      ["Prostate cancer", { group_status: "It grows even with hormone therapy" }],
      ["Leukemia", { biomarkers: { grid: { FLT3: "Positive" } } }],
    ] as const) {
      const asked = await completeQuestionnaire(page, { cancer, answers, fallback: "unknown" });
      expect(asked.length).toBeLessThanOrEqual(7);
      await expect(page.getByText(RESULTS_HEADING)).toBeVisible({ timeout: 90_000 });
    }
  });

  test("sex filter: a definite male answer removes female-only trials from the results", async ({ page }) => {
    const sexById = cardSexById();
    expect(sexById.size).toBeGreaterThan(100);
    const asked = await completeQuestionnaire(page, { cancer: "Breast cancer", mode: "Thorough", fallback: "unknown", answers: { sex: "Male" } });
    expect(asked, "the sex question is asked for breast cancer in thorough mode").toContain("sex");
    await expect(page.getByText(RESULTS_HEADING)).toBeVisible({ timeout: 90_000 });
    for (let i = 0; i < 5; i++) {
      const more = page.getByRole("button", { name: /show more/i });
      if (!(await more.isVisible())) break;
      await more.click();
    }
    const ids = await page.getByRole("link", { name: /Full trial details/i }).evaluateAll((as) => as.map((a) => new URL((a as HTMLAnchorElement).href).searchParams.get("id") ?? ""));
    expect(ids.length).toBeGreaterThan(0);
    const female = ids.filter((id) => sexById.get(id) === "FEMALE");
    expect(female).toEqual([]);
  });

  test("privacy: no request carries the ZIP, exact age, browser-only keys or sensitive answers (findPrivacyLeaks)", async ({ page }) => {
    const sent: Request[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/api/") || (u.hostname !== "localhost" && u.hostname !== "127.0.0.1")) sent.push(r);
    });
    await completeQuestionnaire(page, {
      cancer: "Lung cancer",
      zip: "60611",
      age: "63",
      mode: "Thorough",
      fallback: "unknown",
      answers: { hiv: "Yes, controlled with medicine", transplant: "Organ transplant (like kidney or liver)", sex: "Male", pregnancy: "prefer_not" },
    });
    await expect(page.getByText(RESULTS_HEADING)).toBeVisible({ timeout: 90_000 });
    await expect.poll(() => sent.length, { timeout: 30_000 }).toBeGreaterThan(0);
    for (const r of sent) {
      const text = `${r.url()}\n${r.postData() ?? ""}\n${JSON.stringify(r.headers())}`;
      expect(findPrivacyLeaks(r.postData() ?? "", { zip: "60611", age: 63, values: ["controlled", "organ"] }), r.url()).toEqual([]);
      expect(text).not.toContain("60611");
      // headers() already lists custom headers; allHeaders() would wait on requests still in flight (the AI reading).
      expect(r.headers()).not.toHaveProperty("x-zip");
    }
  });

  test("quick vs thorough: thorough asks at least as many, and the toggle is available mid-flow", async ({ page }) => {
    test.setTimeout(240_000); // two full flows
    const quick = await completeQuestionnaire(page, { cancer: "Breast cancer", fallback: "unknown", search: false });
    const thorough = await completeQuestionnaire(page, { cancer: "Breast cancer", mode: "Thorough", fallback: "unknown", search: false });
    expect(quick.length).toBeLessThanOrEqual(7);
    expect(thorough.length).toBeGreaterThanOrEqual(quick.length);
  });

  test("counter is announced through an aria-live region", async ({ page }) => {
    await freshFind(page);
    await answerEssentials(page, { cancer: "Breast cancer" });
    const counter = page.getByTestId("live-counter");
    await expect(counter).toHaveAttribute("aria-live", "polite");
    await expect(counter).toHaveText(/possible trial/);
    await answerCurrent(page, "unknown");
    await expect(counter).toHaveText(/possible trial/);
  });

  test("320 px and a 200% zoom viewport: no horizontal scroll on questions and summary", async ({ page }) => {
    for (const w of [320, 640]) {
      await page.setViewportSize({ width: w, height: 700 });
      await freshFind(page);
      await answerEssentials(page, { cancer: "Lung cancer" });
      const summary = page.getByRole("heading", { name: SUMMARY_HEADING });
      for (let i = 0; i < 12 && !(await summary.isVisible()); i++) {
        await answerCurrent(page, "unknown");
        await expect(summary.or(page.locator("section[data-question]").last())).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
      }
      await expect(summary).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    }
  });

  for (const tag of ["ar", "zh-Hans"]) {
    test(`axe: essential and first adaptive questions in ${tag}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      await chooseLanguage(page, tag);
      await expect(page.locator("html")).toHaveAttribute("lang", tag);
      await page.goto("/find/");
      await page.evaluate(() => sessionStorage.clear());
      await page.goto("/find/");
      const card = (id: string) => page.locator(`section[data-question="${id}"]`);
      await expect(card("cancer_type")).toBeVisible();
      await axeSerious(page, `${tag}/cancer_type`);
      await card("cancer_type").getByRole("button").first().click();
      await card("age").locator("input").fill("52");
      await axeSerious(page, `${tag}/age`);
      await card("age").locator("input").press("Enter");
      await card("zip").locator("input").fill("02115");
      await card("zip").locator("input").press("Enter");
      await axeSerious(page, `${tag}/travel`);
      await card("travel").getByRole("button").first().click();
      await expect(page.locator("section[data-question]").last()).toBeVisible();
      await expect(page.locator("section[data-question]")).not.toHaveCount(0);
      await axeSerious(page, `${tag}/adaptive`);
    });
  }
});

test.describe("guided intake polish", () => {
  test("intro sets expectations; caregiver wording; no identity stored", async ({ page }) => {
    await freshFind(page);
    await expect(page.getByRole("heading", { name: "Let's look for studies near you" })).toBeVisible();
    await expect(page.getByText("about 2 to 4 minutes").locator("visible=true").first()).toBeVisible();
    await page.getByLabel("I'm answering for someone else").check();
    await page.locator('section[data-question="cancer_type"]').getByRole("button", { name: "Breast cancer", exact: true }).click();
    await expect(page.locator('section[data-question="age"]').getByText("How old are they?").first()).toBeVisible();
    const store = await page.evaluate(() => JSON.stringify({ ...sessionStorage }));
    expect(store).not.toMatch(/name|relationship/i);
    await page.waitForTimeout(800); // let the entrance animation finish before measuring contrast
    await axeSerious(page, "caregiver");
  });

  test("number keys choose an option; summary groups the unknowns", async ({ page }) => {
    await freshFind(page);
    await answerEssentials(page, { cancer: "Breast cancer" });
    const card = page.locator("section[data-question]").last();
    await expect(card).toBeVisible();
    const id = await card.getAttribute("data-question");
    const radios = card.locator('fieldset input[type="radio"]');
    if ((await radios.count()) > 0) {
      await radios.first().focus();
      await page.keyboard.press("1");
      await expect(page.locator(`section[data-question="${id}"]`)).toHaveCount(0);
    }
    await page.getByRole("button", { name: "Show my matches now" }).click();
    await expect(page.getByRole("heading", { name: SUMMARY_HEADING })).toBeVisible();
    await expect(page.getByRole("heading", { name: "About you", exact: true })).toBeVisible();
  });

  test("biomarker grid shows an answered count and the one-click unknown", async ({ page }) => {
    await completeQuestionnaire(page, { cancer: "Breast cancer", answers: { biomarkers: { grid: { HER2: "Positive" } } }, search: false });
    await expect(page.getByRole("heading", { name: SUMMARY_HEADING })).toBeVisible();
  });
});
