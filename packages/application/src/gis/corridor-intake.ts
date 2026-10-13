import { createHash, randomUUID } from "node:crypto";

import { gisSchema, withDbContext, type Database, type DbTx } from "@eia/db";
import { requireCapability, requirePermission, type RequestContext } from "@eia/domain";
import { and, eq, inArray, sql } from "drizzle-orm";

import { activateDatasetVersionInTx, type DatasetActivation } from "./activate-dataset-version";
import { z } from "zod";

/**
 * The first corridor a consultancy loads into a project it owns.
 *
 * This is **not** the demonstration seeder. That script builds a scenario — metrics, a forecast,
 * an activity feed, field configuration, deletions — around one known study, and running it to
 * load a client's cartography would write a demonstration into a real project. What is reused here
 * is the part that is genuinely about geometry: the dataset → version → parcel → geometry shape,
 * `ST_Multi` into canonical 4326, and `activateDatasetVersion`.
 *
 * Two layers, because two layers arrived. The delivery carries an axis and parcels and nothing
 * else; affectations, chainage and influence areas are **absent, not empty**, so this use-case
 * neither demands them nor writes a zero that would read as "none exist".
 */
export const CORRIDOR_INTAKE_CONTRACT = "corridor-intake@2" as const;

/**
 * A source code is the delivery's own, and this product does not yet know whether it survives the
 * next export. It orders and matches *within* one package; it is not a cadastral identifier, and
 * a different package may not silently update rows it named.
 */
export const PROVISIONAL_SOURCE_CODE = "PROVISIONAL_SOURCE_CODE" as const;

export const corridorIntakeInputSchema = z
  .object({
    /** Explicit destination. There is no default, and none of these may name a demo project. */
    tenantSlug: z.string().min(1),
    projectSlug: z.string().min(1),
    /** Identity of what arrived, so a figure on screen traces back to a file. */
    sourceLabel: z.string().min(1).max(200),
    sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
    receivedAt: z.string().min(4).max(40),
    /** Declared by the delivery, never inferred from the country. */
    sourceSrid: z.number().int().positive(),
    analysisSrid: z.number().int().positive(),
    /** The attribute this product reads as the parcel code, named rather than guessed. */
    parcelCodeField: z.string().min(1).max(60),
    condition: z.enum(["PRELIMINARY_DRAFT", "FINAL"]),
    /** Normalised layers already on this machine. No URL is fetched. */
    alignment: z.unknown(),
    parcels: z.unknown(),
    alignmentLabel: z.string().min(1).max(120),
    /**
     * A second, different package against a destination that already holds one is refused unless
     * somebody states that the source codes mean the same parcels. Nothing infers that from
     * overlap, proximity or row order.
     */
    identityConfirmedForNewPackage: z.boolean().default(false),
    /**
     * Activation happens **inside the writing transaction** or not at all. Activating afterwards
     * is what let a failure leave a new axis on the map beside the old parcels.
     */
    activate: z.boolean().default(false),
  })
  .strict();

export type CorridorIntakeInput = z.input<typeof corridorIntakeInputSchema>;

const positionSchema = z.tuple([z.number().finite(), z.number().finite()]).rest(z.number());
const ringSchema = z.array(positionSchema).min(4);
const polygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(ringSchema).min(1),
});
const multiPolygonSchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(ringSchema).min(1)).min(1),
});
const lineSchema = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(positionSchema).min(2),
});
const multiLineSchema = z.object({
  type: z.literal("MultiLineString"),
  coordinates: z.array(z.array(positionSchema).min(2)).min(1),
});

const parcelFeatureSchema = z.object({
  type: z.literal("Feature"),
  properties: z.record(z.string(), z.unknown()),
  geometry: z.union([polygonSchema, multiPolygonSchema]),
});
const alignmentFeatureSchema = z.object({
  type: z.literal("Feature"),
  properties: z.record(z.string(), z.unknown()).optional(),
  geometry: z.union([lineSchema, multiLineSchema]),
});
const collectionSchema = <T extends z.ZodTypeAny>(feature: T) =>
  z.object({ type: z.literal("FeatureCollection"), features: z.array(feature).min(1) });

export interface CorridorIntakeProblem {
  readonly code:
    | "layer_unreadable"
    | "parcel_code_missing"
    | "parcel_code_duplicated"
    | "geometry_invalid"
    | "geometry_empty"
    | "multiple_alignments"
    | "incomplete_import_state";
  readonly detail: string;
  /** Source codes or row positions, never an attribute value of a person. */
  readonly subjects: readonly string[];
}

export interface CorridorIntakePlan {
  readonly contract: typeof CORRIDOR_INTAKE_CONTRACT;
  /**
   * What an operator approves, and what APPLY must be handed back **separately**.
   *
   * It covers the destination, the declared source, the **bytes actually read** for each layer,
   * the mapping, both SRIDs, the condition and the destination's current version state. A GeoJSON
   * edited after the plan was reviewed changes it, and so does a version appearing underneath.
   */
  readonly fingerprint: string;
  readonly layerSha256: { readonly alignment: string; readonly parcels: string };
  readonly destinationVersionLabels: readonly string[];
  readonly tenantId: string;
  readonly projectId: string;
  readonly sourceSha256: string;
  readonly sourceSrid: number;
  readonly analysisSrid: number;
  readonly identityBasis: typeof PROVISIONAL_SOURCE_CODE;
  readonly parcelsRead: number;
  readonly alignmentsRead: number;
  readonly parcelsToCreate: number;
  readonly parcelsToMatch: number;
  /** Layers the delivery did not contain. Absent, never zero. */
  readonly layersAbsent: readonly string[];
  readonly versionLabels: { readonly parcels: string; readonly alignment: string };
  /** True only when **both** versions of this exact package are already present. */
  readonly reusesExistingVersions: boolean;
  readonly problems: readonly CorridorIntakeProblem[];
  readonly applicable: boolean;
  readonly refusal: string | null;
}

export interface CorridorIntakeResult {
  readonly plan: CorridorIntakePlan;
  readonly applied: boolean;
  readonly noop: boolean;
  readonly parcelsCreated: number;
  readonly parcelsMatched: number;
  readonly geometriesWritten: number;
  readonly sideDerived: number;
  readonly chainageDerived: number;
  readonly parcelsVersionId: string | null;
  readonly alignmentVersionId: string | null;
  /** Empty unless activation was opted into; produced in the same transaction as the writes. */
  readonly activations: readonly DatasetActivation[];
}

/**
 * A hash of what was actually read, not of what the descriptor claims.
 *
 * `sourceSha256` names the archive and is a declaration: an operator can write it beside a GeoJSON
 * somebody edited afterwards, and the no-op would then hide a different package behind a matching
 * label. So each layer is hashed from its own parsed content, with object keys sorted, so the same
 * data hashes the same way whatever order a tool wrote it in.
 */
function stableHash(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

/** A label that *is* the package's identity, so the existing unique index enforces the no-op. */
function versionLabel(kind: "parcels" | "alignment", sha256: string): string {
  return `${kind}_intake_${sha256.slice(0, 12)}`;
}

function readLayers(input: ParsedIntake): {
  parcels: z.infer<ReturnType<typeof collectionSchema<typeof parcelFeatureSchema>>> | null;
  alignment: z.infer<ReturnType<typeof collectionSchema<typeof alignmentFeatureSchema>>> | null;
  problems: CorridorIntakeProblem[];
} {
  const problems: CorridorIntakeProblem[] = [];
  const p = collectionSchema(parcelFeatureSchema).safeParse(input.parcels);
  const a = collectionSchema(alignmentFeatureSchema).safeParse(input.alignment);
  if (!p.success) {
    problems.push({
      code: "layer_unreadable",
      detail: "parcels layer is not a usable FeatureCollection of polygons",
      subjects: [],
    });
  }
  if (!a.success) {
    problems.push({
      code: "layer_unreadable",
      detail: "alignment layer is not a usable FeatureCollection of lines",
      subjects: [],
    });
  }
  return { parcels: p.success ? p.data : null, alignment: a.success ? a.data : null, problems };
}

function readCodes(
  features: readonly { properties: Record<string, unknown> }[],
  field: string,
): { codes: string[]; problems: CorridorIntakeProblem[] } {
  const problems: CorridorIntakeProblem[] = [];
  const codes: string[] = [];
  const missing: string[] = [];
  const seen = new Map<string, number>();
  features.forEach((f, i) => {
    const raw = f.properties[field];
    // Kept as text, exactly as delivered: `001` is not `1`.
    const code = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
    if (code === "") {
      missing.push(`row ${i + 1}`);
      codes.push("");
      return;
    }
    seen.set(code, (seen.get(code) ?? 0) + 1);
    codes.push(code);
  });
  if (missing.length > 0) {
    problems.push({
      code: "parcel_code_missing",
      detail: `the ${field} attribute is blank`,
      subjects: missing,
    });
  }
  const dup = [...seen.entries()].filter(([, n]) => n > 1).map(([c]) => c);
  if (dup.length > 0) {
    problems.push({
      code: "parcel_code_duplicated",
      detail: `the ${field} attribute repeats`,
      subjects: dup,
    });
  }
  return { codes, problems };
}

/**
 * Validity is GEOS's answer, asked of the database and never repaired here.
 *
 * `ST_IsValid` runs as a read on a value expression, so this is the same check in PLAN and before
 * any write in APPLY, and PLAN still writes nothing. An invalid ring is reported with its code and
 * blocks that package; `ST_MakeValid`, `buffer(0)`, snapping and simplification are all absent on
 * purpose — a boundary this product quietly moved is a boundary nobody surveyed.
 */
async function checkGeometries(
  tx: DbTx,
  features: readonly { geometry: unknown }[],
  codes: readonly string[],
): Promise<CorridorIntakeProblem[]> {
  const problems: CorridorIntakeProblem[] = [];
  const invalid: string[] = [];
  const empty: string[] = [];
  for (const [i, f] of features.entries()) {
    const rows = await tx.execute<{ valid: boolean; empty: boolean }>(
      sql`select ST_IsValid(g) as valid, ST_IsEmpty(g) as empty
          from (select ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(f.geometry)}), 4326) as g) s`,
    );
    const row = rows.rows?.[0] ?? (rows as unknown as { valid: boolean; empty: boolean }[])[0];
    const subject = codes[i] !== undefined && codes[i] !== "" ? codes[i]! : `row ${i + 1}`;
    if (row?.empty === true) empty.push(subject);
    else if (row?.valid === false) invalid.push(subject);
  }
  if (invalid.length > 0) {
    problems.push({
      code: "geometry_invalid",
      detail: "OGC validity failed; nothing is repaired automatically",
      subjects: invalid,
    });
  }
  if (empty.length > 0) {
    problems.push({ code: "geometry_empty", detail: "geometry is empty", subjects: empty });
  }
  return problems;
}

async function resolveDestination(
  tx: DbTx,
  ctx: RequestContext,
  input: ParsedIntake,
): Promise<{ tenantId: string; projectId: string }> {
  const rows = await tx.execute<{ tenant_id: string; project_id: string }>(
    sql`select t.id as tenant_id, p.id as project_id
          from app.tenant t join app.project p on p.tenant_id = t.id
         where t.slug = ${input.tenantSlug} and p.slug = ${input.projectSlug}`,
  );
  const row = (rows.rows ?? (rows as unknown as { tenant_id: string; project_id: string }[]))[0];
  if (row === undefined)
    throw new Error(
      "corridor intake: the named tenant and project are not reachable in this context",
    );
  // The payload names a destination; the context decides whether it is the caller's.
  if (row.tenant_id !== ctx.tenantId || row.project_id !== ctx.projectId) {
    throw new Error("corridor intake: the named destination is not the active context");
  }
  return { tenantId: row.tenant_id, projectId: row.project_id };
}

type ParsedIntake = z.output<typeof corridorIntakeInputSchema>;

async function buildPlan(
  tx: DbTx,
  ctx: RequestContext,
  input: ParsedIntake,
): Promise<CorridorIntakePlan> {
  const { tenantId, projectId } = await resolveDestination(tx, ctx, input);
  const layers = readLayers(input);
  const problems: CorridorIntakeProblem[] = [...layers.problems];
  let codes: string[] = [];

  if (layers.alignment !== null && layers.alignment.features.length !== 1) {
    // A corridor has one axis. Two lines in the layer may be a split centreline, two alternative
    // designs or a second road entirely, and this product cannot tell which — so it refuses rather
    // than importing the first and discarding the rest without saying so.
    problems.push({
      code: "multiple_alignments",
      detail: `the alignment layer carries ${layers.alignment.features.length} features; exactly one is expected`,
      subjects: layers.alignment.features.map((_, i) => `alignment ${i + 1}`),
    });
  }
  if (layers.parcels !== null) {
    const read = readCodes(layers.parcels.features, input.parcelCodeField);
    codes = read.codes;
    problems.push(...read.problems);
    problems.push(...(await checkGeometries(tx, layers.parcels.features, codes)));
  }
  if (layers.alignment !== null) {
    problems.push(
      ...(await checkGeometries(
        tx,
        layers.alignment.features,
        layers.alignment.features.map((_, i) => `alignment ${i + 1}`),
      )),
    );
  }

  const labels = {
    parcels: versionLabel("parcels", input.sourceSha256),
    alignment: versionLabel("alignment", input.sourceSha256),
  };

  const existing = await tx.execute<{ version_label: string; kind: string }>(
    sql`select v.version_label, d.kind
          from app.spatial_dataset_version v
          join app.spatial_dataset d on d.tenant_id = v.tenant_id and d.id = v.dataset_id
         where v.tenant_id = ${tenantId} and v.project_id = ${projectId}
           and d.kind in ('parcels','alignment')
         order by v.version_label`,
  );
  const existingRows =
    existing.rows ?? (existing as unknown as { version_label: string; kind: string }[]);
  const labelsPresent = new Set(existingRows.map((r) => r.version_label));
  const hasParcels = labelsPresent.has(labels.parcels);
  const hasAlignment = labelsPresent.has(labels.alignment);
  const otherPackage = existingRows.some(
    (r) => r.version_label !== labels.parcels && r.version_label !== labels.alignment,
  );

  let refusal: string | null = null;
  if (hasParcels !== hasAlignment) {
    // Half a package is not a no-op. Re-applying would write the missing half against a version
    // the first run never finished, and reporting "already imported" would hide it.
    problems.push({
      code: "incomplete_import_state",
      detail: "this destination holds one half of this package; the import did not finish",
      subjects: [hasParcels ? labels.parcels : labels.alignment],
    });
    refusal = "INCOMPLETE_IMPORT_STATE";
  } else if (otherPackage && !(hasParcels && hasAlignment)) {
    /*
     * A different package against a destination that already holds one. `ficha_num` is unique
     * within a delivery and unproven across deliveries, so matching by code could rename somebody
     * else's parcel. The boolean an operator can set is deliberately **not** enough on its own:
     * lifting this needs a reviewed mapping, which V1 does not have, and overlap, proximity and
     * row order are not that mapping.
     */
    refusal = "IDENTITY_CONFIRMATION_REQUIRED";
  }

  const present = codes.filter((c) => c !== "");
  const matched =
    present.length === 0
      ? 0
      : (
          await tx
            .select({ code: gisSchema.parcel.parcelCode })
            .from(gisSchema.parcel)
            .where(
              and(
                eq(gisSchema.parcel.tenantId, tenantId),
                eq(gisSchema.parcel.projectId, projectId),
                inArray(gisSchema.parcel.parcelCode, present),
              ),
            )
        ).length;

  const parcelsRead = layers.parcels?.features.length ?? 0;
  const layerSha256 = {
    alignment: stableHash(input.alignment),
    parcels: stableHash(input.parcels),
  };
  const destinationVersionLabels = existingRows.map((r) => r.version_label);

  const fingerprint = stableHash({
    contract: CORRIDOR_INTAKE_CONTRACT,
    tenantId,
    projectId,
    sourceSha256: input.sourceSha256,
    layerSha256,
    parcelCodeField: input.parcelCodeField,
    sourceSrid: input.sourceSrid,
    analysisSrid: input.analysisSrid,
    condition: input.condition,
    identityBasis: PROVISIONAL_SOURCE_CODE,
    destinationVersionLabels,
    activate: input.activate,
  });

  return {
    contract: CORRIDOR_INTAKE_CONTRACT,
    fingerprint,
    layerSha256,
    destinationVersionLabels,
    tenantId,
    projectId,
    sourceSha256: input.sourceSha256,
    sourceSrid: input.sourceSrid,
    analysisSrid: input.analysisSrid,
    identityBasis: PROVISIONAL_SOURCE_CODE,
    parcelsRead,
    alignmentsRead: layers.alignment?.features.length ?? 0,
    parcelsToCreate: parcelsRead - matched,
    parcelsToMatch: matched,
    layersAbsent: ["affectations", "chainage", "influenceAreas"],
    versionLabels: labels,
    reusesExistingVersions: hasParcels && hasAlignment,
    problems,
    applicable: problems.length === 0 && refusal === null,
    refusal,
  };
}

/** PLAN writes nothing. It opens a transaction only so RLS and the same validator apply. */
export async function planCorridorIntake(
  db: Database,
  ctx: RequestContext,
  input: CorridorIntakeInput,
): Promise<CorridorIntakePlan> {
  requireCapability(ctx, "gis.parcels");
  requirePermission(ctx, "geometry.import");
  const parsed = corridorIntakeInputSchema.parse(input);
  return withDbContext(db, ctx, async (tx) => {
    const plan = await buildPlan(tx, ctx, parsed);
    await tx.execute(sql`select 1`);
    return plan;
  });
}

/**
 * Writes once, inside one transaction, against a plan somebody else approved.
 *
 * `approvedPlanFingerprint` is handed in **separately** from the input. The earlier version let
 * the caller build its own expectation out of the very descriptor it was applying, which is not
 * an approval but a tautology: it agreed with itself about a GeoJSON nobody had reviewed. Here
 * the plan is recomputed inside the writing transaction, from the files as they are *now*, and a
 * fingerprint that no longer matches is `STALE_OR_UNAPPROVED_PLAN`.
 */
export async function applyCorridorIntake(
  db: Database,
  ctx: RequestContext,
  input: CorridorIntakeInput,
  approvedPlanFingerprint: string,
): Promise<CorridorIntakeResult> {
  requireCapability(ctx, "gis.parcels");
  requirePermission(ctx, "geometry.import");
  const parsed = corridorIntakeInputSchema.parse(input);
  if (approvedPlanFingerprint.length !== 64) {
    throw new Error("corridor intake: apply requires the fingerprint of an approved plan");
  }

  return withDbContext(db, ctx, async (tx) => {
    // Recomputed inside the writing transaction, from the files as they are now — not carried
    // over from the planning one, and not derived from this call's own input.
    const plan = await buildPlan(tx, ctx, parsed);
    if (plan.fingerprint !== approvedPlanFingerprint) {
      throw new Error(
        "corridor intake refused: STALE_OR_UNAPPROVED_PLAN — the layers, the destination or " +
          "the options changed since the plan was approved",
      );
    }
    if (plan.reusesExistingVersions) {
      return {
        plan,
        applied: false,
        noop: true,
        parcelsCreated: 0,
        parcelsMatched: 0,
        geometriesWritten: 0,
        sideDerived: 0,
        chainageDerived: 0,
        parcelsVersionId: null,
        alignmentVersionId: null,
        activations: [],
      };
    }
    if (!plan.applicable) {
      throw new Error(
        `corridor intake refused: ${plan.refusal ?? plan.problems.map((p) => p.code).join(", ")}`,
      );
    }

    const layers = readLayers(parsed);
    const parcelFeatures = layers.parcels!.features;
    const alignmentFeature = layers.alignment!.features[0]!;
    const { codes } = readCodes(parcelFeatures, parsed.parcelCodeField);
    const { tenantId, projectId } = plan;

    /*
     * `LIVE_OPERATIONAL`, never `DEMO_SIMULATION`: this is a consultancy's own corridor, and
     * labelling it as a demonstration would be the one mistake invariant 4 exists to prevent.
     * `PENDING` validation, because an import is not a review: nobody has yet said the cartography
     * is right, and the product records rather than decides.
     */
    const provenance = async (
      transformation: "ORIGINAL" | "DERIVED",
      title: string,
      note: string,
    ) => {
      const id = randomUUID();
      await tx.execute(sql`
        insert into app.provenance_record
          (id, tenant_id, project_id, regime, origin, transformations, granularity,
           title, note, source_label, source_version, method, captured_at, validation_state)
        values (${id}, ${tenantId}, ${projectId}, 'LIVE_OPERATIONAL', 'IMPORTED_DATASET',
                ARRAY[${transformation}]::app.provenance_transformation[], 'INDIVIDUAL',
                ${title}, ${note}, ${parsed.sourceLabel},
                ${`sha256:${parsed.sourceSha256.slice(0, 12)}`}, ${note},
                ${parsed.receivedAt}::timestamptz, 'PENDING')`);
      return id;
    };

    const importedNote = `imported from ${parsed.sourceLabel}; EPSG:${parsed.sourceSrid} transformed to 4326; ${parsed.condition}`;
    const alignProv = await provenance("ORIGINAL", "Eje vial importado", importedNote);
    const parcelProv = await provenance("ORIGINAL", "Predios importados", importedNote);
    const derivedProv = await provenance(
      "DERIVED",
      "Lateralidad y abscisa derivadas",
      "side and chainage computed from the delivered axis; the delivery declares neither",
    );

    const dataset = async (kind: "parcels" | "alignment", label: string) => {
      const found = await tx.execute<{ id: string }>(
        sql`select id from app.spatial_dataset where tenant_id = ${tenantId} and project_id = ${projectId} and kind = ${kind} limit 1`,
      );
      const hit = (found.rows ?? (found as unknown as { id: string }[]))[0];
      if (hit !== undefined) return hit.id;
      const id = randomUUID();
      await tx.execute(sql`
        insert into app.spatial_dataset (id, tenant_id, project_id, kind, label, created_at)
        values (${id}, ${tenantId}, ${projectId}, ${kind}, ${label}, now())`);
      return id;
    };

    const version = async (
      datasetId: string,
      label: string,
      count: number,
      provenanceId: string,
    ) => {
      const id = randomUUID();
      // The unique index on (tenant_id, dataset_id, version_label) is what makes a concurrent
      // retry of the same package fail rather than duplicate. A SELECT before INSERT would not.
      await tx.execute(sql`
        insert into app.spatial_dataset_version
          (id, tenant_id, project_id, dataset_id, version_label, origin, source_srid, analysis_srid,
           feature_count, is_active, produced_at, note, provenance_id, created_at)
        values (${id}, ${tenantId}, ${projectId}, ${datasetId}, ${label}, 'imported',
                ${parsed.sourceSrid}, ${parsed.analysisSrid}, ${count}, false,
                ${parsed.receivedAt}::timestamptz,
                ${`${parsed.condition} · ${CORRIDOR_INTAKE_CONTRACT} · sha256:${parsed.sourceSha256.slice(0, 12)}`},
                ${provenanceId}, now())`);
      return id;
    };

    const alignmentDatasetId = await dataset("alignment", parsed.alignmentLabel);
    const parcelsDatasetId = await dataset("parcels", "Predios");
    const alignmentVersionId = await version(
      alignmentDatasetId,
      plan.versionLabels.alignment,
      1,
      alignProv,
    );
    const parcelsVersionId = await version(
      parcelsDatasetId,
      plan.versionLabels.parcels,
      parcelFeatures.length,
      parcelProv,
    );

    await tx.execute(sql`
      insert into app.alignment (id, tenant_id, project_id, dataset_version_id, label, geom, length_m, provenance_id, created_at)
      select ${randomUUID()}, ${tenantId}, ${projectId}, ${alignmentVersionId}, ${parsed.alignmentLabel},
             ST_Multi(g), round(ST_Length(ST_Transform(g, ${parsed.analysisSrid}::integer))::numeric, 2), ${alignProv}, now()
        from (select ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(alignmentFeature.geometry)}), 4326) as g) s`);

    let parcelsCreated = 0;
    let parcelsMatched = 0;
    let sideDerived = 0;
    let chainageDerived = 0;

    for (const [i, feature] of parcelFeatures.entries()) {
      const code = codes[i]!;
      const geomJson = JSON.stringify(feature.geometry);
      /*
       * Side and chainage are computed from the axis this same package delivered, and recorded as
       * DERIVED. The delivery declares neither, and `parcel.side` is NOT NULL: `both` means a plot
       * on both sides and `left` would be a coin toss, so neither is used to mean "unknown".
       * The sign of the cross product against the axis direction is deterministic, and
       * `chainage_method = 'centroid_projection'` is the value the product already uses for exactly
       * this — a derived point, never a declared abscissa, which stays null.
       */
      const derived = await tx.execute<{ side: string; chainage: string }>(sql`
        with a as (select geom from app.alignment where tenant_id = ${tenantId} and dataset_version_id = ${alignmentVersionId} limit 1),
             g as (select ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326)) as c),
             l as (select ST_GeometryN(a.geom, 1) as ln, g.c from a, g),
             f as (select ln, c, ST_LineLocatePoint(ln, c) as t from l),
             s as (select c, ST_LineInterpolatePoint(ln, greatest(t - 0.0005, 0)) as p0,
                          ST_LineInterpolatePoint(ln, least(t + 0.0005, 1)) as p1,
                          t, ST_Length(ST_Transform(ln, ${parsed.analysisSrid}::integer)) as len from f)
        select case when (ST_X(p1) - ST_X(p0)) * (ST_Y(c) - ST_Y(p0))
                       - (ST_Y(p1) - ST_Y(p0)) * (ST_X(c) - ST_X(p0)) > 0
                    then 'left' else 'right' end as side,
               round((t * len)::numeric, 1)::text as chainage
          from s`);
      const d = (derived.rows ?? (derived as unknown as { side: string; chainage: string }[]))[0]!;
      sideDerived += 1;
      chainageDerived += 1;

      const found = await tx
        .select({ id: gisSchema.parcel.id })
        .from(gisSchema.parcel)
        .where(
          and(
            eq(gisSchema.parcel.tenantId, tenantId),
            eq(gisSchema.parcel.projectId, projectId),
            eq(gisSchema.parcel.parcelCode, code),
          ),
        )
        .limit(1);
      let parcelId = found[0]?.id;
      if (parcelId === undefined) {
        parcelId = randomUUID();
        await tx.execute(sql`
          insert into app.parcel
            (id, tenant_id, project_id, parcel_code, side, status, chainage_m, chainage_method, provenance_id, created_at)
          values (${parcelId}, ${tenantId}, ${projectId}, ${code}, ${d.side}::app.parcel_side,
                  'estimated', ${d.chainage}, 'centroid_projection', ${derivedProv}, now())`);
        parcelsCreated += 1;
      } else {
        // A matched parcel keeps its UUID, and therefore every visit, response and photograph
        // that already points at it (GIS_IMPORT_CONTRACT §1).
        parcelsMatched += 1;
      }

      await tx.execute(sql`
        insert into app.parcel_geometry
          (id, tenant_id, project_id, parcel_id, dataset_version_id, geom, area_m2, is_active, provenance_id, created_at)
        select ${randomUUID()}, ${tenantId}, ${projectId}, ${parcelId}, ${parcelsVersionId},
               ST_Multi(g), round(ST_Area(ST_Transform(g, ${parsed.analysisSrid}::integer))::numeric, 2), false, ${parcelProv}, now()
          from (select ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326) as g) s`);
    }

    /*
     * Activation shares this transaction. Done afterwards through the public use-case it opened a
     * transaction of its own per version, so a failure on the second committed the first and left
     * the map showing this package's axis beside the previous package's parcels, with nothing to
     * roll it back. Both, or neither.
     */
    const activations: DatasetActivation[] = [];
    if (parsed.activate) {
      for (const id of [alignmentVersionId, parcelsVersionId]) {
        activations.push(await activateDatasetVersionInTx(tx, ctx, id));
      }
    }

    return {
      plan,
      applied: true,
      noop: false,
      parcelsCreated,
      parcelsMatched,
      geometriesWritten: parcelFeatures.length,
      sideDerived,
      chainageDerived,
      parcelsVersionId,
      alignmentVersionId,
      activations,
    };
  });
}
