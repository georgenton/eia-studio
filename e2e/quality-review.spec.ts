import { expect, PROJECT, TENANT, test } from "./fixtures";
import { ensureFindings, ensureOpen } from "./quality-runner";

/**
 * Settling a finding, as the reviewer.
 *
 * Depends on the coordinator's project having run the check, so the findings exist. The three
 * properties asserted here are the ones a study depends on: a decision needs a reason, the reason
 * is kept and attributed, and a decision the state machine forbids cannot be taken at all.
 */
test.describe.configure({ mode: "serial" });

test.describe("Quality Gate · the reviewer settles a finding", () => {
  // The findings must exist, and QG-003 must be settle-able: a previous run of this suite left its
  // own decisions behind, because that is what "permanent" means.
  // Once, not per test: the tests below are a deliberate sequence — dismiss, then observe what the
  // state machine no longer offers, then change your mind. Normalising before each of them would
  // erase the very chain they are asserting.
  test.beforeAll(async ({ browser }) => {
    const coordinator = await browser.newPage({ storageState: "e2e/.auth/coordinator.json" });
    await ensureFindings(coordinator);
    await coordinator.close();

    const reviewer = await browser.newPage({ storageState: "e2e/.auth/reviewer.json" });
    await ensureOpen(reviewer, "QG-003");
    await reviewer.close();
  });

  test("a decision requires a justification before it can be submitted", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}/quality/QG-003`);
    const submit = page.getByRole("button", { name: "Registrar decisión" });
    await expect(submit).toBeDisabled();

    await page.getByLabel("Justificación").fill("corto");
    await expect(submit).toBeDisabled();

    await page.getByLabel("Justificación").fill("Se reprogramó por lluvias; consta en el acta.");
    await expect(submit).toBeEnabled();
  });

  test("the decision is recorded with its reason, attributed and permanent", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}/quality/QG-003`);
    await page.getByLabel("Decisión").selectOption("DISMISS");
    await page
      .getByLabel("Justificación")
      .fill(
        "La reprogramación consta en el acta y en la convocatoria; las fuentes son coherentes.",
      );
    await page.getByRole("button", { name: "Registrar decisión" }).click();

    await expect(page.getByRole("status")).toContainText("OPEN → DISMISSED", { timeout: 20_000 });

    await page.reload();
    const main = page.getByRole("main");
    await expect(main).toContainText("Historial de decisiones");
    await expect(main).toContainText("La reprogramación consta en el acta");
    await expect(main).toContainText("Revisora de calidad");
  });

  test("a decision the state does not allow is not even offered", async ({ page }) => {
    // QG-003 is DISMISSED after the previous test. Resolving it would be writing a history that
    // never happened, so the option is absent from the form and refused by the server.
    await page.goto(`/t/${TENANT}/p/${PROJECT}/quality/QG-003`);
    const options = await page.getByLabel("Decisión").locator("option").allTextContents();
    expect(options.join(" ")).not.toContain("Marcar como resuelto");
    expect(options.join(" ")).toContain("Reabrir");
  });

  test("a change of mind is a new decision, not an edit of the old one", async ({ page }) => {
    await page.goto(`/t/${TENANT}/p/${PROJECT}/quality/QG-003`);
    await page.getByLabel("Decisión").selectOption("REOPEN");
    await page
      .getByLabel("Justificación")
      .fill("El acta que se citó corresponde a otra asamblea; vuelve a revisión.");
    await page.getByRole("button", { name: "Registrar decisión" }).click();
    await expect(page.getByRole("status")).toContainText("DISMISSED → OPEN", { timeout: 20_000 });

    await page.reload();
    const main = page.getByRole("main");
    // Both decisions are on the page. The first was not overwritten.
    await expect(main).toContainText("La reprogramación consta en el acta");
    await expect(main).toContainText("corresponde a otra asamblea");
  });

  test("the full lifecycle a real finding takes", async ({ page }) => {
    // QG-002 rather than QG-003: this test walks a finding all the way to RESOLVED, and the
    // earlier tests in this file need one they can dismiss and reopen.
    await ensureOpen(page, "QG-002");
    await page.goto(`/t/${TENANT}/p/${PROJECT}/quality/QG-002`);
    for (const [decision, reason, expected] of [
      [
        "START_REVIEW",
        "Tomo el contraste entre el anexo y el informe social.",
        "OPEN → UNDER_REVIEW",
      ],
      [
        "ACCEPT",
        "Confirmado: las dos cifras del expediente no coinciden.",
        "UNDER_REVIEW → ACCEPTED",
      ],
      [
        "RESOLVE",
        "El anexo se corrigió a 70 en su nueva versión; queda unificado.",
        "ACCEPTED → RESOLVED",
      ],
    ] as const) {
      await page.getByLabel("Decisión").selectOption(decision);
      await page.getByLabel("Justificación").fill(reason);
      await page.getByRole("button", { name: "Registrar decisión" }).click();
      await expect(page.getByRole("status")).toContainText(expected, { timeout: 20_000 });
      await page.reload();
    }
    await expect(page.getByRole("main")).toContainText("Resuelto");
  });
});
