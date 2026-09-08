import { expect, test } from "./fixtures";
import { CLIENT_VIEW, PORTAL } from "./portal-runner";

/**
 * A reviewer checks what would go out, and cannot send it.
 *
 * The split is the same one the Quality Gate makes: a specialist runs the check, a reviewer settles
 * it; here a reviewer inspects the publication and a coordinator decides that it goes out.
 * Asserted in a browser because the button's absence is the part a person relies on.
 */
test.describe("Portal · a reviewer", () => {
  test("sees the draft and the history", async ({ page }) => {
    await page.goto(PORTAL);
    const main = page.getByRole("main");
    await expect(main).toContainText("Preparar actualización");
    await expect(main).toContainText("Historial de publicaciones");
  });

  test("has no publish button", async ({ page }) => {
    await page.goto(PORTAL);
    await expect(page.getByRole("button", { name: /Publicar/ })).toHaveCount(0);
  });

  test("can still open the client's page to check it", async ({ page }) => {
    await page.goto(CLIENT_VIEW);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
