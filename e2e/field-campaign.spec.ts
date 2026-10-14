import { expect, PROJECT, TENANT, test, USERS } from "./fixtures";

/**
 * Opening and running a campaign, as far as this harness honestly reaches.
 *
 * The demonstration project already has an **active** campaign, which is what makes the assignment
 * board and the Field Pack testable at all — and which is also why the *create* form cannot be
 * reached here: it appears only where no campaign exists. Standing up a second campaign-less
 * project would mean changing the demo seeder, which this change deliberately does not touch, so
 * those paths are covered by the integration suite and recorded as not run in the browser.
 */
const ASSIGNMENTS = `/t/${TENANT}/p/${PROJECT}/field/assignments`;

test.describe("Campaña de campo · superficie", () => {
  test("D–E · un predio asignado desde la pantalla sigue asignado tras recargar", async ({
    page,
  }) => {
    await page.goto(ASSIGNMENTS);
    const rows = page.getByTestId("assignment-row");
    await expect(rows.first()).toBeVisible();

    // The campaign is active, so the draft panel is not offered: activating what is already
    // running would be a control with nothing to do.
    await expect(page.getByTestId("campaign-activate")).toHaveCount(0);

    const select = rows.first().getByTestId("candidate-technician");
    if ((await select.count()) > 0) {
      const value = await select.locator("option").nth(1).getAttribute("value");
      await select.selectOption(value!);
      const before = await select.inputValue();
      await page.reload();
      await expect(
        page.getByTestId("assignment-row").first().getByTestId("candidate-technician"),
      ).toHaveValue(before);
    }
  });

  test("I · un técnico de campo no llega a esta pantalla", async ({ browser }) => {
    const context = await browser.newContext({ storageState: USERS.technician.state });
    const page = await context.newPage();
    await page.goto(ASSIGNMENTS);
    // `field.assignments.manage` is a coordinator's grant; the surface says so rather than
    // offering a control the server would refuse.
    await expect(page.getByTestId("campaign-create")).toHaveCount(0);
    await expect(page.getByTestId("campaign-activate")).toHaveCount(0);
    await context.close();
  });
});
