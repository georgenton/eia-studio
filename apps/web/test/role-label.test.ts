import { PROJECT_ROLES, TENANT_ROLES } from "@eia/domain";
import { createTranslator, LOCALES } from "@eia/i18n";
import { describe, expect, it } from "vitest";

import { roleLabel } from "../lib/role-label";

/**
 * *A stored value is never rendered; a label for it is* (ADR-025).
 *
 * The denial state used to interpolate `PermissionDenied.role` straight into the sentence, so a
 * *Gestor de información* was told «Tu rol PROJECT_DATA_MANAGER no incluye…» — English, in
 * SCREAMING_SNAKE_CASE, on a screen a consultant reads. Observed on staging on 19 November 2026.
 *
 * `e2e/vocabulary.spec.ts` fails on that shape, but only on the pages it visits, and no scenario
 * there provokes a denial on a project surface. These assertions do not depend on reaching a page:
 * they hold over **every** role the model has, in **every** locale, so a role added later cannot
 * slip through with its enum name showing.
 */
const SCREAMING_SNAKE = /^[A-Z][A-Z0-9_]*$/;

describe("roleLabel", () => {
  for (const locale of LOCALES) {
    const t = createTranslator(locale);

    it(`gives every project role a readable name in ${locale}`, () => {
      for (const role of PROJECT_ROLES) {
        const label = roleLabel(t, role);
        expect(label, role).not.toBe(role);
        expect(SCREAMING_SNAKE.test(label), `${role} → ${label}`).toBe(false);
        expect(label.length, role).toBeGreaterThan(2);
      }
    });

    it(`gives every tenant role a readable name in ${locale}`, () => {
      for (const role of TENANT_ROLES) {
        const label = roleLabel(t, role);
        expect(label, role).not.toBe(role);
        expect(SCREAMING_SNAKE.test(label), `${role} → ${label}`).toBe(false);
      }
    });

    it(`falls back to the generic phrase rather than echoing an unknown value in ${locale}`, () => {
      const generic = t("systemState.currentRole");
      expect(roleLabel(t, null)).toBe(generic);
      // A role name from a newer build, or a column somebody tampered with. Either way the reader
      // gets a sentence, not an identifier.
      expect(roleLabel(t, "SUPER_COORDINATOR")).toBe(generic);
      expect(roleLabel(t, "")).toBe(generic);
    });
  }

  it("prefers the project role's words when a name exists in both scopes", () => {
    const t = createTranslator("es-EC");
    // The scopes share no name today; the ordering is asserted anyway, because the day one is
    // added the denial must say what the reader is *on this project*.
    for (const role of PROJECT_ROLES) {
      expect(roleLabel(t, role)).toBe(t(`vocabulary.projectRole.${role}`));
    }
  });
});
