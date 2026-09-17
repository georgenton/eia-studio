import type { Page } from "@playwright/test";

import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * Uploading a delivered file, in a real browser (ADR-031).
 *
 * The properties under test are the ones a person would notice going wrong:
 *
 * - a file that is stored becomes a **version**, and the surface says it is not processed yet;
 * - the same bytes twice are **answered**, not duplicated into a second version;
 * - a file whose contents are not what its name claims never becomes a version at all.
 *
 * The third is the one that matters most and the one only an end-to-end test can show, because the
 * refusal happens on the server *after* the bytes are in the store: everything the browser did
 * succeeded, and there is still no document version. A test that stopped at the file picker would
 * only be testing the `accept` attribute, which is a convenience and not a control.
 *
 * This server runs `STORAGE_PROVIDER=memory` (playwright.config.ts), which is a real implementation
 * of the storage port and is refused outside `local` and `test`.
 */
const DOCUMENTS = `/t/${TENANT}/p/${PROJECT}/documents`;

/*
 * A code of this run's own, because a document code is unique per project and this suite writes
 * into a seeded database that a retry — or a developer running it twice — meets again. The
 * alternative is a fixed code and a test that only passes the first time, which is a test that
 * reports the database's history rather than the product's behaviour.
 */
const CODE = `DOC-9${String(Math.floor(Math.random() * 900) + 100)}`;
const TITLE = "Anexo cargado en pruebas";

/** `%PDF` is the signature the domain checks; the rest is enough to be a plausible file. */
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n");
/** Bytes that begin `MZ`: a Windows executable, whatever the name says. */
const NOT_A_PDF = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

async function fillCommonFields(page: Page, note: string) {
  await page.getByLabel("Procedencia").fill(note);
}

test.describe("Documents · uploading a delivered file", () => {
  test("a PDF becomes a new document, and says it is not processed yet", async ({ page }) => {
    await page.goto(DOCUMENTS);

    await page.getByRole("radio", { name: "Es un documento nuevo" }).check();
    await page.getByLabel("Código").fill(CODE);
    await page.getByLabel("Título").fill(TITLE);
    await page.getByLabel("Archivo").setInputFiles({
      name: "anexo.pdf",
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await fillCommonFields(page, "Archivo sintético de la suite end-to-end");
    await page.getByRole("button", { name: "Cargar", exact: true }).click();

    await expect(page.locator('[data-upload-outcome="ok"]')).toContainText("v1", {
      timeout: 30_000,
    });

    await page.goto(DOCUMENTS);
    const row = page.getByRole("row", { name: new RegExp(CODE) });
    await expect(row).toBeVisible();
    // Uploaded is not processed, and the list says which it is rather than showing an empty
    // passage count that would read as "this document says nothing".
    await expect(row).toContainText("Cargado");
    await expect(row).toContainText("Requiere revisión");

    await page.getByRole("link", { name: CODE }).click();
    const main = page.getByRole("main");
    await expect(main).toContainText("todavía no se ha procesado");
    await expect(main).toContainText("anexo.pdf");
  });

  test("the same file again is answered, not duplicated", async ({ page }) => {
    await page.goto(DOCUMENTS);

    await page.getByRole("radio", { name: "Es una versión nueva" }).check();
    await page
      .getByLabel("Documento", { exact: true })
      .selectOption({ label: `${CODE} · ${TITLE}` });
    await page.getByLabel("Archivo").setInputFiles({
      name: "anexo.pdf",
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await fillCommonFields(page, "El mismo archivo, cargado otra vez");
    await page.getByRole("button", { name: "Cargar", exact: true }).click();

    await expect(page.locator('[data-upload-outcome="ok"]')).toContainText("ya es la versión", {
      timeout: 30_000,
    });

    // And the document still has exactly one version: the count is the assertion, not the message.
    await page.goto(`${DOCUMENTS}/${CODE}`);
    await expect(page.getByRole("main")).not.toContainText("v2");
  });

  test("an executable renamed .pdf never becomes a version", async ({ page }) => {
    await page.goto(DOCUMENTS);

    await page.getByRole("radio", { name: "Es un documento nuevo" }).check();
    await page.getByLabel("Código").fill(`${CODE}-B`);
    await page.getByLabel("Título").fill("No debería existir");
    await page.getByLabel("Archivo").setInputFiles({
      name: "instalador.pdf",
      mimeType: "application/pdf",
      buffer: NOT_A_PDF,
    });
    await fillCommonFields(page, "Bytes que no son un PDF");
    await page.getByRole("button", { name: "Cargar", exact: true }).click();

    await expect(page.locator('[data-upload-outcome="error"]')).toBeVisible({ timeout: 30_000 });

    // The browser's upload succeeded; the refusal is the server reading the stored bytes. What
    // must not exist is the document.
    await page.goto(DOCUMENTS);
    await expect(page.getByRole("link", { name: `${CODE}-B` })).toHaveCount(0);
  });

  test("a format the product does not accept is refused before a URL exists", async ({ page }) => {
    await page.goto(DOCUMENTS);

    await page.getByRole("radio", { name: "Es un documento nuevo" }).check();
    await page.getByLabel("Código").fill(`${CODE}-C`);
    await page.getByLabel("Título").fill("Tampoco debería existir");
    await page.getByLabel("Archivo").setInputFiles({
      name: "notas.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("texto suelto"),
    });
    await fillCommonFields(page, "Un formato que no se acepta");
    await page.getByRole("button", { name: "Cargar", exact: true }).click();

    await expect(page.locator('[data-upload-outcome="error"]')).toBeVisible({ timeout: 30_000 });
    await page.goto(DOCUMENTS);
    await expect(page.getByRole("link", { name: `${CODE}-C` })).toHaveCount(0);
  });

  test("a code this project already uses is refused, and says what to do instead", async ({
    page,
  }) => {
    await page.goto(DOCUMENTS);

    await page.getByRole("radio", { name: "Es un documento nuevo" }).check();
    await page.getByLabel("Código").fill(CODE);
    await page.getByLabel("Título").fill("Un segundo documento con el mismo código");
    await page.getByLabel("Archivo").setInputFiles({
      name: "otro.pdf",
      mimeType: "application/pdf",
      // Different bytes, so nothing here turns on the same-content answer.
      buffer: Buffer.concat([PDF, Buffer.from("otro")]),
    });
    await fillCommonFields(page, "Mismo código, otro archivo");
    await page.getByRole("button", { name: "Cargar", exact: true }).click();

    // A sentence somebody can act on, not a constraint violation. Two documents with one code
    // would make every citation naming it ambiguous.
    await expect(page.locator('[data-upload-outcome="error"]')).toContainText(CODE, {
      timeout: 30_000,
    });
  });
});
