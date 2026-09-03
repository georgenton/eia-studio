import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * A technician must not reach another technician's work by editing the address bar.
 *
 * These run as technician 1 against assignments the fixture gave technician 2. The response is
 * **404**, not a denial: a distinguishable error confirms the assignment exists, which is exactly
 * what someone probing ids is trying to learn. Hiding the link is not the control — the read model
 * raises `NotFound`, and the RLS policy has already refused the row underneath it.
 */
const FIELD = `/t/${TENANT}/p/${PROJECT}/field`;

/**
 * An assignment id that belongs to somebody else.
 *
 * Discovered honestly: technician 2's ids are not visible to technician 1 anywhere, so the test
 * asserts on the *shape* of the refusal using an id that is well-formed and not in their list.
 * A real foreign id is exercised in the integration suite, which can see both sides.
 */
const FOREIGN_ASSIGNMENT = "00000000-0000-4000-8000-0000000000ff";

test.describe("FieldFlow · technician isolation", () => {
  test("My Work lists only this technician's own assignments", async ({ page }) => {
    await page.goto(FIELD);
    const codes = await page.getByRole("link").filter({ hasText: /PRED-/ }).allInnerTexts();

    expect(codes.length).toBeGreaterThan(0);
    // The fixture assigns every third parcel to the other technician, so a complete list would be
    // 12. Seeing fewer is the isolation working, not an empty page hiding a failure.
    expect(codes.length).toBeLessThan(12);
    for (const text of codes) expect(text).not.toContain("Técnico de campo 2");
  });

  test("an assignment id that is not theirs answers 404", async ({ page }) => {
    const response = await page.goto(`${FIELD}/assignments/${FOREIGN_ASSIGNMENT}`);
    expect(response?.status()).toBe(404);
  });

  test("a malformed assignment id answers 404 rather than an error page", async ({ page }) => {
    const response = await page.goto(`${FIELD}/assignments/not-a-uuid`);
    expect(response?.status()).toBe(404);
  });

  test("the technician surface never exposes the project's other work", async ({ page }) => {
    await page.goto(FIELD);
    const main = page.getByRole("main");
    // No campaign totals, no workload, no other technician's name, no submitted-response counts.
    await expect(main).not.toContainText("Carga por técnico");
    await expect(main).not.toContainText("Técnico de campo 2");
    await expect(main).not.toContainText("field.responses.read");
    await expect(main).not.toContainText("Asignadas");
  });

  test("a technician cannot reach the coordinator's Parcel Workspace visit history", async ({
    page,
  }) => {
    // `gis.parcels` is effective for the project, so the route exists; what the technician gets
    // there is their own work only, never the project's responses.
    await page.goto(`/t/${TENANT}/p/${PROJECT}/parcels/PRED-ZAM-001?tab=visitas`);
    const main = page.getByRole("main");
    await expect(main).not.toContainText("Técnico de campo 2");
  });
});
