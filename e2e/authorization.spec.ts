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
    // Slice 7 built Reports, so every *workspace* surface of the pilot profile is now effective and
    // no rail destination is left to demonstrate this in a browser. The three catalogue extensions
    // are still disabled, and they have no route at all — which is the same observable outcome, and
    // the one this test can still assert honestly: a segment that maps to nothing, and a segment
    // named after a capability the project does not have, are indistinguishable.
    const extension = await page.goto(`/t/${TENANT}/p/${PROJECT}/climate`);
    expect(extension?.status()).toBe(404);
    const body = await page.textContent("body");
    expect(body).not.toContain("climate.analytics");
    expect(body).not.toContain("Tenant Settings");

    const nonsense = await page.goto(`/t/${TENANT}/p/${PROJECT}/no-such-surface`);
    expect(nonsense?.status()).toBe(404);

    // The route-level policy for an ineffective capability that *does* have a surface is asserted
    // on the probe endpoint below and in `packages/domain/test/workspace.test.ts` (TD-055).
  });

  test("the capability probe endpoint answers 404 for a capability that is not effective", async ({
    request,
  }) => {
    const disabled = await request.get(`/t/${TENANT}/p/${PROJECT}/capabilities/climate.analytics`);
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
    // example until Slice 2, FieldFlow until Slice 3, the Quality Gate until Slice 5, Documents
    // until Slice 6 and Reports until Slice 7. Every workspace surface of the pilot profile is now built, so the
    // state has **no reachable route**, and asserting it in a browser would mean inventing a
    // capability nobody ships.
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

    // Documents joined the built surfaces in Slice 6 and Reports in Slice 7, which leaves the
    // workspace with no ANNOUNCED surface and no unbuilt one.
    const documents = await page.goto(`/t/${TENANT}/p/${PROJECT}/documents`);
    expect(documents?.status()).toBe(200);
    const reports = await page.goto(`/t/${TENANT}/p/${PROJECT}/reports`);
    expect(reports?.status()).toBe(200);
    await expect(page.getByRole("main")).not.toContainText(
      "la implementación aún no está disponible",
    );
  });
});
