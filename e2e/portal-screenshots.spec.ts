import { expect, test } from "./fixtures";
import { CLIENT_VIEW, ensurePublication, PORTAL } from "./portal-runner";

/** Golden references for the portal wave; regenerated whenever the surface changes. */
const shot = (name: string) => `docs/screenshots/slice-8/${name}.png`;

test.describe("Client portal screenshots", () => {
  test.beforeEach(async ({ page }) => {
    await ensurePublication(page);
  });

  test("preparing and publishing", async ({ page }) => {
    await page.goto(PORTAL);
    await expect(page.getByText("Preparar actualización")).toBeVisible();
    await page.screenshot({ path: shot("01-portal-management"), fullPage: true });
  });

  test("what the client sees", async ({ page }) => {
    await page.goto(CLIENT_VIEW);
    await expect(page.locator("[data-map-idle='true']")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Plan de Manejo Ambiental" })).toBeVisible();
    await page.screenshot({ path: shot("02-client-view"), fullPage: true });
  });

  test("the printed summary", async ({ page }) => {
    await page.goto(CLIENT_VIEW);
    await expect(page.locator("[data-map-idle='true']")).toBeVisible({ timeout: 20_000 });
    await page.emulateMedia({ media: "print" });
    await page.screenshot({ path: shot("03-client-view-print"), fullPage: true });
    await page.emulateMedia({ media: "screen" });
  });
});
