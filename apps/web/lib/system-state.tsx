import { SystemState } from "@eia/ui";
import { ButtonLink } from "@/components/navigation";
import { getTranslator } from "@/lib/locale";

/**
 * The 15 system states are produced by the server as typed outcomes (ARCHITECTURE.md §11).
 * These renderers hold the approved copy so it is identical wherever a state occurs.
 *
 * They are **server** components, and deliberately so: a denial is frequently rendered *outside*
 * the workspace shell — before a context exists, on a tenant the caller is not a member of — where
 * there is no locale provider to read from. Resolving the request's locale directly means the
 * state speaks the reader's language wherever it occurs, including the places the shell never
 * reaches. They carry no interactivity, so nothing is lost by it.
 */
export async function PermissionDeniedState({
  role,
  restrictedData,
  backHref,
}: {
  role: string | null;
  restrictedData: string;
  backHref: string;
}) {
  const t = await getTranslator();
  return (
    <SystemState state="permission denied" title={t("systemState.permissionDeniedTitle")}>
      <p>
        {t("systemState.permissionDeniedBody", {
          role: role ?? t("systemState.currentRole"),
          restricted: restrictedData,
        })}{" "}
        {t("systemState.permissionDeniedBody2")}
      </p>
      <p>
        <ButtonLink href={backHref}>{t("common.back")}</ButtonLink>
      </p>
    </SystemState>
  );
}

/**
 * A module the project *is* entitled to whose surface this slice has not built (ADR-016).
 * It is deliberately inert: no module data, no actions, and no claim that the workflow exists.
 * It is also deliberately distinct from a capability the project does not have, which answers
 * 404 and never reaches this component.
 */
export async function ModuleNotImplementedState({
  label,
  capabilityKey,
  plannedIn,
  backHref,
}: {
  label: string;
  capabilityKey: string;
  plannedIn: string | null;
  backHref: string;
}) {
  const t = await getTranslator();
  return (
    <SystemState
      state="module not implemented"
      title={t("systemState.notImplementedTitleWith", { label })}
      meta={capabilityKey}
    >
      <p>
        {t("systemState.notImplementedBody", {
          phase: plannedIn ?? t("systemState.notImplementedLaterPhase"),
        })}
      </p>
      <p>
        <ButtonLink href={backHref}>{t("systemState.backToCommandCenter")}</ButtonLink>
      </p>
    </SystemState>
  );
}

export async function NoProjectSelectedState({ tenantHref }: { tenantHref: string }) {
  const t = await getTranslator();
  return (
    <SystemState state="no project selected" title={t("systemState.noProjectTitle")}>
      <p>{t("systemState.noProjectBody")}</p>
      <p>
        <ButtonLink href={tenantHref} variant="primary">
          {t("systemState.goToPortfolio")}
        </ButtonLink>
      </p>
    </SystemState>
  );
}
