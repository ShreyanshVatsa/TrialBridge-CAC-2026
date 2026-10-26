import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

/**
 * Answer for one adaptive question:
 * - "unknown" / "skip" / "prefer_not" / "defer": the non-response chips;
 * - a string: the option label to choose (single choice);
 * - string[]: option labels to tick (multi choice), then Continue;
 * - { grid: { HER2: "Positive" } }: biomarker grid rows (unlisted rows stay "Don't know"), then Continue.
 */
export type QAnswer = "unknown" | "skip" | "prefer_not" | "defer" | string | string[] | { grid: Record<string, string> };

export interface IntakeOptions {
  cancer: string;
  zip?: string;
  travel?: string;
  age?: string;
  /** Answers by question id; questions not listed get `fallback`. */
  answers?: Record<string, QAnswer>;
  fallback?: QAnswer;
  mode?: "Quick" | "Thorough";
  /** Press "Show my matches now" after this many adaptive questions. */
  stopAfter?: number;
  /** Click "Search trials" on the summary (default true). */
  search?: boolean;
  /** Called with each adaptive question id as it appears (before answering). */
  onQuestion?: (id: string) => Promise<void> | void;
}

export const SUMMARY_HEADING = "Check your answers";

/** Start a fresh questionnaire (clears this tab's saved answers). */
export async function freshFind(page: Page): Promise<void> {
  await page.goto("/find/");
  await page.evaluate(() => sessionStorage.clear());
  await page.goto("/find/");
}

export async function answerEssentials(page: Page, o: Pick<IntakeOptions, "cancer" | "zip" | "travel" | "age">): Promise<void> {
  const card = (id: string) => page.locator(`section[data-question="${id}"]`);
  await card("cancer_type").getByRole("button", { name: o.cancer, exact: true }).click();
  await card("age").locator("input").fill(o.age ?? "52");
  await card("age").locator("input").press("Enter");
  await card("zip").locator("input").fill(o.zip ?? "02115");
  await card("zip").locator("input").press("Enter");
  await card("travel").getByRole("button", { name: o.travel ?? "Up to 250 miles", exact: true }).click();
}

const NON_RESPONSE: Record<string, RegExp> = {
  skip: /^Skip$/,
  prefer_not: /^Prefer not to say$/,
  defer: /^My doctor can fill this in later$/,
};

/** Answer the question card currently on screen. Returns its id. */
export async function answerCurrent(page: Page, answer: QAnswer): Promise<string> {
  const card = page.locator("section[data-question]").last();
  const id = (await card.getAttribute("data-question")) ?? "";
  const other = card.getByRole("group", { name: "Other ways to answer" });
  if (answer === "unknown") {
    await other.getByRole("button").first().click();
  } else if (typeof answer === "string" && NON_RESPONSE[answer]) {
    await other.getByRole("button", { name: NON_RESPONSE[answer] }).click();
  } else if (typeof answer === "string") {
    await card.locator("label").filter({ hasText: answer }).first().click();
  } else if (Array.isArray(answer)) {
    for (const label of answer) await card.locator("label").filter({ hasText: label }).first().click();
    await card.getByRole("button", { name: "Continue" }).click();
  } else {
    for (const [marker, status] of Object.entries(answer.grid)) {
      await card.getByRole("radiogroup", { name: marker }).locator("label").filter({ hasText: status }).click();
    }
    await card.getByRole("button", { name: "Continue" }).click();
  }
  return id;
}

/** Walk the adaptive questionnaire to the summary card (English UI). Returns the adaptive question ids asked. */
export async function completeQuestionnaire(page: Page, o: IntakeOptions): Promise<string[]> {
  await freshFind(page);
  await answerEssentials(page, o);
  const asked: string[] = [];
  const summary = page.getByRole("heading", { name: SUMMARY_HEADING });
  const card = page.locator("section[data-question]");
  for (let i = 0; i < 40; i++) {
    await expect(summary.or(card.last())).toBeVisible({ timeout: 30_000 });
    if (await summary.isVisible()) break;
    if (i === 0 && o.mode) await page.getByRole("radiogroup", { name: /How many questions/ }).locator("label").filter({ hasText: o.mode }).click();
    if (o.stopAfter !== undefined && asked.length >= o.stopAfter) {
      await page.getByRole("button", { name: "Show my matches now" }).click();
      continue;
    }
    const id = (await card.last().getAttribute("data-question")) ?? "";
    await o.onQuestion?.(id);
    await answerCurrent(page, o.answers?.[id] ?? o.fallback ?? "unknown");
    asked.push(id);
    await expect(page.locator(`section[data-question="${id}"]`)).toHaveCount(0);
  }
  await expect(summary).toBeVisible();
  if (o.search !== false) await page.getByRole("button", { name: "Search trials" }).click();
  return asked;
}

/** Back-compat name used by the other specs. */
export async function completeIntake(page: Page, o: IntakeOptions): Promise<void> {
  await completeQuestionnaire(page, o);
}

/** A real trial ID from the currently built dataset (first breast-shard card). */
export function sampleTrialId(): string {
  const manifest = JSON.parse(readFileSync("public/data/manifest.json", "utf8")) as { shardBase: string; groups: Record<string, string[]> };
  const shard = manifest.groups.breast?.[0] ?? "";
  const cards = JSON.parse(readFileSync(`public${manifest.shardBase}/${shard}/cards.json`, "utf8")) as { id: string }[];
  const id = cards[0]?.id;
  if (!id) throw new Error("no trial in dataset");
  return id;
}

export const RESULTS_HEADING = /Possible matches to discuss with your care team/i;

/**
 * Wait until the page is visually at rest before an axe scan: smooth (Lenis) scrolling has stopped and every
 * finite time-based CSS animation/transition has finished. Without this, axe can sample a mid-fade frame:
 * e.g. Playwright's click scrolls the landing page, and the header's glass background is still fading in
 * (500 ms) while the nav links sit over the lens wall, whose clipped lavender layer axe counts as background.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.documentElement.classList.contains("lenis-scrolling"), undefined, { timeout: 10_000 });
  await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await document.fonts?.ready;
    const deadline = performance.now() + 5_000;
    for (;;) {
      // Scroll-linked state (header glass, reveal) is applied on the next frames; let it start first.
      await frame();
      const running = document.getAnimations().filter((a) => {
        if (a.playState !== "running" || !(a.timeline instanceof DocumentTimeline)) return false;
        const end = a.effect?.getComputedTiming().endTime;
        return typeof end === "number" && Number.isFinite(end);
      });
      if (!running.length || performance.now() > deadline) return;
      await Promise.race([Promise.all(running.map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, deadline - performance.now()))]);
    }
  });
}
