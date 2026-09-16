import { loadProvenanceView } from "@eia/application";
import { NotFound, type RequestContext } from "@eia/domain";
import {
  Chip,
  deriveSourceTypeLabel,
  ProvenanceBadge,
  ProvenanceField,
  ProvenanceSection,
} from "@eia/ui";

import { RouteDrawer } from "@/components/navigation";

import { getDb } from "@/lib/db";
import {
  granularityLabel,
  originLabel,
  regimeLabel,
  sourceTypeNote,
  transformationLabel,
  validationStateLabel,
} from "@/lib/labels";
import { getI18n } from "@/lib/locale";

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
  const { t, fmt } = await getI18n();
  let view;
  try {
    view = await loadProvenanceView(getDb(), ctx, provenanceId);
  } catch (error) {
    if (!(error instanceof NotFound)) throw error;
    return (
      <RouteDrawer title={t("provenance.notFoundTitle")} closeHref={closeHref}>
        <ProvenanceSection>
          <p>{t("provenance.notFoundBody")}</p>
        </ProvenanceSection>
      </RouteDrawer>
    );
  }

  const { facets } = view;
  const sourceType = deriveSourceTypeLabel(facets);
  const transformations = facets.transformations
    .map((value) => transformationLabel(t, value))
    .join(" → ");

  return (
    <RouteDrawer title={view.title} closeHref={closeHref}>
      <ProvenanceSection>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <ProvenanceBadge facets={facets} t={t} />
          {/*
            The badge is a summary of the four fields below it, and this line says what it means
            here rather than shouting that it was derived. A reader opens this drawer to decide
            whether they may quote a figure; "a verifiable figure from the corpus" answers that,
            and "LABEL DERIVED FROM THE FACETS" answered a question nobody asked (ADR-025).
          */}
          {sourceType ? (
            <span style={{ fontSize: 11, color: "var(--eia-text-muted)" }}>
              {sourceTypeNote(t, sourceType)}
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

      <ProvenanceField label={t("provenance.regime")}>
        {regimeLabel(t, facets.regime)}
      </ProvenanceField>
      <ProvenanceField label={t("provenance.origin")}>
        {originLabel(t, facets.origin)}
      </ProvenanceField>
      <ProvenanceField label={t("provenance.transformations")}>{transformations}</ProvenanceField>
      <ProvenanceField label={t("provenance.granularity")}>
        {facets.granularity
          ? granularityLabel(t, facets.granularity)
          : t("provenance.notApplicable")}
      </ProvenanceField>

      {view.sourceLabel ? (
        <ProvenanceField label={t("provenance.sourceDataset")}>
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
        <ProvenanceField label={t("common.version")}>{view.sourceVersion}</ProvenanceField>
      ) : null}
      {view.capturedAt ? (
        <ProvenanceField label={t("provenance.capturedOrImported")}>
          {fmt.dateTime(view.capturedAt)}
        </ProvenanceField>
      ) : null}
      {view.method ? (
        <ProvenanceField label={t("provenance.method")}>{view.method}</ProvenanceField>
      ) : null}
      {view.inputs.length > 0 ? (
        <ProvenanceField label={t("provenance.derivedFrom")}>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {view.inputs.map((input) => (
              <li key={input.id}>{input.title}</li>
            ))}
          </ul>
        </ProvenanceField>
      ) : null}
      <ProvenanceField label={t("provenance.recordedIn")}>
        {fmt.dateTime(view.recordedAt)}
      </ProvenanceField>
      <ProvenanceField label={t("provenance.validation")}>
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Chip tone={view.validationState === "VALIDATED" ? "ok" : "warn"}>
            {validationStateLabel(t, view.validationState)}
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
