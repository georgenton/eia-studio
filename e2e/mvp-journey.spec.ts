import { PARCELS, expect, PROJECT, TENANT, test } from "./fixtures";
import { ensureFindings } from "./quality-runner";

/**
 * The whole product, in the order the demo is walked (`docs/manual/10-demo-walkthrough.md` §1).
 *
 * Every slice already has a spec that proves its own surface. None of them proves the thing a
 * reviewer will actually experience: that the surfaces are **one product** — that the rail carries
 * tenant and project from screen to screen, that a selection made on a map survives into a
 * workspace, that a finding raised before documents existed now links to the passage it was
 * transcribed from, and that a chapter generated at the end counts what the earlier screens
 * validated and nothing else.
 *
 * So this is a hand-off test, not a feature test. It asserts the seams, lightly but for real, and
 * leaves each surface's own guarantees to the spec that owns them. It is also the regression guard
 * for the walkthrough document: if a step here changes, that page is wrong.
 */
test.describe.configure({ mode: "serial" });

const HOME = `/t/${TENANT}/p/${PROJECT}`;

test.describe("MVP · the coordinator's walkthrough, end to end", () => {
  test("the shell carries tenant and project across every surface", async ({ page }) => {
    await page.goto(`/t/${TENANT}`);
    await page.getByRole("link", { name: "Abrir el centro de control" }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${TENANT}/p/${PROJECT}$`));

    const rail = page.getByRole("navigation", { name: "Navegación principal" });
    const destinations = [
      "Cartografía y predios",
      "Trabajo de campo",
      "Análisis social",
      "Control de consistencia",
      "Documentos",
      "Plan de Manejo",
      "Informes",
    ];
    const crumbs = page.getByRole("navigation", { name: "Ruta de navegación" });
    // The Command Center's breadcrumb names the project the way a person would.
    await expect(crumbs).toContainText("Vía Puente del Amor");

    for (const name of destinations) {
      await rail.getByRole("link", { name }).click();
      // Invariant 1: the tenant and the project are in the URL and on the screen, everywhere.
      await expect(page).toHaveURL(new RegExp(`/t/${TENANT}/p/${PROJECT}/`));
      await expect(page.getByLabel("Organización")).toHaveValue(TENANT);
      await expect(page.getByLabel("Proyecto activo")).toHaveValue(PROJECT);
      // …and it names it the *same* way on every surface. Six of them used to show the URL slug
      // instead, which reads as a different project on every screen but one.
      await expect(crumbs, name).toContainText("Vía Puente del Amor");
      await expect(crumbs, name).not.toContainText(PROJECT);
    }
  });

  test("the workspace says which study it is, in the words of the file", async ({ page }) => {
    await page.goto(HOME);
    const main = page.getByRole("main");
    // The study's own title and the programme it belongs to, from the project record — not the
    // short name the team uses in conversation, and not a string in a component.
    await expect(main).toContainText("Actualización de Estudios Socioambientales");
    await expect(main).toContainText("Puente del Amor");
    await expect(main).toContainText("EC-L1289");
  });

  test("Command Center → GIS → a parcel: the selection is one selection", async ({ page }) => {
    await page.goto(`${HOME}/gis`);
    const table = page.getByRole("table", { name: /Predios/ });
    const row = table
      .getByRole("row")
      .filter({ has: page.getByRole("link", { name: `Abrir ${PARCELS.a}`, exact: true }) });
    await row.getByRole("button", { name: /Seleccionar/ }).click();

    // Invariant 6: map, table and panel share one selection — the panel is the observable half.
    await expect(page.getByRole("complementary")).toContainText(PARCELS.a);

    await page.getByRole("complementary").getByRole("link", { name: /Abrir/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/parcels/${PARCELS.a}`));
    await expect(page.getByRole("main")).toContainText(PARCELS.a);
  });

  test("FieldFlow shows what arrived, and offers no way to change it", async ({ page }) => {
    await page.goto(`${HOME}/field`);
    const main = page.getByRole("main");
    await expect(main).toContainText(/Campaña|campaña/);
    // Invariant 9, as the demo states it: an answer is immutable, so nothing here edits one.
    await expect(main.getByRole("button", { name: /Editar respuesta/ })).toHaveCount(0);
  });

  test("Social states its denominators, and offers a coordinator no run button", async ({
    page,
  }) => {
    await page.goto(`${HOME}/social`);
    const main = page.getByRole("main");
    await expect(main).toContainText(/sobre/);
    // TENANCY §3.2: a coordinator watches, a specialist decides. The button is a specialist's.
    await expect(
      main.getByRole("button", { name: /Clasificar|Ejecutar clasificación/ }),
    ).toHaveCount(0);
  });

  test("the Quality Gate finds real inconsistencies and never calls one an error", async ({
    page,
  }) => {
    await ensureFindings(page);
    await page.goto(`${HOME}/quality`);
    await expect(page.getByRole("link", { name: "QG-001" })).toBeVisible();
    const main = page.getByRole("main");
    // Invariant 11, on the surface a reviewer reads.
    for (const forbidden of ["incumplimiento", "infracción", "no conforme", "error detectado"]) {
      await expect(main).not.toContainText(forbidden, { ignoreCase: true });
    }
    // A coordinator checks; a reviewer decides. No decision form here.
    await expect(main.getByRole("button", { name: /Aceptar hallazgo|Descartar/ })).toHaveCount(0);
  });

  test("a finding raised before the corpus existed now links into it", async ({ page }) => {
    await ensureFindings(page);
    await page.goto(`${HOME}/quality`);
    await page.getByRole("link", { name: "QG-001" }).click();
    const main = page.getByRole("main");
    const passage = main.getByRole("link", { name: /DOC-\d+/ }).first();
    await expect(passage).toBeVisible();

    // ADR-020 §6 delivered literally: the link resolves at read time, so the finding itself was
    // never rewritten. Following it must land on the document the evidence names.
    const href = await passage.getAttribute("href");
    expect(href).toMatch(/\/documents\/DOC-\d+/);
    await passage.click();
    await expect(page).toHaveURL(/\/documents\/DOC-\d+/);
    await expect(page.getByRole("main")).toContainText(/DOC-\d+/);
  });

  test("the assistant answers with passages, and says what kind of search found them", async ({
    page,
  }) => {
    await page.goto(`${HOME}/documents`);
    await page.getByLabel("Pregunta al expediente").fill("predios con afectación");
    await page.getByRole("button", { name: "Consultar" }).click();
    const main = page.getByRole("main");
    await expect(main).toContainText(/DOC-\d+/, { timeout: 20_000 });
    // ADR-021: the surface says the retrieval is lexical rather than semantic, in words.
    await expect(main).toContainText(/léxic|literal/i);
  });

  test("the chapter counts what the earlier screens validated, and says so", async ({ page }) => {
    await page.goto(`${HOME}/reports`);
    if ((await page.getByRole("link", { name: "v1", exact: true }).count()) === 0) {
      await page.getByRole("button", { name: "Generar versión" }).click();
      await expect(page.getByRole("status")).toContainText("generada", { timeout: 30_000 });
    }
    await page.getByRole("link", { name: "v1", exact: true }).click();
    const main = page.getByRole("main");

    // The five sections of the social chapter, each present.
    for (const title of [
      "Universo y cobertura",
      "Resultados de las preguntas cerradas",
      "Temas validados de las respuestas abiertas",
      "Revisión de calidad del expediente",
      "Fuentes y procedencia",
    ]) {
      await expect(main).toContainText(title);
    }
    // ADR-022: it is a draft and says so, and it never states a compliance conclusion.
    await expect(main).toContainText(/BORRADOR|borrador/);
    for (const forbidden of ["incumplimiento", "no conforme"]) {
      await expect(main).not.toContainText(forbidden, { ignoreCase: true });
    }
  });

  test("and the session can be ended from the topbar, which is where a person looks", async ({
    page,
  }) => {
    // UX-001. `session.spec.ts` owns the full behaviour, including the sign-out itself; this only
    // asserts the control is reachable on the walkthrough's own path, because a demo that cannot
    // be handed to the next person is not a demo. It deliberately does not click sign out: this
    // project shares one stored session with the specs that follow.
    await page.goto(HOME);
    const account = page.getByRole("group", { name: /^Cuenta de / });
    await expect(account).toBeVisible();
    await account.locator("summary").click();
    await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  });
});
