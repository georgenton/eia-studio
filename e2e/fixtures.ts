import { expect, test, type Page } from "@playwright/test";

/**
 * Synthetic identities provisioned by `pnpm e2e:prepare`. Passwords come from the environment so
 * nothing is committed; the addresses are on a reserved invalid domain so these accounts can
 * never collide with a real one.
 */
export const TENANT = "demo-consultancy";
export const PROJECT = "puente-del-amor";

export const USERS = {
  coordinator: {
    email: "coordinadora@demo.invalid",
    name: "Coordinadora de proyecto",
    state: "e2e/.auth/coordinator.json",
  },
  admin: {
    email: "admin@demo.invalid",
    name: "Administradora del tenant",
    state: "e2e/.auth/admin.json",
  },
} as const;

export function password(): string {
  const value = process.env.DEMO_USER_PASSWORD;
  if (!value) throw new Error("DEMO_USER_PASSWORD must be set to run the e2e suite");
  return value;
}

/**
 * Sign in through the real form. Called once per role by the setup project: the identity layer
 * rate-limits sign-in attempts, and re-authenticating in every test is both slower and a worse
 * simulation of a session.
 */
export async function signIn(page: Page, user: { email: string }): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Correo institucional").fill(user.email);
  await page.getByLabel("Contraseña").fill(password());
  await page.getByRole("button", { name: "Entrar" }).click();
  // The form renders its own error in an alert; Next's route announcer also uses that role,
  // so the check is scoped to the sign-in surface.
  await expect(page.locator('main [role="alert"]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/(t\/|$)/, { timeout: 20_000 });
}

export { expect, test };
