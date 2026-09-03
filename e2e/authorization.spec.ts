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

  test("a disabled capability answers 404, exactly like a URL that means nothing", async ({
    page,
  }) => {
    // reports.social_generator is ANNOUNCED, therefore never effective (D-014). Under ADR-016 the
    // route must not disclose the capability key or who could enable it.
    const disabled = await page.goto(`/t/${TENANT}/p/${PROJECT}/reports`);
    expect(disabled?.status()).toBe(404);
    const body = await page.textContent("body");
    expect(body).not.toContain("reports.social_generator");
    expect(body).not.toContain("Tenant Settings");

    // A nonsense segment is indistinguishable from it.
    const nonsense = await page.goto(`/t/${TENANT}/p/${PROJECT}/no-such-surface`);
    expect(nonsense?.status()).toBe(404);
  });

  test("the capability probe endpoint answers 404 for a capability that is not effective", async ({
    request,
  }) => {
    const disabled = await request.get(
      `/t/${TENANT}/p/${PROJECT}/capabilities/reports.social_generator`,
    );
    expect(disabled.status()).toBe(404);
    expect(await disabled.text()).not.toContain("whoCanEnable");

    const enabled = await request.get(`/t/${TENANT}/p/${PROJECT}/capabilities/core.projects`);
    expect(enabled.status()).toBe(200);
    expect(await enabled.json()).toMatchObject({ state: "ok", capability: "core.projects" });
  });

  test("an enabled but unbuilt surface states so plainly, and is not a 404", async ({ page }) => {
    // `quality.document_gate` is effective for the pilot profile but the Quality Gate is not
    // built. (GIS was this example until Slice 2 built it; FieldFlow until Slice 3 did.)
    const response = await page.goto(`/t/${TENANT}/p/${PROJECT}/quality`);
    expect(response?.status()).toBe(200);
    const main = page.getByRole("main");
    await expect(main).toContainText("la implementación aún no está disponible");
    await expect(main).toContainText("El módulo está habilitado para este proyecto");
    // Inert: it offers no module data and no module action beyond going back.
    await expect(main.getByRole("link")).toHaveCount(1);
  });
});
