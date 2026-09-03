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

  test("the last enabled-but-unbuilt surface is now built, and the state has no route left", async ({
    page,
  }) => {
    // This test used to assert the inert "module not implemented" state at `/quality`. GIS was the
    // example until Slice 2, FieldFlow until Slice 3, and the Quality Gate until Slice 5 built it.
    // Every remaining workspace surface is ANNOUNCED, therefore never effective, therefore 404 —
    // so the state currently has **no reachable route**, and asserting it in a browser would mean
    // inventing a capability nobody ships.
    //
    // The policy itself is still covered where it is decided: `packages/domain/test/workspace.test.ts`
    // asserts that an effective capability whose surface is unbuilt yields `not-implemented`, and
    // `apps/web/lib/surface-access.ts` is the one place that maps it. Recorded as TD-055.
    const built = await page.goto(`/t/${TENANT}/p/${PROJECT}/quality`);
    expect(built?.status()).toBe(200);
    await expect(page.getByRole("main")).toContainText("Quality Gate");
    await expect(page.getByRole("main")).not.toContainText(
      "la implementación aún no está disponible",
    );

    // …and the announced ones stay indistinguishable from a URL that means nothing.
    for (const segment of ["documents", "reports"]) {
      const announced = await page.goto(`/t/${TENANT}/p/${PROJECT}/${segment}`);
      expect(announced?.status(), segment).toBe(404);
    }
  });
});
