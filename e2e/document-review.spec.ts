import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

// The `/documents` subpath deliberately: the package barrel reaches `@eia/db`, whose migrator is
// ESM, and the Playwright runner transpiles to CommonJS.
import { buildPdf } from "@eia/testing/documents";

import type { Page } from "@playwright/test";

import { expect, PROJECT, TENANT, test } from "./fixtures";

const run = promisify(execFile);

/**
 * AI document review, end to end, with a real database and a separate worker process (ADR-035).
 *
 * ```
 * browser uploads two files declared free of personal data → extraction → passages
 *   → browser asks for a review of a lens over those two documents
 *   → a separate process claims the run, retrieves, calls the deterministic reviewer
 *   → candidates on screen, headed "Candidato generado por IA"
 *   → a reviewer accepts one, with a justification that is kept
 * ```
 *
 * The **second** test is the one this feature exists to get right: a run whose corpus includes a
 * document nobody has classified is refused **in full**, and the surface names that document. The
 * tempting implementation — review the rest and report success — would make "no candidates in
 * DOC-x" mean "DOC-x was never read", with nothing on screen saying so.
 *
 * The reviewer is `DOCUMENT_REVIEWER=fake`, selected explicitly by the Playwright web server's
 * environment. It is refused outside `local` and `test` (IG4-001), and the run records that it
 * answered, so nothing here could later be mistaken for a model's output.
 */
const DOCUMENTS = `/t/${TENANT}/p/${PROJECT}/documents`;
const REVIEW = `${DOCUMENTS}/review`;

const stamp = String(Math.floor(Math.random() * 900) + 100);
const CLEAR_A = `DOC-6${stamp}`;
const CLEAR_B = `DOC-7${stamp}`;
const UNCLASSIFIED = `DOC-9${stamp}`;

const filler = "El presente anexo describe la afectacion predial del corredor vial. ".repeat(5);

const PDF_A = buildPdf([
  `${filler} El expediente registra 70 predios afectados por el trazado en total.`,
  `${filler} La fecha de levantamiento de informacion consta en el cronograma entregado.`,
]);
const PDF_B = buildPdf([
  `${filler} El anexo de afectaciones enumera 71 predios frentistas al corredor vial.`,
  `${filler} La fecha de la asamblea de socializacion difiere del cronograma citado.`,
]);
const PDF_C = buildPdf([`${filler} Capitulo entregado sin clasificar todavia.`]);

function storageConfig() {
  const path = process.env.EIA_E2E_STORAGE_CONFIG ?? "/tmp/eia-e2e-storage.json";
  try {
    return JSON.parse(readFileSync(path, "utf8")) as { bucket: string };
  } catch {
    return null;
  }
}

/** Drain the extraction queue, in a process of its own, as a worker does (ADR-034). */
async function drainExtraction(max = 10): Promise<void> {
  for (let turn = 0; turn < max; turn += 1) {
    const { stdout } = await run("npx", ["tsx", "tooling/scripts/extract-once.ts"], {
      cwd: process.cwd(),
      env: process.env,
    });
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!) as { claimed: boolean };
    if (!result.claimed) break;
  }
}

/** Drain the review queue the same way, and report what each run produced. */
async function drainReviews(
  max = 5,
): Promise<ReadonlyArray<{ status: string; candidates: number }>> {
  const outcomes: Array<{ status: string; candidates: number }> = [];
  for (let turn = 0; turn < max; turn += 1) {
    const { stdout } = await run("npx", ["tsx", "tooling/scripts/review-once.ts"], {
      cwd: process.cwd(),
      env: process.env,
    });
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!) as {
      claimed: boolean;
      status?: string;
      candidates?: number;
    };
    if (!result.claimed) break;
    outcomes.push({ status: result.status ?? "unknown", candidates: result.candidates ?? 0 });
  }
  return outcomes;
}

async function uploadDocument(
  page: Page,
  code: string,
  bytes: Uint8Array,
  privacy: string,
): Promise<void> {
  await page.goto(DOCUMENTS);
  await page.getByRole("radio", { name: "Es un documento nuevo" }).check();
  await page.getByLabel("Código").fill(code);
  await page.getByLabel("Título").fill(`Estudio ${code}`);
  await page.getByLabel("Tipo").selectOption("report");
  await page.getByLabel("Datos personales").selectOption(privacy);
  await page.getByLabel("Archivo").setInputFiles({
    name: `${code.toLowerCase()}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes),
  });
  await page.getByLabel("Procedencia").fill("Entregado por la consultora");
  await page.getByRole("button", { name: "Cargar", exact: true }).click();
  await expect(page.locator('[data-upload-outcome="ok"]')).toContainText("v1", {
    timeout: 30_000,
  });
}

test.describe("Documents · AI review", () => {
  test.skip(
    storageConfig() === null,
    "needs the shared MinIO: run `pnpm e2e:storage` (pnpm e2e does it for you)",
  );

  test("a model proposes, a specialist decides, and both are preserved", async ({ page }) => {
    await uploadDocument(page, CLEAR_A, PDF_A, "NO_PERSONAL_DATA_KNOWN");
    await uploadDocument(page, CLEAR_B, PDF_B, "NO_PERSONAL_DATA_KNOWN");
    await drainExtraction();

    await page.goto(REVIEW);
    const main = page.getByRole("main");
    // The distinction from the Quality Gate is on the page, not implied by where it lives.
    await expect(main).toContainText("Revisión asistida");
    await expect(main).toContainText("Control de consistencia");

    // Only the two documents this test uploaded: the seeded corpus is `REVIEW_REQUIRED`, which
    // the next test is about.
    for (const code of [CLEAR_A, CLEAR_B, UNCLASSIFIED]) {
      const box = page.getByRole("checkbox", { name: new RegExp(code) });
      if (await box.count()) await box.setChecked([CLEAR_A, CLEAR_B].includes(code));
    }
    for (const other of await page.getByRole("checkbox").all()) {
      const label = await other.evaluate((node) => node.closest("label")?.textContent ?? "");
      if (!label.includes(CLEAR_A) && !label.includes(CLEAR_B)) await other.setChecked(false);
    }

    await page.getByLabel("Enfoque de la revisión").selectOption("numerical_consistency");
    await page.getByRole("button", { name: "Iniciar revisión" }).click();
    await expect(page.getByTestId("review-started")).toBeVisible({ timeout: 20_000 });

    // The worker, in its own process: the run is claimed, the passages retrieved, the reviewer
    // called, and the candidates written.
    const outcomes = await drainReviews();
    expect(outcomes.some((outcome) => outcome.status === "COMPLETED")).toBe(true);

    await page.goto(REVIEW);
    const candidate = page.getByTestId("ai-candidate").first();
    await expect(candidate).toBeVisible();
    // The words that must never drift: a candidate, generated by AI, proposed and not detected.
    await expect(candidate).toContainText("Candidato generado por IA");
    await expect(candidate).toContainText("Propuesto por IA");
    await expect(candidate).not.toContainText("Error detectado");
    // Its code cannot be mistaken for a quality finding's.
    await expect(candidate).toContainText(/IA-\d{3}/);
    // And it cites passages of the project's own documents, quoted.
    await expect(candidate).toContainText("Fuente A");
    await expect(candidate).toContainText(new RegExp(`${CLEAR_A}|${CLEAR_B}`));

    // The coordinator ran the review and is **not** offered a decision: checking and deciding are
    // different grants, exactly as in the Quality Gate (TENANCY.md §3.3).
    await expect(candidate.getByRole("button", { name: "Registrar decisión" })).toHaveCount(0);
  });

  test("a reviewer settles a candidate, and both halves are kept", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "e2e/.auth/reviewer.json" });
    const page = await context.newPage();
    try {
      await page.goto(REVIEW);
      const candidate = page.getByTestId("ai-candidate").first();
      await expect(candidate).toBeVisible();
      await expect(candidate).toContainText("Candidato generado por IA");
      // A reviewer does not run reviews, so the runner is not on their page at all.
      await expect(page.getByRole("button", { name: "Iniciar revisión" })).toHaveCount(0);

      await candidate
        .getByLabel("Justificación")
        .fill("Contrastado con el anexo: la diferencia entre los dos conteos es real.");
      await candidate.getByRole("button", { name: "Registrar decisión" }).click();

      await expect(page.getByTestId("ai-candidate").first()).toContainText(
        /Aceptado por especialista|Descartado por especialista/,
        { timeout: 20_000 },
      );
      // The model's words and the person's reason, side by side and both permanent.
      await expect(page.getByRole("main")).toContainText("Contrastado con el anexo");
    } finally {
      await context.close();
    }
  });

  /** The golden reference for the wave report; regenerated whenever the surface changes. */
  test("the surface, as a reader sees it", async ({ page }) => {
    await page.goto(REVIEW);
    await expect(page.getByTestId("ai-candidate").first()).toBeVisible();
    await page.screenshot({
      path: "docs/screenshots/wave-3/01-document-review.png",
      fullPage: true,
    });
  });

  test("a corpus with an unclassified document is refused in full, and says which one", async ({
    page,
  }) => {
    await uploadDocument(page, UNCLASSIFIED, PDF_C, "REVIEW_REQUIRED");
    await drainExtraction();

    await page.goto(REVIEW);
    // Check the unclassified document deliberately. It starts unchecked *and visible*, with its
    // classification beside it — a default a person can change, never a silent filter.
    const box = page.getByRole("checkbox", { name: new RegExp(UNCLASSIFIED) });
    await box.setChecked(true);
    await page.getByRole("button", { name: "Iniciar revisión" }).click();

    const refused = page.getByTestId("review-refused");
    await expect(refused).toBeVisible({ timeout: 20_000 });
    await expect(refused).toContainText(UNCLASSIFIED);
    // The reason, in the reader's words: which classification made this document ineligible.
    await expect(refused).toContainText("pendiente de revisión");

    // And nothing was queued: a refused run must not exist, or the history would show the study
    // as having been reviewed.
    const outcomes = await drainReviews();
    expect(outcomes).toHaveLength(0);
  });
});
