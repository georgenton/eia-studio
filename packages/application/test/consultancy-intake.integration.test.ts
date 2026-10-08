import { appSchema, type Database } from "@eia/db";
import { getTestDatabase, resetDatabase } from "@eia/testing";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  consultancyManifestSchema,
  createProject,
  createTenant,
  ensureUser,
  planConsultancyIntake,
  type ConsultancyManifest,
  type IntakeSnapshot,
} from "../src/index";
import { buildRequestContext } from "../src/tenancy/request-context";

/**
 * The plan, against a database rather than against an assumption.
 *
 * The unit tests fix what the four outcomes mean. This one answers the question that only a real
 * database can: does a snapshot taken from the product, after the product has been given part of
 * the manifest **through its own use-cases**, make the second plan a no-op for exactly those
 * parts? That is the property that stops a repeated onboarding duplicating a tenant or a project.
 *
 * It runs against the throwaway Testcontainers database the suite already provisions. It never
 * touches a developer's working database, DEMO or STAGING, and it creates nothing outside the
 * tenant it makes for itself.
 */
const db = getTestDatabase();

const MANIFEST: ConsultancyManifest = consultancyManifestSchema.parse({
  manifestVersion: 1,
  consultancy: {
    name: { canonical: "Consultora de Integración" },
    tenantSlug: "consultora-integracion",
    engagementLabel: "ENCARGO SINTÉTICO",
  },
  projects: [
    { key: "via-a", name: { canonical: "Vía A" }, slug: "via-a", profileKey: "road_eia_social" },
    { key: "via-b", name: { canonical: "Vía B" }, slug: "via-b", profileKey: "road_eia_social" },
  ],
  people: [
    {
      key: "coordinadora",
      name: { canonical: "Coordinadora Sintética" },
      statedRole: "coordinadora",
      email: "coordinadora.sintetica@example.invalid",
      tenantRole: "OWNER",
    },
    {
      key: "sin-correo",
      name: { canonical: "Encuestadora Sintética" },
      statedRole: "encuestadora",
      email: null,
    },
  ],
  delivery: {
    archiveName: "entrega.zip",
    archiveSha256: "1".repeat(64),
    archiveSizeBytes: 1,
    inventoryReference: "~/.config/private/inventory.json",
    layers: [],
  },
});

/**
 * Read what the product holds, with the reads the planner needs and nothing else.
 *
 * Deliberately narrow: slugs, addresses and membership identities. It never reads a survey
 * answer, a document or anybody's personal data, because planning an onboarding has no business
 * with any of them.
 */
async function snapshot(database: Database): Promise<IntakeSnapshot> {
  const tenants = await database
    .select({ id: appSchema.tenant.id, slug: appSchema.tenant.slug })
    .from(appSchema.tenant);
  const projects = await database
    .select({ tenantId: appSchema.project.tenantId, slug: appSchema.project.slug })
    .from(appSchema.project);
  const users = await database
    .select({ id: appSchema.user.id, email: appSchema.user.email })
    .from(appSchema.user);
  const slugById = new Map(tenants.map((t) => [t.id, t.slug]));
  const byTenant: Record<string, string[]> = {};
  for (const p of projects) {
    const slug = slugById.get(p.tenantId);
    if (slug === undefined) continue;
    (byTenant[slug] ??= []).push(p.slug);
  }
  return {
    tenantSlugs: tenants.map((t) => t.slug),
    projectSlugsByTenant: byTenant,
    userEmails: users.map((u) => u.email),
    projectMemberships: [],
    importedLayerHashes: [],
  };
}

/** The identity id *is* the session subject: `ensureUser` reconciles a row, it does not mint one. */
const OWNER_SUBJECT = randomUUID();
const OWNER_EMAIL = "coordinadora.sintetica@example.invalid";

beforeAll(async () => {
  await resetDatabase(db.migrator);
  await ensureUser(db.migrator, {
    subject: OWNER_SUBJECT,
    email: OWNER_EMAIL,
    name: "Coordinadora Sintética",
    emailVerified: true,
  });
}, 180_000);

afterAll(async () => {
  await db.migrator
    .delete(appSchema.tenant)
    .where(eq(appSchema.tenant.slug, MANIFEST.consultancy.tenantSlug))
    .catch(() => undefined);
});

describe("an intake plan read against a real database", () => {
  it("proposes the whole manifest while the product is empty of it", async () => {
    const plan = planConsultancyIntake(MANIFEST, await snapshot(db.migrator));
    expect(plan.steps.find((s) => s.ref === "consultora-integracion")?.outcome).toBe(
      "would_create",
    );
    expect(plan.steps.find((s) => s.ref === "consultora-integracion/via-a")?.outcome).toBe(
      "would_create",
    );
    // The identity exists already — `ensureUser` made it — and the plan says so rather than
    // proposing a second account for the same address.
    expect(
      plan.steps.find((s) => s.ref === "coordinadora.sintetica@example.invalid")?.outcome,
    ).toBe("exists");
  });

  it("stops proposing a tenant and a project once the product's own use-cases have made them", async () => {
    await createTenant(
      db.migrator,
      { userId: OWNER_SUBJECT, requestId: randomUUID() },
      { slug: MANIFEST.consultancy.tenantSlug, name: MANIFEST.consultancy.name.canonical },
    );
    const ctx = await buildRequestContext(db.migrator, {
      sessionUser: { subject: OWNER_SUBJECT, email: OWNER_EMAIL, name: null, emailVerified: true },
      tenantSlug: MANIFEST.consultancy.tenantSlug,
      projectSlug: null,
    });
    await createProject(db.migrator, ctx, {
      slug: "via-a",
      name: "Vía A",
      profileKey: "road_eia_social",
    });

    const plan = planConsultancyIntake(MANIFEST, await snapshot(db.migrator));
    expect(plan.steps.find((s) => s.ref === "consultora-integracion")?.outcome).toBe("exists");
    expect(plan.steps.find((s) => s.ref === "consultora-integracion/via-a")?.outcome).toBe(
      "exists",
    );
    // The one the manifest still asks for, and only that one.
    expect(plan.steps.find((s) => s.ref === "consultora-integracion/via-b")?.outcome).toBe(
      "would_create",
    );
    expect(plan.counts.would_create).toBe(1);
  });

  it("never settles the person nobody has an address for", async () => {
    const plan = planConsultancyIntake(MANIFEST, await snapshot(db.migrator));
    const step = plan.steps.find((s) => s.ref === "sin-correo");
    expect(step?.outcome).toBe("requires_review");
    expect(step?.reason).toMatch(/never derived from a name/);
  });
});
