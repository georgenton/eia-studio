import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { appSchema, fieldSchema, gisSchema, type Database } from "@eia/db";

/**
 * Generic factories (TESTING_STRATEGY.md §1): tenant A / tenant B, projects X / Y / Z, users
 * with role names in their addresses. Never pilot data, never anything resembling a person.
 * Inserts run with the migrator connection (bypasses RLS) to arrange state; assertions then use
 * the runtime connection.
 */
export type TenantRoleName = "OWNER" | "ADMIN" | "MEMBER";
export type ProjectRoleName =
  | "COORDINATOR"
  | "SOCIAL_SPECIALIST"
  | "ENVIRONMENTAL_SPECIALIST"
  | "GIS_SPECIALIST"
  | "FIELD_TECHNICIAN"
  | "REVIEWER"
  | "VIEWER";

let counter = 0;
const next = () => (++counter).toString(36);

export async function createUser(
  db: Database,
  label: string,
): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `${label}-${next()}@factory.test`;
  await db.insert(appSchema.user).values({ id, email, name: label });
  return { id, email };
}

export async function createTenant(
  db: Database,
  slug: string,
): Promise<{ id: string; slug: string }> {
  const [row] = await db
    .insert(appSchema.tenant)
    .values({ slug: `${slug}-${next()}`, name: `Tenant ${slug}` })
    .returning({ id: appSchema.tenant.id, slug: appSchema.tenant.slug });
  return row!;
}

export async function createTenantMembership(
  db: Database,
  input: { tenantId: string; userId: string; role: TenantRoleName },
): Promise<{ id: string }> {
  const [row] = await db
    .insert(appSchema.tenantMembership)
    .values({ tenantId: input.tenantId, userId: input.userId, role: input.role, status: "active" })
    .returning({ id: appSchema.tenantMembership.id });
  return row!;
}

export async function createProject(
  db: Database,
  input: { tenantId: string; slug: string },
): Promise<{ id: string; slug: string }> {
  const [row] = await db
    .insert(appSchema.project)
    .values({
      tenantId: input.tenantId,
      slug: `${input.slug}-${next()}`,
      name: `Project ${input.slug}`,
      profileKey: "test_profile",
      profileVersion: "1",
    })
    .returning({ id: appSchema.project.id, slug: appSchema.project.slug });
  return row!;
}

export async function createProjectMembership(
  db: Database,
  input: { tenantId: string; projectId: string; tenantMembershipId: string; role: ProjectRoleName },
): Promise<{ id: string }> {
  const [row] = await db
    .insert(appSchema.projectMembership)
    .values({ ...input, status: "active" })
    .returning({ id: appSchema.projectMembership.id });
  return row!;
}

export async function setTenantCapability(
  db: Database,
  input: { tenantId: string; key: string; entitled: boolean; enabled: boolean },
): Promise<void> {
  await db
    .insert(appSchema.tenantCapability)
    .values({
      tenantId: input.tenantId,
      capabilityKey: input.key,
      entitled: input.entitled,
      enabled: input.enabled,
    })
    .onConflictDoUpdate({
      target: [appSchema.tenantCapability.tenantId, appSchema.tenantCapability.capabilityKey],
      set: { entitled: input.entitled, enabled: input.enabled },
    });
}

export interface TwoTenantWorld {
  readonly tenantA: { id: string; slug: string };
  readonly tenantB: { id: string; slug: string };
  readonly ownerA: { id: string; email: string; membershipId: string };
  readonly adminA: { id: string; email: string; membershipId: string };
  readonly memberA: { id: string; email: string; membershipId: string };
  readonly ownerB: { id: string; email: string; membershipId: string };
  readonly projectX: { id: string; slug: string }; // tenant A, memberA is VIEWER
  readonly projectY: { id: string; slug: string }; // tenant A, memberA has no membership
  readonly projectZ: { id: string; slug: string }; // tenant B
  readonly memberAProjectXMembershipId: string;
}

/** Two tenants, three users in A (owner, admin, member), one owner in B, three projects. */
export async function seedTwoTenantWorld(db: Database): Promise<TwoTenantWorld> {
  const tenantA = await createTenant(db, "tenant-a");
  const tenantB = await createTenant(db, "tenant-b");
  const ownerAUser = await createUser(db, "owner-a");
  const adminAUser = await createUser(db, "admin-a");
  const memberAUser = await createUser(db, "member-a");
  const ownerBUser = await createUser(db, "owner-b");
  const ownerA = await createTenantMembership(db, {
    tenantId: tenantA.id,
    userId: ownerAUser.id,
    role: "OWNER",
  });
  const adminA = await createTenantMembership(db, {
    tenantId: tenantA.id,
    userId: adminAUser.id,
    role: "ADMIN",
  });
  const memberA = await createTenantMembership(db, {
    tenantId: tenantA.id,
    userId: memberAUser.id,
    role: "MEMBER",
  });
  const ownerB = await createTenantMembership(db, {
    tenantId: tenantB.id,
    userId: ownerBUser.id,
    role: "OWNER",
  });
  const projectX = await createProject(db, { tenantId: tenantA.id, slug: "project-x" });
  const projectY = await createProject(db, { tenantId: tenantA.id, slug: "project-y" });
  const projectZ = await createProject(db, { tenantId: tenantB.id, slug: "project-z" });
  const pm = await createProjectMembership(db, {
    tenantId: tenantA.id,
    projectId: projectX.id,
    tenantMembershipId: memberA.id,
    role: "VIEWER",
  });
  for (const tenantId of [tenantA.id, tenantB.id]) {
    for (const key of [
      "core.projects",
      "gis.maps",
      "gis.parcels",
      "quality.document_gate",
      "client.portal",
    ]) {
      await setTenantCapability(db, { tenantId, key, entitled: true, enabled: true });
    }
  }
  return {
    tenantA,
    tenantB,
    ownerA: { ...ownerAUser, membershipId: ownerA.id },
    adminA: { ...adminAUser, membershipId: adminA.id },
    memberA: { ...memberAUser, membershipId: memberA.id },
    ownerB: { ...ownerBUser, membershipId: ownerB.id },
    projectX,
    projectY,
    projectZ,
    memberAProjectXMembershipId: pm.id,
  };
}

/* ---------------------------------------------------------------------------------------------
 * Slice 1 factories: provenance-bearing project data.
 * ------------------------------------------------------------------------------------------- */

export async function createProvenanceRecord(
  db: Database,
  input: {
    tenantId: string;
    projectId: string;
    regime?: "HISTORICAL_OBSERVED" | "LIVE_OPERATIONAL" | "DEMO_SIMULATION";
    title?: string;
    capturedAt?: Date;
  },
): Promise<{ id: string }> {
  const id = randomUUID();
  await db.insert(appSchema.provenanceRecord).values({
    id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    regime: input.regime ?? "DEMO_SIMULATION",
    origin: "SYSTEM_GENERATED",
    transformations: ["ORIGINAL"],
    granularity: "AGGREGATE",
    title: input.title ?? `Provenance ${next()}`,
    note: "Factory record for isolation tests.",
    capturedAt: input.capturedAt ?? null,
    validationState: "PENDING",
  });
  return { id };
}

export async function createMetricSnapshot(
  db: Database,
  input: {
    tenantId: string;
    projectId: string;
    provenanceId: string;
    key?: "universe_estimated" | "surveys_complete" | "parcels_pending";
    value?: number;
  },
): Promise<{ id: string }> {
  const id = randomUUID();
  await db.insert(appSchema.metricSnapshot).values({
    id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    key: input.key ?? "universe_estimated",
    numericValue: String(input.value ?? 141),
    note: "factory",
    displayOrder: 0,
    provenanceId: input.provenanceId,
  });
  return { id };
}

/* ---------------------------------------------------------------------------------------------
 * Slice 2 factories: spatial datasets, parcels and geometry.
 *
 * Geometry is written through PostGIS (`ST_GeomFromText`) rather than as literal WKB, so the
 * tests exercise the same path the seeder uses: canonical `EPSG:4326` storage, with metres
 * measured by transforming into the dataset's own analysis CRS.
 * ------------------------------------------------------------------------------------------- */

/** A small square around a lon/lat, in degrees. Enough to be a valid, non-degenerate polygon. */
export function squareAround(lon: number, lat: number, sizeDeg = 0.002): string {
  const half = sizeDeg / 2;
  const ring = [
    [lon - half, lat - half],
    [lon + half, lat - half],
    [lon + half, lat + half],
    [lon - half, lat + half],
    [lon - half, lat - half],
  ];
  return `POLYGON((${ring.map(([x, y]) => `${x} ${y}`).join(",")}))`;
}

export async function createSpatialDatasetVersion(
  db: Database,
  input: {
    tenantId: string;
    projectId: string;
    provenanceId: string;
    kind?: "alignment" | "parcels" | "affectations";
    versionLabel?: string;
    isActive?: boolean;
    supersedesVersionId?: string | null;
    origin?: "generated" | "imported" | "field_captured";
    generatorVersion?: string | null;
    datasetId?: string;
    /** EPSG the geometry arrived in. Canonical storage by default. */
    sourceSrid?: number;
    /** Projected EPSG this dataset's metres are measured in. UTM 17S by default. */
    analysisSrid?: number;
  },
): Promise<{ id: string; datasetId: string }> {
  const kind = input.kind ?? "parcels";
  let datasetId = input.datasetId;
  if (!datasetId) {
    const existing = await db
      .select({ id: gisSchema.spatialDataset.id })
      .from(gisSchema.spatialDataset)
      .where(
        and(
          eq(gisSchema.spatialDataset.tenantId, input.tenantId),
          eq(gisSchema.spatialDataset.projectId, input.projectId),
          eq(gisSchema.spatialDataset.kind, kind),
        ),
      );
    datasetId = existing[0]?.id;
    if (!datasetId) {
      datasetId = randomUUID();
      await db.insert(gisSchema.spatialDataset).values({
        id: datasetId,
        tenantId: input.tenantId,
        projectId: input.projectId,
        kind,
        label: `Factory ${kind} ${next()}`,
      });
    }
  }
  const id = randomUUID();
  const origin = input.origin ?? "generated";
  await db.insert(gisSchema.spatialDatasetVersion).values({
    id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    datasetId,
    versionLabel: input.versionLabel ?? `${kind}_v${next()}`,
    origin,
    sourceSrid: input.sourceSrid ?? 4326,
    analysisSrid: input.analysisSrid ?? 32717,
    generatorVersion:
      input.generatorVersion === undefined
        ? origin === "generated"
          ? "corridor-generator@1"
          : null
        : input.generatorVersion,
    featureCount: 1,
    isActive: input.isActive ?? true,
    supersedesVersionId: input.supersedesVersionId ?? null,
    producedAt: new Date(),
    provenanceId: input.provenanceId,
  });
  return { id, datasetId };
}

export async function createParcelWithGeometry(
  db: Database,
  input: {
    tenantId: string;
    projectId: string;
    provenanceId: string;
    datasetVersionId: string;
    parcelCode?: string;
    lon?: number;
    lat?: number;
    isActive?: boolean;
    parcelId?: string;
    /** Where this parcel's area is measured. Defaults to UTM 17S, like the pilot. */
    analysisSrid?: number;
  },
): Promise<{ parcelId: string; geometryId: string }> {
  const parcelId = input.parcelId ?? randomUUID();
  if (!input.parcelId) {
    await db.insert(gisSchema.parcel).values({
      id: parcelId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      parcelCode: input.parcelCode ?? `PRED-FAC-${String(next()).padStart(3, "0")}`,
      sectorLabel: "Tramo 1",
      side: "left",
      status: "confirmed",
      chainageM: "100.0",
      chainageMethod: "frontage_midpoint",
      frontageM: "60.0",
      provenanceId: input.provenanceId,
    });
  }
  const wkt = squareAround(input.lon ?? -78.93, input.lat ?? -4.07);
  const analysisSrid = input.analysisSrid ?? 32717;
  const geometryId = randomUUID();
  // Canonical geometry goes in as 4326; the area is measured by transforming into the analysis
  // CRS, which is the same thing the seeder does.
  await db.execute(sql`
    insert into app.parcel_geometry
      (id, tenant_id, project_id, parcel_id, dataset_version_id, geom, area_m2, is_active,
       provenance_id)
    values (
      ${geometryId}, ${input.tenantId}, ${input.projectId}, ${parcelId}, ${input.datasetVersionId},
      ST_GeomFromText(${wkt}, 4326),
      ST_Area(ST_Transform(ST_GeomFromText(${wkt}, 4326), ${sql.raw(String(analysisSrid))})),
      ${input.isActive ?? true},
      ${input.provenanceId}
    )
  `);
  return { parcelId, geometryId };
}

/* ---------------------------------------------------------------------------------------------
 * Slice 3 factories: campaigns, assignments, visits and responses.
 * ------------------------------------------------------------------------------------------- */

export interface SeededQuestionnaire {
  readonly templateId: string;
  readonly versionId: string;
  readonly questionIds: Readonly<Record<string, string>>;
  readonly optionIds: Readonly<Record<string, string>>;
}

/**
 * A tiny published questionnaire: one single-choice question and one required boolean.
 *
 * Published through the same path the application uses — insert as DRAFT, write questions, then
 * flip to PUBLISHED — because the immutability triggers refuse edits afterwards and a factory that
 * bypassed them would be testing a database nobody runs.
 */
export async function createPublishedSurvey(
  db: Database,
  input: {
    tenantId: string;
    projectId: string;
    provenanceId: string;
    templateId?: string;
    versionLabel?: string;
    /** Option codes of the single-choice question; lets a v2 differ from a v1. */
    optionCodes?: ReadonlyArray<string>;
    questionCode?: string;
  },
): Promise<SeededQuestionnaire> {
  const templateId = input.templateId ?? randomUUID();
  if (!input.templateId) {
    await db.insert(fieldSchema.surveyTemplate).values({
      id: templateId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      key: `tmpl_${next()}`,
      name: `Cuestionario ${next()}`,
      description: null,
    });
  }

  const versionId = randomUUID();
  await db.insert(fieldSchema.surveyVersion).values({
    id: versionId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    templateId,
    versionLabel: input.versionLabel ?? `v${next()}`,
    status: "DRAFT",
    provenanceId: input.provenanceId,
  });

  const questionCode = input.questionCode ?? "tenure_category";
  const choiceId = randomUUID();
  await db.insert(fieldSchema.surveyQuestion).values({
    id: choiceId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    versionId,
    code: questionCode,
    ordinal: 0,
    type: "SINGLE_CHOICE",
    prompt: "¿Relación con el predio?",
    helpText: null,
    required: false,
    sensitivity: "NON_PERSONAL",
  });

  const optionIds: Record<string, string> = {};
  const codes = input.optionCodes ?? ["owner_occupier", "tenant"];
  for (const [ordinal, code] of codes.entries()) {
    const optionId = randomUUID();
    optionIds[code] = optionId;
    await db.insert(fieldSchema.surveyOption).values({
      id: optionId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      questionId: choiceId,
      code,
      label: code,
      ordinal,
    });
  }

  const requiredId = randomUUID();
  await db.insert(fieldSchema.surveyQuestion).values({
    id: requiredId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    versionId,
    code: "has_concern",
    ordinal: 1,
    type: "BOOLEAN",
    prompt: "¿Tiene alguna preocupación?",
    helpText: null,
    required: true,
    sensitivity: "NON_PERSONAL",
  });

  await db
    .update(fieldSchema.surveyVersion)
    .set({ status: "PUBLISHED", publishedAt: new Date(), definitionHash: `hash_${next()}` })
    .where(eq(fieldSchema.surveyVersion.id, versionId));

  return {
    templateId,
    versionId,
    questionIds: { [questionCode]: choiceId, has_concern: requiredId },
    optionIds,
  };
}

export async function createCampaign(
  db: Database,
  input: {
    tenantId: string;
    projectId: string;
    provenanceId: string;
    surveyVersionId: string;
    status?: "DRAFT" | "ACTIVE" | "CLOSED";
    name?: string;
  },
): Promise<{ id: string }> {
  const id = randomUUID();
  const status = input.status ?? "ACTIVE";
  await db.insert(fieldSchema.surveyCampaign).values({
    id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    name: input.name ?? `Campaña ${next()}`,
    surveyVersionId: input.surveyVersionId,
    status,
    captureChannel: "NATIVE_WEB",
    offlineModeAtActivation: status === "DRAFT" ? null : "disabled",
    activatedAt: status === "DRAFT" ? null : new Date(),
    provenanceId: input.provenanceId,
  });
  return { id };
}

export async function createAssignment(
  db: Database,
  input: {
    tenantId: string;
    projectId: string;
    provenanceId: string;
    campaignId: string;
    parcelId: string;
    assigneeMembershipId: string;
    assigneeUserId: string;
    status?: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  },
): Promise<{ id: string }> {
  const id = randomUUID();
  await db.insert(fieldSchema.fieldAssignment).values({
    id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    campaignId: input.campaignId,
    parcelId: input.parcelId,
    assigneeMembershipId: input.assigneeMembershipId,
    assigneeUserId: input.assigneeUserId,
    status: input.status ?? "PENDING",
    provenanceId: input.provenanceId,
  });
  return { id };
}

export async function createVisitWithInstance(
  db: Database,
  input: {
    tenantId: string;
    projectId: string;
    provenanceId: string;
    assignmentId: string;
    technicianUserId: string;
    surveyVersionId: string;
    submitted?: boolean;
  },
): Promise<{ visitId: string; instanceId: string }> {
  const visitId = randomUUID();
  await db.execute(sql`
    insert into app.field_visit
      (id, tenant_id, project_id, assignment_id, technician_user_id, status, started_at,
       completed_at, location_outcome, provenance_id)
    values (${visitId}, ${input.tenantId}, ${input.projectId}, ${input.assignmentId},
            ${input.technicianUserId}, 'COMPLETED', now(), now(), 'not_attempted',
            ${input.provenanceId})
  `);

  const instanceId = randomUUID();
  await db.insert(fieldSchema.surveyInstance).values({
    id: instanceId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    assignmentId: input.assignmentId,
    visitId,
    surveyVersionId: input.surveyVersionId,
    respondentUserId: input.technicianUserId,
    status: "IN_PROGRESS",
    provenanceId: input.provenanceId,
  });
  if (input.submitted) {
    await db
      .update(fieldSchema.surveyInstance)
      .set({ status: "SUBMITTED", submittedAt: new Date() })
      .where(eq(fieldSchema.surveyInstance.id, instanceId));
  }
  return { visitId, instanceId };
}
