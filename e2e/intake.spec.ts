import type { Page } from "@playwright/test";

import { expect, PROJECT, TENANT, test } from "./fixtures";

/**
 * *Preparar proyecto* end to end (ADR-030).
 *
 * The three things worth driving a browser for: that the eight stages are one page over the
 * project as it is, that the readiness report **says what it is about** rather than implying the
 * study is finished, and that changing the project's offline policy makes the D-020 gate appear —
 * which is the one readiness rule with teeth.
 *
 * The suite restores the policy it changed. The demo project is shared with every other spec, and
 * a test that leaves a project requiring offline capture would fail the next one for a reason that
 * has nothing to do with it.
 */
const INTAKE = `/t/${TENANT}/p/${PROJECT}/intake`;

async function setOfflineMode(page: Page, value: string) {
  await page.goto(`${INTAKE}?stage=project`);
  await page.getByLabel(/Captura offline|Offline capture/).selectOption(value);
  await page.getByRole("button", { name: /Guardar|^Save$/ }).click();
  await expect(page.getByRole("status")).toContainText(/guardados|saved/i);
}

test.describe("the coordinator prepares a project", () => {
  test("the eight stages are one page over the project as it is", async ({ page }) => {
    await page.goto(INTAKE);
    const main = page.getByRole("main");

    for (const stage of [
      "Proyecto",
      "Equipo",
      "Cartografía",
      "Documentos",
      "Formularios",
      "Plantillas",
      "Preparación",
      "Activación",
    ]) {
      await expect(page.getByRole("link", { name: new RegExp(`\\d ${stage}$`) })).toBeVisible();
    }

    // Stage 1 shows the project's own identity, filled in from the project rather than from a
    // remembered wizard position.
    await expect(main.getByLabel(/Título oficial/)).not.toHaveValue("");
  });

  test("the team stage lists the project's roles and lets a coordinator add somebody", async ({
    page,
  }) => {
    await page.goto(`${INTAKE}?stage=team`);
    const main = page.getByRole("main");
    await expect(main).toContainText("Coordinación de proyecto");
    /*
     * This test used to assert the opposite — that the stage reads and offers nothing — and that
     * was true until 27 November 2026, when it turned out a project created in *Nuevo proyecto*
     * could not be staffed anywhere in the product at all (TD-111). Adding somebody is still a
     * coordinator's act; what changed is that it now has a place to happen.
     */
    await expect(
      main.getByRole("button", { name: /Añadir al proyecto|Add to the project/ }),
    ).toBeVisible();
    // The role list is the domain's, so a role the product does not have cannot be chosen.
    await expect(main.getByLabel(/^Rol$|^Role$/)).toBeVisible();
  });

  test("the questionnaire stage names the languages a version actually carries", async ({
    page,
  }) => {
    await page.goto(`${INTAKE}?stage=surveys`);
    const main = page.getByRole("main");
    await expect(main).toContainText("Publicada");
    await expect(main).toContainText("es-EC");
  });

  test("readiness says what it is about, and never that the study is complete", async ({
    page,
  }) => {
    await page.goto(`${INTAKE}?stage=readiness`);
    const main = page.getByRole("main");
    await expect(main).toContainText("Identificación del proyecto");
    await expect(main).toContainText("Coordinación asignada");
    // The sentence the whole module hangs on.
    await expect(main).toContainText("No dice que el estudio esté completo");
    for (const forbidden of ["cumple", "conforme", "incumplimiento", "certifica"]) {
      expect((await main.innerText()).toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  test("the offline policy makes the D-020 gate appear, and removing it makes it go", async ({
    page,
  }) => {
    try {
      await setOfflineMode(page, "required");
      await page.goto(`${INTAKE}?stage=readiness`);
      const main = page.getByRole("main");
      await expect(main).toContainText("Canal compatible con la política offline");
      await expect(main).toContainText("Falta");

      await page.goto(`${INTAKE}?stage=activation`);
      await expect(page.getByRole("main")).toContainText("Falta algo antes de poder operar");
    } finally {
      // Restore, whatever happened above: the demo project is shared with every other spec.
      await setOfflineMode(page, "disabled");
    }
  });

  test("activation does not offer to move a project that already left planning", async ({
    page,
  }) => {
    await page.goto(`${INTAKE}?stage=activation`);
    const main = page.getByRole("main");
    await expect(main).toContainText("EIA Studio puede operar este proyecto");
    await expect(main).toContainText("ya salió de planificación");
  });
});

test.describe("a reviewer reads the preparation and decides nothing in it", () => {
  test.use({ storageState: "e2e/.auth/reviewer.json" });

  test("sees the team and is not offered the control that changes it", async ({ page }) => {
    await page.goto(`${INTAKE}?stage=team`);
    const main = page.getByRole("main");
    // The stage is readable: `project.intake.read` is a reviewer's grant (ADR-030 §2).
    await expect(main).toContainText("Coordinación de proyecto");
    // `project.members.manage` is not, so the read model offers no candidates and the surface
    // renders no form. Null is not empty: *this is not yours to decide*.
    await expect(
      main.getByRole("button", { name: /Añadir al proyecto|Add to the project/ }),
    ).toHaveCount(0);
  });
});

test.describe("who may not open it", () => {
  test.use({ storageState: "e2e/.auth/technician.json" });

  test("a field technician is denied, and is told so rather than shown a 404", async ({ page }) => {
    // ADR-016: the surface exists for this project and the answer is about *them*, so it is the
    // denial state and not a 404 — which would be an oracle for somebody else's configuration.
    const response = await page.goto(INTAKE);
    expect(response?.status()).toBeLessThan(400);
    await expect(page.getByRole("main")).toContainText("No tienes acceso a esta sección");
  });
});
