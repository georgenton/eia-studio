import { loadProvenanceView } from "@eia/application";
import {
  GRANULARITY_LABEL,
  NotFound,
  ORIGIN_LABEL,
  REGIME_LABEL,
  SOURCE_TYPE_NOTE,
  TRANSFORMATION_LABEL,
  VALIDATION_STATE_LABEL,
  type RequestContext,
} from "@eia/domain";
import {
  Chip,
  deriveSourceTypeLabel,
  formatDateTime,
  ProvenanceBadge,
  ProvenanceField,
  ProvenanceSection,
} from "@eia/ui";

import { RouteDrawer } from "@/components/navigation";

import { getDb } from "@/lib/db";

/**
 * Server-rendered content of the Data Provenance drawer. The record is loaded with the verified
 * RequestContext, so a provenance id from another project cannot be opened by editing the URL:
 * the read model filters by tenant and project and RLS denies the row a second time.
 *
 * The four facets are shown as facets. The SOURCE TYPE badge above them is derived presentation
 * (invariant 13) and is labelled as such, so the drawer never implies a stored source type.
 */
export async function ProvenancePanel({
  ctx,
  provenanceId,
  closeHref,
}: {
  ctx: RequestContext;
  provenanceId: string;
  closeHref: string;
}) {
  let view;
  try {
    view = await loadProvenanceView(getDb(), ctx, provenanceId);
  } catch (error) {
    if (!(error instanceof NotFound)) throw error;
    return (
      <RouteDrawer title="Registro no disponible" closeHref={closeHref}>
        <ProvenanceSection>
          <p>
            No existe un registro de procedencia con ese identificador en este proyecto, o no tienes
            acceso a él.
          </p>
        </ProvenanceSection>
      </RouteDrawer>
    );
  }

  const { facets } = view;
  const sourceType = deriveSourceTypeLabel(facets);
  const transformations = facets.transformations.map((t) => TRANSFORMATION_LABEL[t]).join(" → ");

  return (
    <RouteDrawer title={view.title} closeHref={closeHref}>
      <ProvenanceSection>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <ProvenanceBadge facets={facets} />
          {/*
            The badge is a summary of the four fields below it, and this line says what it means
            here rather than shouting that it was derived. A reader opens this drawer to decide
            whether they may quote a figure; «Cifra verificable del expediente» answers that, and
            «ETIQUETA DERIVADA DE LAS FACETAS» answered a question nobody asked (ADR-025).
          */}
          {sourceType ? (
            <span style={{ fontSize: 11, color: "var(--eia-text-muted)" }}>
              {SOURCE_TYPE_NOTE[sourceType]}
            </span>
          ) : null}
        </div>
        <p
          style={{
            fontSize: 11.5,
            color: "var(--eia-text-secondary)",
            lineHeight: 1.55,
            margin: 0,
          }}
        >
          {view.note}
        </p>
      </ProvenanceSection>

      <ProvenanceField label="Régimen">{REGIME_LABEL[facets.regime]}</ProvenanceField>
      <ProvenanceField label="Origen">{ORIGIN_LABEL[facets.origin]}</ProvenanceField>
      <ProvenanceField label="Transformaciones">{transformations}</ProvenanceField>
      <ProvenanceField label="Granularidad">
        {facets.granularity ? GRANULARITY_LABEL[facets.granularity] : "No aplica"}
      </ProvenanceField>

      {view.sourceLabel ? (
        <ProvenanceField label="Fuente / dataset">
          {view.sourceLabel}
          {view.sourceReference ? (
            <>
              <br />
              <span style={{ fontFamily: "var(--eia-font-mono)", fontSize: 11 }}>
                {view.sourceReference}
              </span>
            </>
          ) : null}
        </ProvenanceField>
      ) : null}
      {view.sourceVersion ? (
        <ProvenanceField label="Versión">{view.sourceVersion}</ProvenanceField>
      ) : null}
      {view.capturedAt ? (
        <ProvenanceField label="Capturado / importado">
          {formatDateTime(view.capturedAt)}
        </ProvenanceField>
      ) : null}
      {view.method ? <ProvenanceField label="Método">{view.method}</ProvenanceField> : null}
      {view.inputs.length > 0 ? (
        <ProvenanceField label="Calculado a partir de">
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {view.inputs.map((input) => (
              <li key={input.id}>{input.title}</li>
            ))}
          </ul>
        </ProvenanceField>
      ) : null}
      <ProvenanceField label="Registrado en EIA Studio">
        {formatDateTime(view.recordedAt)}
      </ProvenanceField>
      <ProvenanceField label="Validación humana">
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Chip tone={view.validationState === "VALIDATED" ? "ok" : "warn"}>
            {VALIDATION_STATE_LABEL[view.validationState]}
          </Chip>
          {view.validationNote ? (
            <span style={{ fontSize: 11.5, color: "var(--eia-text-secondary)" }}>
              {view.validationNote}
            </span>
          ) : null}
        </span>
      </ProvenanceField>
    </RouteDrawer>
  );
}
