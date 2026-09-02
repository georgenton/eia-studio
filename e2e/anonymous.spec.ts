import { expect, PROJECT, TENANT, test } from "./fixtures";

test.describe("unauthenticated access", () => {
  test("a workspace route sends the visitor to sign in", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("the sign-in surface offers no registration", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
    await expect(page.getByText("El registro público está deshabilitado")).toBeVisible();
    await expect(page.getByRole("link", { name: /crear cuenta|registrarse/i })).toHaveCount(0);
  });
});
