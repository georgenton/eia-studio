import { PROJECT, TENANT, expect, test } from "./fixtures";
import { ensureVersion } from "./reports-runner";

/** Golden references for the slice report; regenerated whenever the surface changes. */
const REPORTS = `/t/${TENANT}/p/${PROJECT}/reports`;
const shot = (name: string) => `docs/screenshots/slice-7/${name}.png`;

test.describe("Slice 7 screenshots", () => {
  // A version only exists once the chapter has been generated, and this file may execute first.
  test.beforeEach(async ({ page }) => {
    await ensureVersion(page);
  });

  test("the chapter's versions", async ({ page }) => {
    await page.goto(REPORTS);
    await expect(page.getByText("Borrador, no entregable").first()).toBeVisible();
    await page.screenshot({ path: shot("01-report-versions"), fullPage: true });
  });

  test("a version, with every figure's source", async ({ page }) => {
    await page.goto(`${REPORTS}/v1`);
    await expect(page.getByText("Universo y cobertura")).toBeVisible();
    await page.screenshot({ path: shot("02-report-version"), fullPage: true });
  });
});
