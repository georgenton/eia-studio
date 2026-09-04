import type { Page } from "@playwright/test";

import { PARCEL_CODE_PATTERN, expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * The technician journey, on a phone, with a synthetic location.
 *
 * This is the acceptance path of Slice 3: My Work → assignment → visit → survey → draft → reload →
 * submit → read-only. It runs at a mobile viewport because that is the device this surface is
 * designed for, and with a fixed synthetic geolocation on the reconstructed corridor — a point that
 * is deliberately nobody's home.
 */
const FIELD = `/t/${TENANT}/p/${PROJECT}/field`;

/**
 * Choose an option the way a technician does: press the row.
 *
 * Each control is wrapped in its `<label>`, which is what makes the whole row a comfortable touch
 * target. Clicking the 20 px input directly is not how the surface is used, and Playwright rightly
 * refuses it while the label covers it — so the test presses the label and then asserts the radio
 * actually became checked.
 */
async function choose(page: Page, label: string) {
  await page.getByText(label, { exact: true }).click();
  await expect(page.getByRole("radio", { name: label })).toBeChecked();
}

/**
 * Open an assignment that still needs work, and make sure a visit is open on it.
 *
 * Written to be re-runnable: the suite mutates the same seeded campaign, so a second run finds
 * the first assignment already in progress or submitted. Asserting on a pristine fixture would
 * make this pass once and then fail for a reason that has nothing to do with the product.
 */
async function openAssignmentWithVisit(page: Page) {
  await page.goto(FIELD);
  const card = page
    .getByRole("link")
    .filter({ hasText: /Iniciar visita|Continuar/ })
    .first();
  await expect(card).toBeVisible();
  const code = (await card.locator("span").first().innerText()).trim();
  await card.click();
  await expect(page).toHaveURL(/\/field\/assignments\//);

  const start = page.getByRole("button", { name: "Iniciar visita" });
  if ((await start.count()) > 0) {
    await start.click();
  }
  // Either way the visit exists now, and its outcome is *stated* — captured, refused or
  // unavailable. Which one it is depends on what the device did, and the mobile suite
  // deliberately refuses the permission on one assignment, so asserting "captured" here would be
  // asserting the order the specs happen to run in.
  await expect(
    page
      .getByRole("main")
      .getByText(/Ubicación (capturada|no disponible|no solicitada)|Permiso de ubicación denegado/),
  ).toBeVisible({ timeout: 20_000 });
  return code;
}

test.describe("FieldFlow · technician", () => {
  test("My Work shows only this technician's assignments", async ({ page }) => {
    await page.goto(FIELD);
    await expect(page.getByRole("heading", { name: "Mi trabajo", level: 1 })).toBeVisible();

    // The technician sees no campaign totals, no workload table and no other technician: the
    // surface is their work, not a narrow coordinator dashboard.
    const main = page.getByRole("main");
    await expect(main).not.toContainText("Carga por técnico");
    await expect(main).not.toContainText("Técnico de campo 2");
    await expect(main).not.toContainText("Campaña de campo — demostración");

    const cards = page.getByRole("link").filter({ hasText: PARCEL_CODE_PATTERN });
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    // The fixture gives technician 2 every third parcel, so this must be fewer than the campaign.
    expect(count).toBeLessThan(12);
  });

  test("the whole capture path: visit, draft, reload, submit, read-only", async ({ page }) => {
    const code = await openAssignmentWithVisit(page);
    const main = page.getByRole("main");

    // 1 · parcel context, by code and position — never an owner's name.
    await expect(page.getByRole("heading", { level: 1 })).toContainText(code);
    await expect(main).toContainText("ABS");

    // 2 · the visit states what happened with the location, and never invents a coordinate.
    await expect(
      main.getByText(
        /Ubicación (capturada|no disponible|no solicitada)|Permiso de ubicación denegado/,
      ),
    ).toBeVisible();

    // 3 · the questionnaire is the campaign's published version, named on screen.
    await expect(main).toContainText("v1");
    await expect(page.getByRole("radio", { name: "Arrendatario/a" })).toBeVisible();

    // 4 · answer a closed choice, a boolean and the open text.
    await choose(page, "Arrendatario/a");
    await choose(page, "Comercio o servicios");
    const concernText = "Consulta por el acceso al predio durante la obra.";
    // Named by its own label, so it can be addressed the way a reader hears it.
    await page
      .getByRole("textbox", { name: /descríbalo en sus propias palabras/ })
      .fill(concernText);

    // 5 · save a draft. Required answers are deliberately still incomplete.
    await page.getByRole("button", { name: "Guardar borrador" }).click();
    await expect(page.getByText("Borrador guardado.")).toBeVisible();

    // 6 · a reload must bring the draft back from the database, not from component state.
    await page.reload();
    await expect(page.getByRole("radio", { name: "Arrendatario/a" })).toBeChecked();
    await expect(
      page.getByRole("textbox", { name: /descríbalo en sus propias palabras/ }),
    ).toHaveValue(concernText);

    // 7 · submitting without the remaining required answer fails, in place, with a field message.
    await page.getByRole("button", { name: "Enviar ficha" }).click();
    await expect(page.getByText("Esta pregunta es obligatoria.").first()).toBeVisible();

    // 8 · complete it and submit for real.
    await choose(page, "Sí");
    await page.getByRole("button", { name: "Enviar ficha" }).click();

    // 9 · submitted is read-only for the technician: no edit action, and the form says why.
    await expect(main.getByText(/fue enviada y ya no puede editarse/)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: "Enviar ficha" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Guardar borrador" })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "Arrendatario/a" })).toBeDisabled();

    // 10 · and the assignment reflects it back on My Work.
    await page.getByRole("link", { name: "Volver a mi trabajo" }).click();
    const card = page.getByRole("link").filter({ hasText: code }).first();
    await expect(card).toContainText("Completada");
    await expect(card).toContainText("Ver ficha enviada");
  });

  test("submitting twice is safe: the second attempt changes nothing", async ({ page }) => {
    await page.goto(FIELD);
    const done = page.getByRole("link").filter({ hasText: "Ver ficha enviada" }).first();
    await expect(done).toBeVisible();
    await done.click();

    // A submitted response offers no mutation at all — the guard is server-side, and the UI
    // simply has nothing to press.
    await expect(page.getByRole("button", { name: "Enviar ficha" })).toHaveCount(0);
    await expect(page.getByRole("main").getByText(/ya no puede editarse/)).toBeVisible();
  });
});
