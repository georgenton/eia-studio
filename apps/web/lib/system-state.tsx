import { SystemState } from "@eia/ui";
import { ButtonLink } from "@/components/navigation";

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

/**
 * A module the project *is* entitled to whose surface this slice has not built (ADR-016).
 * It is deliberately inert: no module data, no actions, and no claim that the workflow exists.
 * It is also deliberately distinct from a capability the project does not have, which answers
 * 404 and never reaches this component.
 */
export function ModuleNotImplementedState({
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
  return (
    <SystemState
      state="module not implemented"
      title={`${label}: la implementación aún no está disponible`}
      meta={capabilityKey}
    >
      <p>
        El módulo está habilitado para este proyecto. Su superficie llega en{" "}
        {plannedIn ?? "una fase posterior"}; todavía no hay datos ni acciones disponibles aquí, y no
        se muestran cifras de demostración en su lugar.
      </p>
      <p>
        <ButtonLink href={backHref}>Volver al centro de control</ButtonLink>
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
