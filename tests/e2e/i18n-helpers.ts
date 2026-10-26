import type { Page } from "@playwright/test";

/** Choose a UI language through the searchable picker in the header. */
export async function chooseLanguage(page: Page, tag: string) {
  await page.locator('header button[aria-haspopup="dialog"]').first().click();
  await page.locator(`[role="option"][data-locale="${tag}"]`).click();
}
