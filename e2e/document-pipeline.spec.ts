import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

// The `/documents` subpath deliberately: the package barrel reaches `@eia/db`, whose migrator is
// ESM, and the Playwright runner transpiles to CommonJS. These builders depend on `fflate` alone.
import { buildPdf } from "@eia/testing/documents";

import { expect, PROJECT, TENANT, test } from "./fixtures";

const run = promisify(execFile);

/**
 * The whole pipeline, in one test, with nothing stubbed (ADR-034).
 *
 * ```
 * browser upload → intent → MinIO → DocumentVersion QUEUED
 *   → worker claim → PROCESSING → READY → chunks
 *   → lexical retrieval → a citation on screen
 * ```
 *
 * ## Why the worker runs here rather than as a process
 *
 * A second Node process would have to be started, told the same database and the same store,
 * polled until it had done something, and then stopped — and every one of those steps is a place
 * for a flake that says nothing about the product. What the pipeline actually needs proving about
 * is the **topology**: that bytes a browser sent through the web application are bytes a worker,
 * using its own use-case under its own RLS context, can fetch and read.
 *
 * So this runs `tooling/scripts/extract-once.ts` as a **separate process**, which calls the exact
 * two functions `ExtractionConsumer` calls — `claimNextExtraction`, then
 * `processDocumentExtraction` — against the same database and the same MinIO the web server is
 * using. A separate process is also the only honest arrangement: the property being proved is that
 * bytes one process wrote are bytes another can read. The consumer's loop, backoff and
 * stale-release are covered by the integration suite; what is covered *here* is that the halves
 * meet.
 *
 * ## Why it needs the shared store
 *
 * `STORAGE_PROVIDER=memory` is per process. With it, the web server holds bytes no worker can see
 * — which is exactly the gap this spec exists to close (TD-100), and why `pnpm e2e` starts one
 * MinIO first. Without it the test skips and says so, rather than passing on a topology nobody has.
 */
const DOCUMENTS = `/t/${TENANT}/p/${PROJECT}/documents`;

/** A distinctive phrase, so the search assertion cannot pass on the seeded corpus. */
const NEEDLE = "termoelectricidad geotermica del canton";
const CODE = `DOC-8${String(Math.floor(Math.random() * 900) + 100)}`;
const TITLE = "Estudio con extraccion real";
const BAD_CODE = `DOC-9${String(Math.floor(Math.random() * 900) + 100)}`;

/**
 * Bytes that begin `%PDF-` and are not a PDF.
 *
 * The upload gate checks the declared type against the file's signature (ADR-031), so these get
 * stored; pdf.js then cannot read them and the version settles `FAILED`. That is the only state
 * from which the retry control is worth testing, and the honest way to reach it is to deliver a
 * file the product genuinely cannot read.
 */
const UNREADABLE_PDF = new Uint8Array([
  ...Buffer.from("%PDF-1.4\n", "latin1"),
  ...Array.from({ length: 64 }, (_, index) => (index * 7 + 3) % 256),
]);

const PDF = buildPdf([
  "El presente anexo describe la afectacion predial a lo largo del corredor vial. ".repeat(6),
  `Segunda pagina. La seccion trata de ${NEEDLE} y su relacion con el corredor. `.repeat(4),
]);

function storageConfig() {
  const path = process.env.EIA_E2E_STORAGE_CONFIG ?? "/tmp/eia-e2e-storage.json";
  try {
    return JSON.parse(readFileSync(path, "utf8")) as {
      endpoint: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
    };
  } catch {
    return null;
  }
}

/**
 * Drain the queue, in a process of its own, as a worker does.
 *
 * Draining rather than claiming once, because the queue is ordered by upload time and this suite
 * is not the only thing that puts work in it: another spec's upload, or a previous run's, would
 * otherwise be the version this one processed. A worker drains; so does this.
 */
async function drainWorker(max = 10): Promise<ReadonlyArray<string>> {
  const states: string[] = [];
  for (let turn = 0; turn < max; turn += 1) {
    const { stdout } = await run("npx", ["tsx", "tooling/scripts/extract-once.ts"], {
      cwd: process.cwd(),
      env: process.env,
    });
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!) as {
      claimed: boolean;
      state?: string;
    };
    if (!result.claimed) break;
    states.push(result.state ?? "unknown");
  }
  return states;
}

test.describe("Documents · upload, worker, citation", () => {
  test.skip(
    storageConfig() === null,
    "needs the shared MinIO: run `pnpm e2e:storage` (pnpm e2e does it for you)",
  );

  test("a file uploaded in a browser becomes a citation a reader can check", async ({ page }) => {
    // 1 · the browser uploads. Intent, PUT straight to MinIO, finalize, version, queue.
    await page.goto(DOCUMENTS);
    await page.getByRole("radio", { name: "Es un documento nuevo" }).check();
    await page.getByLabel("Código").fill(CODE);
    await page.getByLabel("Título").fill(TITLE);
    await page.getByLabel("Archivo").setInputFiles({
      name: "estudio.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(PDF),
    });
    await page.getByLabel("Procedencia").fill("Entregado por la consultora");
    await page.getByRole("button", { name: "Cargar", exact: true }).click();
    await expect(page.locator('[data-upload-outcome="ok"]')).toContainText("v1", {
      timeout: 30_000,
    });

    // 2 · the version is queued, and the surface says so. `UPLOADED` would mean the ask failed.
    await page.goto(DOCUMENTS);
    const row = page.getByRole("row", { name: new RegExp(CODE) });
    await expect(row).toContainText("En cola");

    // 3 · the worker, in its own process and its own context, fetches from the same store and
    //     reads the file. At least one version comes back `READY`, and ours is among them.
    const states = await drainWorker();
    expect(states).toContain("READY");

    // 4 · the same browser now sees a document with passages rather than an empty one.
    await page.goto(DOCUMENTS);
    const readyRow = page.getByRole("row", { name: new RegExp(CODE) });
    await expect(readyRow).toContainText("Listo");
    await expect(readyRow).toContainText("Texto extraído de un PDF");

    await page.getByRole("link", { name: CODE }).click();
    const main = page.getByRole("main");
    await expect(main).toContainText("Pasaje 1");
    // A page number from the file, not a chunk index called a page (ADR-033).
    await expect(main).toContainText("p. 1");
    await expect(main).not.toContainText("todavía no se ha procesado");

    // 5 · and the assistant finds it, citing the document, its version and its page.
    await page.goto(DOCUMENTS);
    await page.getByLabel("Pregunta al expediente").fill(NEEDLE);
    await page.getByRole("button", { name: "Consultar" }).click();
    const answer = page.getByTestId("assistant-answer");
    await expect(answer).toBeVisible({ timeout: 20_000 });
    await expect(answer).toContainText(CODE);
    // The needle is on the second page of the file, and the citation says so.
    await expect(answer.getByText(new RegExp(`${CODE} v1 · p\\. 2`))).toBeVisible();
  });

  /**
   * The retry, clicked.
   *
   * Between the extraction fix of 3 Oct 2026 and this wave, `requeueExtractionAction` and both
   * languages' copy for it existed and **no screen called either**, so a version that could not be
   * read was a dead end: the fix reached staging and could not be exercised on a real document.
   * This is the test that would have failed.
   *
   * It asserts the transition rather than the call. A spy saying the action ran would pass against
   * a button wired to nothing visible; what matters is that the page afterwards reports the state
   * the database holds — and that the control is **gone**, because `QUEUED` is not a state this
   * product offers a retry from.
   */
  test("a version that could not be read can be asked again from its page", async ({ page }) => {
    await page.goto(DOCUMENTS);
    await page.getByRole("radio", { name: "Es un documento nuevo" }).check();
    await page.getByLabel("Código").fill(BAD_CODE);
    await page.getByLabel("Título").fill("Archivo ilegible");
    await page.getByLabel("Archivo").setInputFiles({
      name: "ilegible.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(UNREADABLE_PDF),
    });
    await page.getByLabel("Procedencia").fill("Entregado por la consultora");
    await page.getByRole("button", { name: "Cargar", exact: true }).click();
    await expect(page.locator('[data-upload-outcome="ok"]')).toContainText("v1", {
      timeout: 30_000,
    });

    // The worker reads it and cannot: `FAILED`, with a bounded note and the file intact.
    expect(await drainWorker()).toContain("FAILED");

    await page.goto(`${DOCUMENTS}/${BAD_CODE}`);
    const main = page.getByRole("main");
    await expect(main).toContainText("El procesamiento no pudo completarse");

    await expect(page.getByTestId("extraction-retry-button")).toBeVisible();
    await page.getByTestId("extraction-retry-button").click();

    // The catalogue's own message, which has to **survive** the refresh the click triggers: the
    // state it produces is one that offers no retry, and an outcome that disappeared with its
    // own button would leave the person with no sign that anything happened.
    await expect(page.getByTestId("extraction-retry-ok")).toContainText("En cola para procesar", {
      timeout: 20_000,
    });
    // And the page itself now reads the database rather than the state it was rendered with.
    await expect(main).toContainText("En cola para procesar; todavía no tiene pasajes", {
      timeout: 20_000,
    });
    // The button is gone, because `QUEUED` offers no retry: the honest answer there is to wait.
    await expect(page.getByTestId("extraction-retry-button")).toHaveCount(0);

    // And the requeued version is claimable, which is what makes the button more than a message.
    expect(await drainWorker()).toContain("FAILED");
  });

  test("and the original comes back down, through a link the server minted", async ({ page }) => {
    await page.goto(`${DOCUMENTS}/${CODE}`);
    const download = page.getByRole("link", { name: "Descargar original" });
    await expect(download).toBeVisible();

    // Followed as a navigation: the page holds a route, and only the browser's own request to the
    // provider ever carries the key (ADR-034).
    const response = await page.request.get((await download.getAttribute("href"))!);
    expect(response.status()).toBe(200);
    const body = await response.body();
    expect(body.subarray(0, 4).toString()).toBe("%PDF");
  });
});
