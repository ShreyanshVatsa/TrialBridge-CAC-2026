import { expect, test } from "@playwright/test";
import { completeIntake, RESULTS_HEADING } from "./helpers";

test.describe("guided intake to AI results (mock)", () => {
  test("breast cancer, HER2-positive @mobile", async ({ page }) => {
    await completeIntake(page, { cancer: "Breast cancer", answers: { biomarkers: { grid: { HER2: "Positive" } } } });
    await expect(page.getByText(RESULTS_HEADING)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/possible match/i).first()).toBeVisible();
    await expect(page.getByText(/doesn't give medical advice/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Full trial details/i }).first()).toBeVisible();
  });

  test("lung cancer", async ({ page }) => {
    await completeIntake(page, { cancer: "Lung cancer", zip: "10032", travel: "Up to 500 miles", age: "64" });
    await expect(page.getByText(RESULTS_HEADING)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("link", { name: /Full trial details/i }).first()).toBeVisible();
  });

  test("other / not sure uses the cross-group index", async ({ page }) => {
    await completeIntake(page, { cancer: "Other / not sure", zip: "77030", travel: "Anywhere in the U.S.", age: "60" });
    await expect(page.getByText(RESULTS_HEADING)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("link", { name: /Full trial details/i }).first()).toBeVisible();
  });

  test("AI unavailable falls back to retrieval + rule results", async ({ page }) => {
    await page.route("**/api/analyze", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "internal", message: "x", requestId: "r" } }) }));
    await completeIntake(page, { cancer: "Breast cancer" });
    await expect(page.getByText(/AI reading unavailable: showing rule-based order/i)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("link", { name: /Full trial details/i }).first()).toBeVisible();
  });

  test("distance filter dropped because the ZIP table failed shows a notice", async ({ page }) => {
    await page.route("**/data/zip/**", (route) => route.abort("internetdisconnected"));
    await completeIntake(page, { cancer: "Breast cancer", travel: "Up to 25 miles" });
    await expect(page.getByText(RESULTS_HEADING)).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/travel distance was not applied/i)).toBeVisible();
  });

});
