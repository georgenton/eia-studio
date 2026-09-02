import { gisSchema, withDbContext, type Database } from "@eia/db";
import {
  assertActivationIsValid,
  NotFound,
  requireCapability,
  requirePermission,
  type RequestContext,
  type SpatialDatasetKind,
} from "@eia/domain";
import { and, eq } from "drizzle-orm";

/**
 * Activate a spatial dataset version, superseding the one it replaces (IG2-002).
 *
 * This is the transaction an official GIS import will end with. The importer itself is not built
 * (`docs/GIS_IMPORT_CONTRACT.md`); what is built is the step that decides which geometry the
 * product answers with, because that is where the invariants live:
 *
 * - **Parcel identity survives.** Nothing here touches `app.parcel`. A replacement writes new
 *   `parcel_geometry` rows against the new version and flips which of them is active; the
 *   parcel's UUID, its business code and everything that points at it are untouched.
 * - **One active version per dataset, one active geometry per parcel.** Both are unique partial
 *   indexes, checked at the end of each statement, so the old rows are deactivated before the new
 *   ones are activated and the two steps share one transaction — which is why this is a use-case
 *   and not two repository calls.
 * - **Kinds are independent.** Uniqueness is scoped to the dataset, so `alignment` and `parcels`
 *   have active versions at the same time; activating one never disturbs the other.
 * - **Nothing is deleted.** The superseded version and its geometry stay, flagged inactive, so a
 *   figure produced from them remains explainable.
 * - **Failure rolls back whole.** If any step raises — a validity CHECK, an RLS denial, a
 *   geometry that does not belong to the project — the previous version is still active and no
 *   half-replaced state is visible.
 */
export interface DatasetActivation {
  readonly datasetKind: SpatialDatasetKind;
  readonly activatedVersionId: string;
  readonly supersededVersionId: string | null;
  readonly geometriesActivated: number;
  readonly geometriesSuperseded: number;
}

export async function activateDatasetVersion(
  db: Database,
  ctx: RequestContext,
  versionId: string,
): Promise<DatasetActivation> {
  requireCapability(ctx, "gis.parcels");
  requirePermission(ctx, "geometry.import");
  if (ctx.projectId === null) {
    throw new Error("activateDatasetVersion requires a project context");
  }
  const projectId = ctx.projectId;

  return withDbContext(db, ctx, async (tx) => {
    const candidates = await tx
      .select({
        id: gisSchema.spatialDatasetVersion.id,
        datasetId: gisSchema.spatialDatasetVersion.datasetId,
        isActive: gisSchema.spatialDatasetVersion.isActive,
        supersedesVersionId: gisSchema.spatialDatasetVersion.supersedesVersionId,
        kind: gisSchema.spatialDataset.kind,
      })
      .from(gisSchema.spatialDatasetVersion)
      .innerJoin(
        gisSchema.spatialDataset,
        and(
          eq(gisSchema.spatialDataset.tenantId, gisSchema.spatialDatasetVersion.tenantId),
          eq(gisSchema.spatialDataset.id, gisSchema.spatialDatasetVersion.datasetId),
        ),
      )
      .where(
        and(
          eq(gisSchema.spatialDatasetVersion.tenantId, ctx.tenantId),
          eq(gisSchema.spatialDatasetVersion.projectId, projectId),
          eq(gisSchema.spatialDatasetVersion.id, versionId),
        ),
      );
    const candidate = candidates[0];
    if (!candidate) throw new NotFound("spatial dataset version");

    // The currently active version *of this dataset*. Other kinds are not consulted, because
    // uniqueness is per dataset and an alignment must stay active while parcels are replaced.
    const actives = await tx
      .select({
        id: gisSchema.spatialDatasetVersion.id,
        kind: gisSchema.spatialDataset.kind,
      })
      .from(gisSchema.spatialDatasetVersion)
      .innerJoin(
        gisSchema.spatialDataset,
        and(
          eq(gisSchema.spatialDataset.tenantId, gisSchema.spatialDatasetVersion.tenantId),
          eq(gisSchema.spatialDataset.id, gisSchema.spatialDatasetVersion.datasetId),
        ),
      )
      .where(
        and(
          eq(gisSchema.spatialDatasetVersion.tenantId, ctx.tenantId),
          eq(gisSchema.spatialDatasetVersion.datasetId, candidate.datasetId),
          eq(gisSchema.spatialDatasetVersion.isActive, true),
        ),
      );
    const currentActive = actives[0] ?? null;

    // The domain rule: a replacement must name the version it supersedes, so the chain stays
    // traceable after the fact.
    assertActivationIsValid({
      candidate: {
        id: candidate.id,
        datasetKind: candidate.kind,
        supersedesVersionId: candidate.supersedesVersionId,
      },
      currentActive: currentActive
        ? { id: currentActive.id, datasetKind: currentActive.kind }
        : null,
    });

    if (currentActive && currentActive.id === candidate.id) {
      return {
        datasetKind: candidate.kind,
        activatedVersionId: candidate.id,
        supersededVersionId: null,
        geometriesActivated: 0,
        geometriesSuperseded: 0,
      };
    }

    let geometriesSuperseded = 0;
    if (currentActive) {
      await tx
        .update(gisSchema.spatialDatasetVersion)
        .set({ isActive: false })
        .where(
          and(
            eq(gisSchema.spatialDatasetVersion.tenantId, ctx.tenantId),
            eq(gisSchema.spatialDatasetVersion.id, currentActive.id),
          ),
        );
      const superseded = await tx
        .update(gisSchema.parcelGeometry)
        .set({ isActive: false })
        .where(
          and(
            eq(gisSchema.parcelGeometry.tenantId, ctx.tenantId),
            eq(gisSchema.parcelGeometry.projectId, projectId),
            eq(gisSchema.parcelGeometry.datasetVersionId, currentActive.id),
            eq(gisSchema.parcelGeometry.isActive, true),
          ),
        )
        .returning({ id: gisSchema.parcelGeometry.id });
      geometriesSuperseded = superseded.length;
    }

    await tx
      .update(gisSchema.spatialDatasetVersion)
      .set({ isActive: true })
      .where(
        and(
          eq(gisSchema.spatialDatasetVersion.tenantId, ctx.tenantId),
          eq(gisSchema.spatialDatasetVersion.id, candidate.id),
        ),
      );
    const activated = await tx
      .update(gisSchema.parcelGeometry)
      .set({ isActive: true })
      .where(
        and(
          eq(gisSchema.parcelGeometry.tenantId, ctx.tenantId),
          eq(gisSchema.parcelGeometry.projectId, projectId),
          eq(gisSchema.parcelGeometry.datasetVersionId, candidate.id),
        ),
      )
      .returning({ id: gisSchema.parcelGeometry.id });

    return {
      datasetKind: candidate.kind,
      activatedVersionId: candidate.id,
      supersededVersionId: currentActive?.id ?? null,
      geometriesActivated: activated.length,
      geometriesSuperseded,
    };
  });
}
