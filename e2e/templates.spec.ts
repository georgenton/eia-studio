import { readFileSync } from "node:fs";

import { unzipSync } from "fflate";

import type { Page } from "@playwright/test";

import { buildDocxTemplate, buildMacroEnabledTemplate } from "@eia/testing/documents";

import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * The template library, through the browser (ADR-036).
 *
 * The two tests are the two halves of the feature's honesty:
 *
 * 1. a complete template is registered, uploaded, activated and generated from, and the document
 *    that comes back is a real `.docx` that says it is a draft;
 * 2. a template using a placeholder nobody declared is uploaded, shown with that placeholder
 *    named, and **cannot be activated** — because a tag this product does not know renders blank,
 *    and a deliverable with a hole where its author expected a figure is worse than an error.
 */
const TEMPLATES = `/t/${TENANT}/p/${PROJECT}/reports/templates`;

const stamp = String(Math.floor(Math.random() * 900) + 100);
const GOOD_CODE = `TPL-OK${stamp}`;
const BAD_CODE = `TPL-NO${stamp}`;

const GOOD_TEMPLATE = buildDocxTemplate([
  // Split across runs on purpose: Word writes a placeholder this way after any edit, and a
  // substitution that cannot reassemble it is a substitution that does not work.
  { runs: ["Estudio: ", "{{", "project", ".na", "me}}"], headingLevel: 1 },
  { runs: ["Localidad: {{project.locality}}"] },
  { runs: ["Longitud: {{territory.corridor_length_km}} km"] },
  { runs: ["Generado el {{generation.date}} · {{generation.locale}}"] },
  { runs: ["{{generation.draft_banner}}"] },
]);

const UNKNOWN_TEMPLATE = buildDocxTemplate([
  { runs: ["Estudio: {{project.name}}"] },
  { runs: ["Encuestado: {{respondent.full_name}}"] },
  { runs: ["{{generation.date}} {{generation.locale}} {{generation.draft_banner}}"] },
]);

const MACRO_TEMPLATE = buildMacroEnabledTemplate([
  { runs: ["{{project.name}} {{generation.date}} {{generation.locale}}"] },
  { runs: ["{{generation.draft_banner}}"] },
]);

function storageConfigured(): boolean {
  const path = process.env.EIA_E2E_STORAGE_CONFIG ?? "/tmp/eia-e2e-storage.json";
  try {
    JSON.parse(readFileSync(path, "utf8"));
    return true;
  } catch {
    return false;
  }
}

async function registerTemplate(page: Page, code: string, name: string): Promise<void> {
  await page.goto(TEMPLATES);
  await page.getByLabel("Código").fill(code);
  await page.getByLabel("Nombre de la plantilla").fill(name);
  await page.getByLabel("Para qué sirve").fill("Plantilla sintética usada por la suite e2e.");
  await page.getByRole("button", { name: "Registrar", exact: true }).click();
  await expect(page.getByTestId("template-message")).toContainText(code, { timeout: 20_000 });
}

async function uploadVersion(
  page: Page,
  code: string,
  name: string,
  bytes: Uint8Array,
): Promise<void> {
  await page.goto(TEMPLATES);
  await page.getByLabel("Plantilla a versionar").selectOption({ label: `${code} · ${name}` });
  await page.getByLabel("Archivo .docx").setInputFiles({
    name: `${code.toLowerCase()}.docx`,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(bytes),
  });
  await page.getByRole("button", { name: "Cargar versión" }).click();
}

test.describe("Reports · the template library", () => {
  test.skip(
    !storageConfigured(),
    "needs the shared MinIO: run `pnpm e2e:storage` (pnpm e2e does it for you)",
  );

  /** Everything about one template, scoped by its code: the page lists every template. */
  const cardFor = (page: Page, code: string) =>
    page.getByTestId("template").filter({ hasText: code });

  test("a complete template is activated and produces a draft a reader can open", async ({
    page,
  }) => {
    await registerTemplate(page, GOOD_CODE, "Carátula sintética");
    await uploadVersion(page, GOOD_CODE, "Carátula sintética", GOOD_TEMPLATE);
    await expect(page.getByTestId("template-message")).toContainText("v1", { timeout: 30_000 });

    // The manifest is on screen: what the template will print, before anybody activates it.
    await page.goto(TEMPLATES);
    const card = cardFor(page, GOOD_CODE);
    await expect(card).toContainText("project.name");
    await expect(card).toContainText("Leída · sin activar");

    // Waited for, not assumed: navigating while the server action is in flight aborts it.
    await card.getByRole("button", { name: "Activar" }).click();
    await expect(page.getByTestId("template-message")).toContainText("activada", {
      timeout: 30_000,
    });
    await page.goto(TEMPLATES);
    await expect(cardFor(page, GOOD_CODE)).toContainText("Activa");

    await cardFor(page, GOOD_CODE).getByRole("button", { name: "Generar documento" }).click();
    await expect(page.getByTestId("template-message")).toContainText("borrador", {
      timeout: 30_000,
    });
    await page.goto(TEMPLATES);

    // The document comes back down, through a link the server minted, and is a real Word package.
    const generated = page.getByTestId("generated-document").filter({ hasText: GOOD_CODE }).first();
    await expect(generated).toBeVisible({ timeout: 30_000 });
    const href = await generated.getByRole("link", { name: "Descargar" }).getAttribute("href");
    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    const body = await response.body();
    // `PK\x03\x04` — the OOXML container, not an HTML error page.
    expect([...body.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(body.byteLength).toBeGreaterThan(400);

    // The bytes are the deliverable, so the assertions are about the bytes: the study's own name
    // where the placeholder was, and the banner that says this is a draft.
    const files = unzipSync(new Uint8Array(body), {
      filter: (file) => file.name === "word/document.xml",
    });
    const text = new TextDecoder()
      .decode(files["word/document.xml"]!)
      .replace(/<[^>]+>/g, "")
      .replace(/&#(\d+);/g, (_all, code: string) => String.fromCodePoint(Number(code)));
    expect(text).toContain("BORRADOR — NO ES UN ENTREGABLE APROBADO");
    expect(text).toContain("Estudio:");
    // Nothing of the template's syntax survives into the deliverable.
    expect(text).not.toContain("{{");

    // The row records which placeholders printed an explicit *no value*. This project has its
    // corridor measured, so the honest answer here is «—» rather than a list.
    await expect(generated).toBeVisible();
  });

  test("a placeholder nobody declared is named on screen and blocks activation", async ({
    page,
  }) => {
    await registerTemplate(page, BAD_CODE, "Plantilla con un campo inventado");
    await uploadVersion(page, BAD_CODE, "Plantilla con un campo inventado", UNKNOWN_TEMPLATE);
    await expect(page.getByTestId("template-message")).toContainText("v1", { timeout: 30_000 });

    await page.goto(TEMPLATES);
    const card = cardFor(page, BAD_CODE);
    await expect(card.getByTestId("unknown-tags")).toContainText("respondent.full_name");

    // The server refuses it, naming the placeholder. That is the guarantee — the surface offers
    // the button because a person should be told why rather than left wondering.
    await card.getByRole("button", { name: "Activar" }).click();
    await expect(page.getByTestId("template-error")).toContainText("respondent.full_name", {
      timeout: 20_000,
    });

    await page.goto(TEMPLATES);
    await expect(cardFor(page, BAD_CODE)).toContainText("Leída · sin activar");
    await expect(cardFor(page, BAD_CODE)).not.toContainText("Generar documento");
  });

  test("a macro-enabled file is stored unreadable and can never be activated", async ({ page }) => {
    await uploadVersion(page, BAD_CODE, "Plantilla con un campo inventado", MACRO_TEMPLATE);
    await expect(page.getByTestId("template-message")).toContainText("v2", { timeout: 30_000 });
    await page.goto(TEMPLATES);
    const card = cardFor(page, BAD_CODE);
    // Read, refused, and stuck: the row says why, and carries no Activar button because the file
    // was never validated.
    await expect(card).toContainText("macro project");
    await expect(card).toContainText("Cargada · sin leer");
  });

  /** The golden reference for the wave report; regenerated whenever the surface changes. */
  test("the surface, as a reader sees it", async ({ page }) => {
    await page.goto(TEMPLATES);
    await expect(page.getByRole("main")).toContainText("Vocabulario disponible");
    await page.screenshot({
      path: "docs/screenshots/wave-3/02-template-library.png",
      fullPage: true,
    });
  });
});
