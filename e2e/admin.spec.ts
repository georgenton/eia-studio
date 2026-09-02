import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * D-015 in the browser: a tenant ADMIN administers the tenant but has no implicit access to a
 * project's operational data. This is enforced server-side, in the read model and again by RLS.
 */
test.describe("tenant administrator without a project membership", () => {
  test("sees the project row but none of its figures", async ({ page }) => {
    await page.goto(`/t/${TENANT}`);
    await expect(page.getByRole("link", { name: /Vía Puente del Amor/ })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Solo administración de proyectos");
    await expect(page.getByRole("main").getByText("141", { exact: true })).toHaveCount(0);
  });

  test("cannot open the project's Command Center", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);
    await expect(page.getByRole("main")).toContainText("No tienes acceso a esta sección");
  });
});
