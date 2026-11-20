import { isProjectRole, isTenantRole } from "@eia/domain";
import type { Translator } from "@eia/i18n";

/**
 * The role a reader is told they hold, in words.
 *
 * `PermissionDenied` carries the authorization model's own name for the role — `COORDINATOR`,
 * `PROJECT_DATA_MANAGER` — because that is what the domain checks (`core/authz.ts`). It is not
 * what anybody should read. Until this function existed the denial said *«Tu rol
 * PROJECT_DATA_MANAGER no incluye las respuestas individuales de campo»*: English, in
 * SCREAMING_SNAKE_CASE, on a screen, which is exactly what ADR-025's boundary forbids — *a stored
 * value is never rendered; a label for it is*. Observed on staging on 19 November 2026.
 *
 * It lives in its own module rather than beside the state renderers so it can be unit-tested
 * without rendering a server component.
 *
 * Project role first, because `requirePermission` prefers it when a context has both. A value that
 * is neither is a role this build does not know — a column read from a database written by a newer
 * version, say — and the reader gets the generic phrase rather than a raw identifier.
 */
export function roleLabel(t: Translator, role: string | null): string {
  if (role === null) return t("systemState.currentRole");
  if (isProjectRole(role)) return t(`vocabulary.projectRole.${role}`);
  if (isTenantRole(role)) return t(`vocabulary.tenantRole.${role}`);
  return t("systemState.currentRole");
}
