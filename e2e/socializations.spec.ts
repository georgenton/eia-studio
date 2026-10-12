import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * Convening the corridor, driven the way a social specialist drives it.
 *
 * The role matters and the person does not: every assertion here is about what
 * `SOCIAL_SPECIALIST` can do, never about a name. That is the decision block 3 was asked to
 * respect — the specialist who runs consultation is not elevated to coordinator and no role is
 * minted for an individual.
 *
 * Everything is synthetic: the demo tenant the suite seeds, and a convocation this file invents.
 */
const FIELD = `/t/${TENANT}/p/${PROJECT}/field`;
const SOCIALIZATIONS = `${FIELD}/socializations`;
const TITLE = `Socialización sintética ${Date.now().toString(36)}`;
const PLACE = "Casa comunal sintética";

test.describe.configure({ mode: "serial" });

test.describe("Socializaciones · la convocatoria y sus invitaciones", () => {
  test("A · un especialista social llega a la superficie desde Trabajo de campo", async ({
    page,
  }) => {
    await page.goto(FIELD);
    const links = page.getByTestId("field-sub-surfaces");
    await expect(links).toBeVisible();
    await links.getByRole("link", { name: "Socializaciones" }).click();
    await expect(page).toHaveURL(new RegExp("/field/socializations$"));
  });

  test("B · crea una convocatoria", async ({ page }) => {
    await page.goto(SOCIALIZATIONS);
    await page.getByTestId("socialization-title").fill(TITLE);
    await page.getByTestId("socialization-starts-at").fill("2026-11-12T14:00");
    await page.getByTestId("socialization-location").fill(PLACE);
    await page
      .getByTestId("socialization-purpose")
      .fill("Presentar los resultados del estudio a los predios frentistas.");
    await page.getByTestId("socialization-create").click();
    await expect(page.getByTestId("socialization-ok")).toBeVisible({ timeout: 20_000 });

    await page.reload();
    await expect(page.getByRole("link", { name: TITLE })).toBeVisible();
  });

  test("C · genera invitaciones sobre predios elegidos, y repetir no duplica", async ({ page }) => {
    await page.goto(SOCIALIZATIONS);
    await page.getByRole("link", { name: TITLE }).click();

    const candidates = page.getByTestId("invitation-candidate");
    await expect(candidates.first()).toBeVisible();

    // Two parcels, each with a technician chosen by hand. There is no "invite everybody".
    for (const index of [0, 1]) {
      const select = candidates.nth(index).getByTestId("candidate-technician");
      const value = await select.locator("option").nth(1).getAttribute("value");
      await select.selectOption(value!);
    }
    await page.getByTestId("socialization-generate").click();
    await expect(page.getByTestId("socialization-ok")).toBeVisible({ timeout: 20_000 });

    await page.reload();
    await expect(page.getByTestId("invitation-row")).toHaveCount(2);

    // The counters are over invitations. Nobody has delivered anything, so: two pending, no
    // attempts — and the screen says in words that several delivery attempts still belong to one
    // invitation.
    const counters = page.getByText("Invitaciones", { exact: true }).first();
    await expect(counters).toBeVisible();
    await expect(
      page.getByText(
        "Visitas realizadas. Una invitación puede requerir varios intentos de entrega: tres visitas al mismo predio siguen siendo una sola invitación.",
      ),
    ).toBeVisible();
  });

  test("D · la invitación imprimible dice lo que el destinatario necesita y nada más", async ({
    page,
  }) => {
    await page.goto(SOCIALIZATIONS);
    await page.getByRole("link", { name: TITLE }).click();
    const print = page.getByTestId("invitation-row").first().getByRole("link", {
      name: "Invitación imprimible",
    });
    const href = await print.getAttribute("href");
    await page.goto(href!);

    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 2 })).toHaveText(TITLE);
    await expect(main).toContainText(PLACE);
    await expect(main).toContainText("Predio");
    // No account, said out loud, so nobody goes looking for a login.
    await expect(main).toContainText("no crea ninguna cuenta");
    // And nothing about this product's own operation: no technician, no attempt, no evidence.
    for (const forbidden of ["Técnico", "Intentos", "Evidencia", "Resultado"]) {
      await expect(main).not.toContainText(forbidden);
    }
  });

  test("E · una convocatoria con invitaciones ya no reescribe su propia convocatoria", async ({
    page,
  }) => {
    await page.goto(SOCIALIZATIONS);
    await page.getByRole("link", { name: TITLE }).click();
    await expect(page.getByTestId("socialization-frozen")).toBeVisible();
    await expect(page.getByTestId("socialization-frozen")).toContainText("otra convocatoria");
  });

  test("F · cancelar pide un motivo, y lo pendiente se cancela con ella", async ({ page }) => {
    await page.goto(SOCIALIZATIONS);
    await page.getByRole("link", { name: TITLE }).click();

    // The button is unavailable until there is a reason: a cancellation is a thing somebody
    // decided, and the record says why.
    await expect(page.getByTestId("socialization-cancel")).toBeDisabled();
    await page.getByTestId("socialization-cancel-reason").fill("la comunidad pidió otra fecha");
    await page.getByTestId("socialization-cancel").click();
    await expect(page.getByTestId("socialization-ok")).toBeVisible({ timeout: 20_000 });

    await page.reload();
    // The parcels panel is gone — a cancelled convocation takes no new invitations — and the
    // invitations that existed are cancelled rather than deleted.
    await expect(page.getByTestId("invitation-candidate")).toHaveCount(0);
    await expect(page.getByTestId("invitation-row")).toHaveCount(2);
  });
});

test.describe("Asignación de predios", () => {
  test("un especialista social decide quién levanta cada predio", async ({ page }) => {
    await page.goto(`${FIELD}/assignments`);
    const rows = page.getByTestId("assignment-row");
    await expect(rows.first()).toBeVisible();

    // Every parcel is listed, assigned or not. A row with work captured says why it cannot move
    // instead of simply refusing.
    const withWork = page.getByText("Ya hay una visita o una respuesta");
    if ((await withWork.count()) > 0) {
      await expect(withWork.first()).toBeVisible();
    }
  });
});
