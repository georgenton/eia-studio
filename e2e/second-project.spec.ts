import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * Study #2, through the product path a consulting firm will actually take (Wave 3).
 *
 * The pilot was seeded by a developer running a script. Eight studies cannot be, so this spec
 * exercises the path instead: **create the project on the Portfolio, prepare it in *Preparar
 * proyecto*, and read the readiness report** — with no seeder, no fixture and no SQL.
 *
 * The second half is the one that matters more. With two projects alive in the same tenant, every
 * surface must answer for the project in the URL and for no other: the pilot's corridor length, its
 * 141 parcels, its documents, its findings and its templates are **its**, and a brand-new project
 * must show its own emptiness rather than somebody else's numbers.
 *
 * The project is deliberately **not** a copy of the pilot: a different corridor, a different
 * province, a different programme, no cartography, no campaign, no corpus. Cloning Zamora would
 * prove that the seeder runs twice, which is not the question.
 */
const stamp = String(Math.floor(Math.random() * 900) + 100);
const SLUG = `via-del-oriente-${stamp}`;
const NAME = `Vía del Oriente ${stamp}`;
const OFFICIAL_TITLE = `Estudio de impacto ambiental y social · Vía del Oriente ${stamp}`;
const PROGRAMME = `PRUEBA-${stamp}`;
const LOCALITY = "Cantón de prueba, Provincia de prueba";

/** Figures that belong to the pilot and to nothing else. */
const PILOT_ONLY = ["141", "119", "7,4"];

test.describe("A second project, prepared through the product", () => {
  test.describe.configure({ mode: "serial" });

  test("an owner creates it from the Portfolio and lands in Preparar proyecto", async ({
    page,
  }) => {
    await page.goto(`/t/${TENANT}`);
    await expect(page.getByRole("main")).toContainText("Nuevo proyecto");

    await page.getByLabel("Nombre del proyecto").fill(NAME);
    await page.getByLabel("Identificador en la URL").fill(SLUG);
    await page.getByLabel("Perfil").selectOption({ index: 0 });
    await page.getByRole("button", { name: "Crear proyecto" }).click();

    // Creating a project and preparing it are one act for the person doing it.
    await page.waitForURL(new RegExp(`/p/${SLUG}/intake`), { timeout: 30_000 });
    // The intake's own form, which only this surface has.
    await expect(page.getByLabel("Título oficial del estudio")).toBeVisible({ timeout: 30_000 });
  });

  test("its readiness report is about this project, and starts honest", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${SLUG}/intake`);
    const main = page.getByRole("main");

    // A project with nothing loaded says so. It does not borrow the pilot's figures to look ready.
    for (const figure of PILOT_ONLY) {
      await expect(main.getByText(figure, { exact: true })).toHaveCount(0);
    }
    await expect(main).not.toContainText("Puente del Amor");
  });

  test("the study's own identity is filled in and kept", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${SLUG}/intake`);

    await page.getByLabel("Título oficial del estudio").fill(OFFICIAL_TITLE);
    await page.getByLabel("Programa / referencia").fill(PROGRAMME);
    await page.getByLabel("Ubicación").fill(LOCALITY);
    await page.getByRole("button", { name: "Guardar" }).first().click();

    await page.goto(`/t/${TENANT}/p/${SLUG}/intake`);
    await expect(page.getByLabel("Título oficial del estudio")).toHaveValue(OFFICIAL_TITLE);
    await expect(page.getByLabel("Programa / referencia")).toHaveValue(PROGRAMME);
    // The words are the firm's own and are stored verbatim, never generated and never translated.
    await expect(page.getByLabel("Ubicación")).toHaveValue(LOCALITY);
    await expect(page.getByLabel("Nombre corto")).toHaveValue(NAME);
  });

  test("every surface of the new project is empty rather than borrowed", async ({ page }) => {
    const surfaces = ["", "/gis", "/field", "/social", "/quality", "/documents", "/reports"];
    for (const surface of surfaces) {
      await page.goto(`/t/${TENANT}/p/${SLUG}${surface}`);
      const main = page.getByRole("main");
      await expect(main).not.toContainText("Puente del Amor");
      for (const figure of PILOT_ONLY) {
        await expect(
          main.getByText(figure, { exact: true }),
          `${surface || "/"} must not show the pilot's ${figure}`,
        ).toHaveCount(0);
      }
    }
  });

  test("and the pilot is unchanged by any of it", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);
    const main = page.getByRole("main");
    await expect(main).toContainText("Puente del Amor");
    // The new project's identity never appears in the pilot's workspace.
    await expect(main).not.toContainText(NAME);
    await expect(main).not.toContainText(PROGRAMME);
  });

  test("the breadcrumb and the switcher name the project in the URL, always", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${SLUG}/documents`);
    await expect(page.locator("body")).toContainText(NAME);
    await page.goto(`/t/${TENANT}/p/${PROJECT}/documents`);
    await expect(page.locator("body")).toContainText("Puente del Amor");
  });
});
