import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * Server-side authorization, verified through the browser. Hiding a rail item is never the
 * control: these URLs are typed directly.
 */
test.describe("server-side authorization", () => {
  test("a tenant that the user is not a member of is indistinguishable from a missing one", async ({
    page,
  }) => {
    await page.goto("/t/otra-consultora");
    await expect(page.getByText("No tienes acceso a esta sección")).toBeVisible();
  });

  test("a project the user is not assigned to is denied", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/proyecto-inexistente`);
    await expect(page.getByText("No tienes acceso a esta sección")).toBeVisible();
  });

  test("a disabled capability cannot be opened by typing its URL", async ({ page }) => {
    // reports.social_generator is ANNOUNCED, therefore disabled for authorization (D-014).
    await page.goto(`/t/${TENANT}/p/${PROJECT}/reports`);
    const main = page.getByRole("main");
    await expect(main).toContainText("no está habilitado");
    await expect(main).toContainText("reports.social_generator");
    await expect(main.getByText("FEATURE DISABLED")).toBeVisible();
  });
});
