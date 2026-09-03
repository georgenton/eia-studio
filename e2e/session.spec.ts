import { expect, PROJECT, signIn, TENANT, test, USERS } from "./fixtures";

/**
 * UX-001: signing out has to be findable.
 *
 * The manual review could not find it, and therefore could not move between the synthetic
 * identities the demo roles live on — which made two thirds of the product unreviewable. The
 * control is the account disclosure in the topbar, and this spec is the proof it stays there.
 *
 * It runs in the project with no stored session, and signs in for itself: signing out revokes the
 * session on the server, so doing it with a shared `storageState` would end every later test in
 * that project.
 */
test.describe("session control in the topbar", () => {
  test("a signed-in user can find their identity, open it and sign out", async ({ page }) => {
    await signIn(page, USERS.coordinator);
    await page.goto(`/t/${TENANT}/p/${PROJECT}`);

    // Findable by what it is, not by where it is: an account control named after the user.
    const account = page.getByRole("group", { name: `Cuenta de ${USERS.coordinator.name}` });
    await expect(account).toBeVisible();

    // Closed, the action is not reachable — a menu, not a permanently exposed button.
    const signOut = page.getByRole("button", { name: "Cerrar sesión" });
    await expect(signOut).toBeHidden();

    await account.locator("summary").click();
    await expect(signOut).toBeVisible();
    await expect(page.getByText(USERS.coordinator.email)).toBeVisible();

    // No role switcher: changing role means changing identity, and the menu says so rather than
    // offering a control that would either lie about the session or change privileges from a
    // browser.
    await expect(page.getByText(/cierra sesión e inicia con la identidad/i)).toBeVisible();

    await signOut.click();
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("after signing out the workspace is gone, including for the Back button", async ({
    page,
  }) => {
    await signIn(page, USERS.specialist);
    await page.goto(`/t/${TENANT}/p/${PROJECT}/social`);
    await page
      .getByRole("group", { name: `Cuenta de ${USERS.specialist.name}` })
      .locator("summary")
      .click();
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page).toHaveURL(/\/sign-in/);

    // The session is revoked server-side, so the route re-authenticates rather than serving a
    // cached shell.
    await page.goto(`/t/${TENANT}/p/${PROJECT}/social`);
    await expect(page).toHaveURL(/\/sign-in/);

    await page.goBack();
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
