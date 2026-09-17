import { expect, TENANT, test } from "./fixtures";

/**
 * Writing a questionnaire inside the product (ADR-037).
 *
 * The blocker this closes is narrow and total: until this wave a `SurveyVersion` could only be
 * created by the demonstration seeder, which made every one of eight studies a developer task. So
 * this spec uses **no seeder, no fixture and no SQL** — it creates a project, writes a
 * questionnaire in *Preparar proyecto · Formularios*, publishes it, and then checks the one thing
 * that must never be offered afterwards: an edit.
 *
 * It works on its own project rather than on the pilot, because publishing a questionnaire into the
 * pilot would change what every other spec's counts and tabulations are about.
 */
const stamp = String(Math.floor(Math.random() * 900) + 100);
const SLUG = `instrumento-${stamp}`;
const NAME = `Proyecto de instrumento ${stamp}`;
const TEMPLATE_KEY = `ficha_prueba_${stamp}`;
const TEMPLATE_NAME = `Ficha de prueba ${stamp}`;

test.describe("A questionnaire written in the product", () => {
  test.describe.configure({ mode: "serial" });

  test("a project is created to hold it", async ({ page }) => {
    await page.goto(`/t/${TENANT}`);
    await page.getByLabel("Nombre del proyecto").fill(NAME);
    await page.getByLabel("Identificador en la URL").fill(SLUG);
    await page.getByLabel("Perfil").selectOption({ index: 0 });
    await page.getByRole("button", { name: "Crear proyecto" }).click();
    await page.waitForURL(new RegExp(`/p/${SLUG}/intake`), { timeout: 30_000 });
  });

  test("the Formularios stage is where a questionnaire comes from", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${SLUG}/intake?stage=surveys`);
    const main = page.getByRole("main");

    // The stage says what it is for, and no longer that authoring arrives in a later phase.
    await expect(main).toContainText("Nuevo cuestionario");
    await expect(main).not.toContainText("fase posterior");

    await main.getByLabel("Clave").fill(TEMPLATE_KEY);
    await main.getByLabel("Nombre del cuestionario").fill(TEMPLATE_NAME);
    await main.getByLabel("Para qué es").fill("El instrumento de esta prueba.");
    await main.getByRole("button", { name: "Crear cuestionario" }).click();

    // Creating the questionnaire opens its first draft, which is the only thing to do next.
    await page.waitForURL(/version=/, { timeout: 30_000 });
    await expect(main).toContainText("Borrador v1");
  });

  test("a question is written in both languages and saved", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${SLUG}/intake?stage=surveys`);
    const main = page.getByRole("main");
    await main.getByRole("link", { name: "Editar" }).first().click();
    await expect(main).toContainText("Borrador v1");

    await main.getByRole("button", { name: "Añadir pregunta" }).click();
    await main.getByLabel("Encabezado", { exact: true }).fill("Percepción");
    await main.getByLabel("Código", { exact: true }).fill("has_concern");
    await main.getByLabel("Tipo").selectOption("BOOLEAN");
    await main.getByLabel("Español (definición) · Enunciado").fill("¿Tiene alguna preocupación?");
    await main.getByLabel("Inglés · Enunciado").fill("Do you have any concern?");
    await main.getByLabel("Inglés · Encabezado").fill("Perception");

    await main.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(main).toContainText("Cambios guardados.");

    // The preview reads the form the way the phone groups it: a heading, then its run of questions.
    await expect(main).toContainText("Percepción");
    await expect(main).toContainText("¿Tiene alguna preocupación?");
  });

  test("publishing is announced as final before it happens, and then is", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${SLUG}/intake?stage=surveys`);
    const main = page.getByRole("main");
    await main.getByRole("link", { name: "Editar" }).first().click();

    // Said before the button rather than in a dialog afterwards: the moment it is useful is before.
    await expect(main).toContainText("queda fija");
    await main.getByRole("button", { name: "Publicar esta versión" }).click();
    await expect(main).toContainText("Versión v1 publicada");

    await page.goto(`/t/${TENANT}/p/${SLUG}/intake?stage=surveys`);
    await expect(main).toContainText("Publicada");
    // What must no longer be on offer. A published questionnaire is read, and copied, never edited.
    await expect(main.getByRole("link", { name: "Editar" })).toHaveCount(0);
    await expect(main.getByRole("link", { name: "Ver como se lee" })).toHaveCount(1);
  });

  /** The golden reference for the wave report; regenerated whenever the surface changes. */
  test("the surface, as a reader sees it", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${SLUG}/intake?stage=surveys`);
    const main = page.getByRole("main");
    await main.getByRole("link", { name: "Ver como se lee" }).first().click();
    // A published version is headed *Publicada*, never *Borrador*: the header is the one line on
    // this page somebody would quote back.
    await expect(main).toContainText("Publicada v1");
    await expect(main).not.toContainText("Borrador v1");
    await expect(main).toContainText("¿Tiene alguna preocupación?");
    await page.screenshot({
      path: "docs/screenshots/go-live-a/01-survey-authoring.png",
      fullPage: true,
    });
  });

  test("a correction is a new version, and the published one keeps its words", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${SLUG}/intake?stage=surveys`);
    const main = page.getByRole("main");
    await main.getByRole("button", { name: "Nueva versión a partir de v1" }).click();
    await page.waitForURL(/version=/, { timeout: 30_000 });

    await expect(main).toContainText("Borrador v2");
    // The copy carries the questionnaire it came from, words, heading and all.
    await expect(main).toContainText("¿Tiene alguna preocupación?");

    await page.goto(`/t/${TENANT}/p/${SLUG}/intake?stage=surveys`);
    await expect(main).toContainText("v1");
    await expect(main).toContainText("v2");
  });
});
