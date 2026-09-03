import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * The other technician's browser.
 *
 * `field-security.spec.ts` proves that technician 1 cannot reach a foreign id by editing the
 * address bar. This suite asks the complementary question from the other side: with a real
 * session, real navigation and no tampering at all, does technician 2 ever *see* technician 1's
 * work — on their own surface, or through the Parcel Workspace, which is a shared surface about
 * the territory rather than about a person.
 *
 * Nothing here guesses an id. It walks the same links a technician would.
 */
const FIELD = `/t/${TENANT}/p/${PROJECT}/field`;
const OTHER_TECHNICIAN = "Técnico de campo 1";

test.describe("FieldFlow · a second technician", () => {
  test("My Work lists only their own assignments", async ({ page }) => {
    await page.goto(FIELD);
    await expect(page.getByRole("heading", { name: "Mi trabajo", level: 1 })).toBeVisible();

    const cards = page.getByRole("link").filter({ hasText: /PRED-/ });
    const count = await cards.count();
    // The fixture gives this technician every third assignment of a twelve-parcel campaign.
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(12);
    await expect(page.getByRole("main")).not.toContainText(OTHER_TECHNICIAN);
  });

  test("the Parcel Workspace shows this technician their own visits and nobody else's", async ({
    page,
  }) => {
    // The campaign's parcels are the first of the corridor by chainage, so the explorer's own
    // ordering reaches them without this test knowing which technician holds which.
    await page.goto(`/t/${TENANT}/p/${PROJECT}/gis`);
    await expect(page.getByRole("table")).toBeVisible();
    const codes = (
      await page
        .getByRole("cell")
        .filter({ hasText: /^PRED-/ })
        .allInnerTexts()
    )
      .map((text) => text.trim())
      .slice(0, 6);
    expect(codes.length).toBeGreaterThan(0);

    for (const code of codes) {
      await page.goto(`/t/${TENANT}/p/${PROJECT}/parcels/${code}?tab=visitas`);
      await expect(page.getByRole("heading", { name: code, level: 1 })).toBeVisible();
      const main = page.getByRole("main");
      // Whatever this parcel's visit history is, it never names the other technician — and never
      // shows an answer they recorded.
      await expect(main).not.toContainText(OTHER_TECHNICIAN);
    }
  });

  test("a technician never sees the coordinator's campaign totals", async ({ page }) => {
    await page.goto(FIELD);
    const main = page.getByRole("main");
    await expect(main).not.toContainText("Carga por técnico");
    await expect(main).not.toContainText("Asignadas");
    await expect(main).not.toContainText("Enviadas");
  });
});
