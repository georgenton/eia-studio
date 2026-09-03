import { signIn, test as setup, USERS } from "./fixtures";

/**
 * Authenticate once per role and store the session. Every spec then starts already signed in,
 * which keeps the suite fast and stays inside the identity layer's sign-in rate limit.
 */
setup("authenticate as the project coordinator", async ({ page }) => {
  await signIn(page, USERS.coordinator);
  await page.context().storageState({ path: USERS.coordinator.state });
});

setup("authenticate as the tenant administrator", async ({ page }) => {
  await signIn(page, USERS.admin);
  await page.context().storageState({ path: USERS.admin.state });
});

setup("authenticate as the field technician", async ({ page }) => {
  await signIn(page, USERS.technician);
  await page.context().storageState({ path: USERS.technician.state });
});

setup("authenticate as the second field technician", async ({ page }) => {
  await signIn(page, USERS.technicianTwo);
  await page.context().storageState({ path: USERS.technicianTwo.state });
});

setup("authenticate as the social specialist", async ({ page }) => {
  await signIn(page, USERS.specialist);
  await page.context().storageState({ path: USERS.specialist.state });
});

setup("authenticate as the quality reviewer", async ({ page }) => {
  await signIn(page, USERS.reviewer);
  await page.context().storageState({ path: USERS.reviewer.state });
});
