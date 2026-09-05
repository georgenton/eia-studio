import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * The Quality Gate as a coordinator sees it: run the check, read what it found, and be unable to
 * settle it.
 *
 * The split is the assertion. A coordinator holds `quality.write` — they run the rules — and not
 * `quality.review`, so the decision form is not on their page. Deciding is what a reviewer is for
 * (`quality-review.spec.ts`).
 */
test.describe.configure({ mode: "serial" });

test.describe("Quality Gate · the coordinator's journey", () => {
  test("the surface says what it checks, not only what it found", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}/quality`);
    const main = page.getByRole("main");

    // A gate that lists nothing must be distinguishable from one that never ran.
    await expect(main.getByText("Reglas vigentes")).toBeVisible();
    // The rules by name and version. The catalogue key is traceability and lives on the finding,
    // not in the list a specialist reads to know what was checked.
    await expect(main).toContainText("Número de predios afectados");
    await expect(main).toContainText("Identificación del proyecto en el expediente");
    await expect(main).toContainText("Área de aplicación del plan frente a la cartografía");

    // The product's position, in words, on the page.
    await expect(main).toContainText("No determina cuál de las dos es correcta");
  });

  test("running the check produces the corpus's known discrepancies", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}/quality`);
    await page.getByRole("button", { name: "Ejecutar revisión" }).click();
    await expect(page.getByRole("status")).toContainText("Revisión ejecutada", { timeout: 20_000 });

    // Four findings, and the fifth rule stays quiet — its inputs agree in this project.
    const rows = page.getByRole("row").filter({ hasText: /^QG-/ });
    await expect(rows).toHaveCount(4);
    await expect(page.getByRole("link", { name: "QG-001" })).toBeVisible();
  });

  test("re-running updates rather than duplicating", async ({ page }) => {
    // The property the whole module rests on: a second run must not turn one real disagreement
    // into two rows, because that is how a specialist's decision gets quietly abandoned.
    await page.goto(`/t/${TENANT}/p/${PROJECT}/quality`);
    await page.getByRole("button", { name: "Ejecutar revisión" }).click();
    await expect(page.getByRole("status")).toContainText("0 hallazgo(s) nuevo(s)", {
      timeout: 20_000,
    });
    await expect(page.getByRole("row").filter({ hasText: /^QG-/ })).toHaveCount(4);
  });

  test("a finding shows both sources at equal weight, and neither as the error", async ({
    page,
  }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}/quality`);
    await page.getByRole("link", { name: "QG-001" }).click();
    const main = page.getByRole("main");

    await expect(main.getByText("Fuente A")).toBeVisible();
    await expect(main.getByText("Fuente B")).toBeVisible();
    await expect(main).toContainText("71 predios con afectación");
    await expect(main).toContainText("70 predios con afectación");

    // Invariant 11: no compliance conclusion, anywhere on the page.
    const body = (await main.textContent()) ?? "";
    for (const forbidden of ["incumplimiento", "infracción", "error detectado", "no conforme"]) {
      expect(body.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  test("the evidence links to the ingested passage it was transcribed from", async ({ page }) => {
    // Slice 6 enrichment (ADR-020 §6): the finding was raised before the documents existed and was
    // never rewritten. The reference resolves through the assertion at read time, so it appeared
    // the moment the excerpt was ingested.
    await page.goto(`/t/${TENANT}/p/${PROJECT}/quality/QG-002`);
    const main = page.getByRole("main");
    await expect(main).toContainText("Transcrito de");
    const link = main.getByRole("link", { name: /DOC-\d+ v\d/ }).first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/documents\/DOC-/);
    await expect(page.getByRole("main")).toContainText("Pasaje");
  });

  test("the interdisciplinary finding says so, and the temporal one is not called a fault", async ({
    page,
  }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}/quality/QG-004`);
    await expect(page.getByRole("main")).toContainText("Revisión interdisciplinaria");

    await page.goto(`/t/${TENANT}/p/${PROJECT}/quality/QG-003`);
    await expect(page.getByRole("main")).toContainText("no supone por sí misma un problema");
  });

  test("a coordinator may run the check and may not settle a finding", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}/quality/QG-001`);
    await expect(page.getByRole("main")).toContainText("decidirlos corresponde a un revisor");
    await expect(page.getByRole("button", { name: "Registrar decisión" })).toHaveCount(0);
  });

  test("a finding code that means nothing answers 404, like one in another project would", async ({
    page,
  }) => {
    const missing = await page.goto(`/t/${TENANT}/p/${PROJECT}/quality/QG-999`);
    expect(missing?.status()).toBe(404);
  });
});
