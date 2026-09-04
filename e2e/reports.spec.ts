import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * Report generation, as a coordinator sees it.
 *
 * The property under test throughout is ADR-022: **the snapshot is the deliverable**. No model is
 * configured in CI (or anywhere, TD-049), so every version here has no prose — and is still a
 * complete, traceable, downloadable chapter draft. That is the design, not a degraded mode.
 */
const REPORTS = `/t/${TENANT}/p/${PROJECT}/reports`;

test.describe.configure({ mode: "serial" });

test.describe("Reports · the coordinator's journey", () => {
  test("the surface says what a version is before there is one", async ({ page }) => {
    await page.goto(REPORTS);
    const main = page.getByRole("main");
    await expect(main).toContainText("Borrador, no entregable");
    await expect(main).toContainText("Una versión no se edita");
    // Invariant 11 reaches here too: a chapter never declares compliance.
    const body = (await main.textContent()) ?? "";
    for (const forbidden of ["incumplimiento", "infracción", "no conforme"]) {
      expect(body.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  test("generating produces a version built from validated data", async ({ page }) => {
    await page.goto(REPORTS);
    await page.getByRole("button", { name: "Generar versión" }).click();
    await expect(page.getByRole("status")).toContainText("generada", { timeout: 30_000 });
    await expect(page.getByRole("link", { name: /^v\d+$/ }).first()).toBeVisible();
  });

  test("every figure names where it came from", async ({ page }) => {
    await page.goto(REPORTS);
    await page.getByRole("link", { name: "v1", exact: true }).click();
    const main = page.getByRole("main");

    await expect(main).toContainText("Universo y cobertura");
    await expect(main).toContainText("Fichas enviadas");
    // The traceability that makes the chapter checkable: a source line under each figure.
    await expect(main.getByText(/Cálculo determinista/).first()).toBeVisible();
    await expect(main.getByText(/Registro de procedencia/).first()).toBeVisible();
  });

  test("a theme figure with nothing validated says so rather than counting proposals", async ({
    page,
  }) => {
    // The demo project has proposals only after a specialist run, and none are validated by this
    // point in the suite. The section must say nothing has been validated (ADR-019, ADR-022 §5).
    await page.goto(`${REPORTS}/v1`);
    const main = page.getByRole("main");
    await expect(main).toContainText("Temas validados");
    await expect(main).toContainText("codificaciones validadas");
  });

  test("regenerating makes a new version and keeps every earlier one", async ({ page }) => {
    // Counted rather than named: this file may run after another spec has already generated, and
    // the property under test is "one more, none lost" rather than any particular label.
    await page.goto(REPORTS);
    const before = await page.getByRole("link", { name: /^v\d+$/ }).count();
    await page.getByRole("button", { name: "Generar versión" }).click();
    await expect(page.getByRole("status")).toContainText("generada", { timeout: 30_000 });
    await expect(page.getByRole("link", { name: /^v\d+$/ })).toHaveCount(before + 1);

    // The first one says it is superseded, and still shows what it showed.
    await page.goto(`${REPORTS}/v1`);
    await expect(page.getByRole("main")).toContainText("Esta es una versión anterior");
  });

  test("the .docx downloads, is a real Word file, and is marked a draft", async ({ page }) => {
    const response = await page.request.get(`${REPORTS}/v1/docx`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("wordprocessingml.document");
    expect(response.headers()["content-disposition"]).toContain("borrador");

    const body = await response.body();
    expect(body.byteLength).toBeGreaterThan(1000);
    // A .docx is a zip. The magic bytes are the cheapest proof it is one rather than an error page.
    expect(body.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  test("a version label that means nothing answers 404, and so does its download", async ({
    page,
  }) => {
    const missing = await page.goto(`${REPORTS}/v999`);
    expect(missing?.status()).toBe(404);
    const download = await page.request.get(`${REPORTS}/v999/docx`, { failOnStatusCode: false });
    expect(download.status()).toBe(404);
  });
});
