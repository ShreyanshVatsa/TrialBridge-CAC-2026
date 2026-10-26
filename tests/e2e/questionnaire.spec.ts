import { expect, test, type Page, type Request } from "@playwright/test";
import { answerCurrent, answerEssentials, completeQuestionnaire, freshFind, RESULTS_HEADING, SUMMARY_HEADING, type QAnswer } from "./helpers";

/** Total number shown by the live counter ("734 possible trials near you · ..."). */
async function counterTotal(page: Page): Promise<number> {
  const text = (await page.getByTestId("live-counter").textContent()) ?? "";
  return Number((/([\d,]+) possible trial/.exec(text)?.[1] ?? "NaN").replace(/,/g, ""));
}

const currentId = async (page: Page) => (await page.locator("section[data-question]").last().getAttribute("data-question")) ?? "";

/**
 * One adaptive flow per cancer type (spec §7.4). Definite answers are given where the question is asked;
 * every other question gets "Not sure", so whatever the engine picks, the flow completes.
 */
const flows: { name: string; cancer: string; answers: Record<string, QAnswer>; mobile?: boolean }[] = [
  { name: "breast HER2+", cancer: "Breast cancer", answers: { biomarkers: { grid: { HER2: "Positive" } } }, mobile: true },
  { name: "lung EGFR+ with brain mets", cancer: "Lung cancer", answers: { biomarkers: { grid: { EGFR: "Positive" } } } },
  { name: "prostate", cancer: "Prostate cancer", answers: {} },
  { name: "colorectal MSI-H", cancer: "Colorectal cancer", answers: { biomarkers: { grid: { "MSI-high / dMMR": "Positive" } } } },
  { name: "leukemia", cancer: "Leukemia", answers: {} },
  { name: "lymphoma", cancer: "Lymphoma", answers: {} },
  { name: "melanoma", cancer: "Melanoma and skin cancer", answers: {} },
  { name: "other / not sure", cancer: "Other / not sure", answers: {} },
];

test.describe("adaptive questionnaire", () => {
  for (const f of flows) {
    test(`flow: ${f.name}${f.mobile ? " @mobile" : ""}`, async ({ page }) => {
      const asked = await completeQuestionnaire(page, { cancer: f.cancer, answers: f.answers, fallback: "unknown" });
      expect(asked.length).toBeLessThanOrEqual(7); // quick mode
      await expect(page.getByText(RESULTS_HEADING)).toBeVisible({ timeout: 90_000 });
      await expect(page.getByRole("link", { name: /Full trial details/i }).first()).toBeVisible();
      // Our own wording never claims eligibility; verbatim trial criteria (blockquotes in the checklist) may use the word.
      const ownText = await page.evaluate(() => {
        const c = document.body.cloneNode(true) as HTMLElement;
        c.querySelectorAll("blockquote").forEach((b) => b.remove());
        return c.innerText || c.textContent || "";
      });
      expect(ownText).not.toMatch(/\beligible\b|\bqualify\b|you can join/i);
    });
  }

  test("all unknown: counter never drops, results appear, Find-out list is in the print view", async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => undefined;
    });
    await freshFind(page);
    await answerEssentials(page, { cancer: "Lung cancer" });
    await expect(page.getByTestId("live-counter")).toHaveText(/possible trial/);
    const start = await counterTotal(page);
    expect(start).toBeGreaterThan(0);
    const summary = page.getByRole("heading", { name: SUMMARY_HEADING });
    for (let i = 0; i < 30 && !(await summary.isVisible()); i++) {
      await answerCurrent(page, i % 2 ? "skip" : "unknown");
      await expect(summary.or(page.locator("section[data-question]").last())).toBeVisible();
      await expect(page.getByText(/That's okay|Nothing is ruled out/).last()).toBeVisible();
      await page.waitForTimeout(600); // counter is debounced 500 ms
      expect(await counterTotal(page)).toBe(start);
    }
    await expect(summary).toBeVisible();
    await page.getByRole("button", { name: "Search trials" }).click();
    await expect(page.getByText(RESULTS_HEADING)).toBeVisible({ timeout: 90_000 });
    // The reassurance lives in the status row's details disclosure.
    await page.getByText("Details", { exact: true }).click();
    await expect(page.getByText(/never lowers your results/)).toBeVisible();
    await expect(page.getByRole("heading", { name: /Find out at your next appointment/ })).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(page.getByText("Questions to ask at your appointment")).toBeVisible();
    await expect(page.getByText("Bring this to your appointment")).toBeVisible();
    // "Fill in what you found out" reopens exactly the Find-out questions, then returns to the summary.
    await page.emulateMedia({ media: "screen" });
    await page.getByRole("button", { name: "Fill in what you found out" }).click();
    const reopened = page.locator("section[data-question]").last();
    await expect(reopened).toBeVisible();
    for (let i = 0; i < 20 && (await reopened.isVisible()); i++) {
      await answerCurrent(page, "skip");
      await expect(summary.or(page.locator("section[data-question]").last())).toBeVisible();
    }
    await expect(summary).toBeVisible();
  });

  test("back and edit any answer", async ({ page }) => {
    await freshFind(page);
    await answerEssentials(page, { cancer: "Lung cancer" });
    const first = await currentId(page);
    await answerCurrent(page, "unknown");
    const second = await currentId(page);
    expect(second).not.toBe(first);
    // Back re-opens the previous question with its answer selected.
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.locator(`section[data-question="${first}"]`)).toBeVisible();
    await expect(page.locator(`section[data-question="${first}"]`).getByRole("button", { pressed: true })).toHaveCount(1);
    await answerCurrent(page, "skip");
    await expect(page.locator(`section[data-question="${first}"]`)).toHaveCount(0);
    // Edit from the transcript.
    // Older answers are collapsed behind "Show N earlier answers" so the active question stays near the top.
    await page.getByRole("button", { name: /^Show \d+ earlier answers?$/ }).click();
    await page.getByRole("button", { name: /^Edit answer:/ }).first().click();
    await expect(page.locator('section[data-question="cancer_type"]')).toBeVisible();
  });

  test("changing the cancer type drops answers that no longer apply, with a message", async ({ page }) => {
    await completeQuestionnaire(page, {
      cancer: "Lung cancer",
      mode: "Thorough",
      fallback: "unknown",
      answers: { biomarkers: { grid: { EGFR: "Positive" } } },
      search: false,
    });
    await expect(page.getByText("EGFR: Positive", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit: Cancer type" }).click();
    await page.locator('section[data-question="cancer_type"]').getByRole("button", { name: "Breast cancer", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /We removed/ })).toBeVisible();
    await expect(page.getByText(/EGFR: Positive/)).toHaveCount(0);
  });

  test("resume after reload, clear, and a new tab starts fresh", async ({ page, context }) => {
    await freshFind(page);
    await answerEssentials(page, { cancer: "Breast cancer", zip: "10032", age: "61" });
    await answerCurrent(page, "unknown");
    const pending = await currentId(page);
    await page.reload();
    await expect(page.getByText(/Welcome back/)).toBeVisible();
    await expect(page.locator(`section[data-question="${pending}"]`)).toBeVisible();
    const saved = await page.evaluate(() => sessionStorage.getItem("tb-questionnaire-v2"));
    expect(saved).toContain("10032");
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes("questionnaire")))).toEqual([]);

    const other = await context.newPage();
    await other.goto("/find/");
    await expect(other.locator('section[data-question="cancer_type"]')).toBeVisible();
    await expect(other.getByText(/Welcome back/)).toHaveCount(0);
    await other.close();

    await page.getByRole("button", { name: "Clear my answers" }).click();
    await expect(page.locator('section[data-question="cancer_type"]')).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("tb-questionnaire-v2"))).toBeNull();
  });

  test("under 18 stops the flow with pediatric resources", async ({ page }) => {
    await freshFind(page);
    await page.locator('section[data-question="cancer_type"]').getByRole("button", { name: "Breast cancer", exact: true }).click();
    await page.locator('section[data-question="age"] input').fill("16");
    await page.locator('section[data-question="age"] input').press("Enter");
    await expect(page.getByRole("alert").filter({ hasText: "TrialBridge is for adults right now" })).toBeVisible();
    await expect(page.getByRole("link", { name: /pediatric trials on ClinicalTrials.gov/ })).toBeVisible();
    await expect(page.locator('section[data-question="zip"]')).toHaveCount(0);
  });

  test("quick and thorough modes; show matches now", async ({ page }) => {
    const quick = await completeQuestionnaire(page, { cancer: "Breast cancer", search: false });
    const thorough = await completeQuestionnaire(page, { cancer: "Breast cancer", mode: "Thorough", search: false });
    expect(quick.length).toBeLessThanOrEqual(7);
    expect(thorough.length).toBeGreaterThanOrEqual(quick.length);
    const early = await completeQuestionnaire(page, { cancer: "Breast cancer", stopAfter: 1, search: false });
    expect(early.length).toBe(1);
    await expect(page.getByRole("heading", { name: SUMMARY_HEADING })).toBeVisible();
  });

  test("keyboard only: radio group with arrow keys and Continue", async ({ page }) => {
    await freshFind(page);
    await answerEssentials(page, { cancer: "Lung cancer" });
    const card = page.locator("section[data-question]").last();
    const id = await currentId(page);
    const radios = card.locator("fieldset").getByRole("radio");
    const boxes = card.locator("fieldset").getByRole("checkbox");
    if ((await radios.count()) > 1) {
      await radios.first().focus();
      await page.keyboard.press("ArrowRight");
      await expect(radios.nth(1)).toBeChecked();
      await page.keyboard.press("Enter"); // implicit form submission = Continue
    } else if ((await boxes.count()) > 0) {
      await boxes.first().focus();
      await page.keyboard.press("Space");
      await expect(boxes.first()).toBeChecked();
      await card.getByRole("button", { name: "Continue" }).focus();
      await page.keyboard.press("Enter");
    } else {
      await card.getByRole("group", { name: "Other ways to answer" }).getByRole("button").first().focus();
      await page.keyboard.press("Enter");
    }
    await expect(page.locator(`section[data-question="${id}"]`)).toHaveCount(0);
  });

  test("data minimization: ZIP, exact age, raw answers and prefer-not health answers never reach the backend", async ({ page }) => {
    const sent: Request[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.startsWith("/api/")) sent.push(r);
    });
    // Thorough mode so health-history questions are asked; sensitive ones get a definite or prefer-not answer.
    await completeQuestionnaire(page, {
      cancer: "Breast cancer",
      zip: "02115",
      age: "57",
      mode: "Thorough",
      fallback: "unknown",
      answers: { hiv: "prefer_not", hepatitis: "prefer_not", pregnancy: "prefer_not" },
    });
    await expect(page.getByText(RESULTS_HEADING)).toBeVisible({ timeout: 90_000 });
    await expect.poll(() => sent.length, { timeout: 30_000 }).toBeGreaterThan(0);
    const allowed = [
      "v", "cancerType", "ageBracket", "spread", "treatments", "biomarkers", "pregnant", "concurrentTrial", "language",
      "subtype", "stageCategory", "diseaseStatus", "priorLines", "activityBand", "brainMets", "groupStatus", "priorDrugClasses",
      // Coarse health-history categories (closed enums) may be sent for the criterion judge.
      "sexListed", "measurableDisease", "otherCancer", "hivStatus", "hepatitisStatus", "transplantType", "autoimmuneStatus", "organProblems",
    ];
    const browserOnly = ["zip", "age", "travel", "travelMiles", "sex", "hiv", "hepatitis", "transplant", "autoimmune", "organ_problems", "other_cancer", "measurable", "phase_pref", "deferred", "questionnaire", "answers", "history", "findOut"];
    for (const r of sent) {
      const everything = `${r.url()} ${r.postData() ?? ""} ${JSON.stringify(r.headers())}`;
      expect(everything).not.toContain("02115");
      expect(everything).not.toMatch(/\b57\b/);
      const body = JSON.parse(r.postData() ?? "{}") as { profile?: Record<string, unknown> };
      for (const k of browserOnly) expect(Object.keys(body)).not.toContain(k);
      if (body.profile) {
        for (const k of Object.keys(body.profile)) expect(allowed).toContain(k);
        for (const k of browserOnly) expect(Object.keys(body.profile)).not.toContain(k);
        expect(body.profile.ageBracket).toBe("50-59");
        // Prefer-not answers are never sent.
        expect(body.profile).not.toHaveProperty("hivStatus");
        expect(body.profile).not.toHaveProperty("hepatitisStatus");
      }
    }
  });
});
