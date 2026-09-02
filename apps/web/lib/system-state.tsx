import { ButtonLink, SystemState } from "@eia/ui";

/**
 * The 15 system states are produced by the server as typed outcomes (ARCHITECTURE.md §11).
 * These renderers hold the approved copy so it is identical wherever a state occurs.
 */
export function PermissionDeniedState({
  role,
  restrictedData,
  backHref,
}: {
  role: string | null;
  restrictedData: string;
  backHref: string;
}) {
  return (
    <SystemState state="permission denied" title="No tienes acceso a esta sección">
      <p>
        Tu rol <strong>{role ?? "actual"}</strong> no incluye {restrictedData}. Solicita acceso al
        coordinador del proyecto.
      </p>
      <p>
        <ButtonLink href={backHref}>Volver</ButtonLink>
      </p>
    </SystemState>
  );
}

export function FeatureDisabledState({
  capabilityKey,
  label,
  whoCanEnable,
  backHref,
}: {
  capabilityKey: string;
  label: string;
  whoCanEnable: string;
  backHref: string;
}) {
  return (
    <SystemState
      state="feature disabled"
      title={`${label} no está habilitado`}
      meta={capabilityKey}
    >
      <p>{whoCanEnable}</p>
      <p>
        <ButtonLink href={backHref}>Volver</ButtonLink>
      </p>
    </SystemState>
  );
}

export function NoProjectSelectedState({ tenantHref }: { tenantHref: string }) {
  return (
    <SystemState state="no project selected" title="Selecciona un proyecto para continuar">
      <p>Las secciones de GIS, campo y análisis siempre operan sobre un proyecto.</p>
      <p>
        <ButtonLink href={tenantHref} variant="primary">
          Ir al Portfolio
        </ButtonLink>
      </p>
    </SystemState>
  );
}
