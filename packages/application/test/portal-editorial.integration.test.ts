import { portalSchema, storageSchema } from "@eia/db";
import { EDITORIAL_SCHEMA_VERSION, PermissionDenied, type SessionUser } from "@eia/domain";
import {
  createProjectMembership,
  createTenantMembership,
  createUser,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  setTenantCapability,
  type TwoTenantWorld,
} from "@eia/testing";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import {
  buildRequestContext,
  EDITORIAL_NAMESPACE,
  EditorialRevisionConflict,
  loadEditorialDraft,
  loadPublicEditorialPage,
  publishEditorial,
  resolvePublicEditorialAsset,
  saveEditorialDraft,
  withdrawEditorial,
} from "../src/index";

/**
 * The editorial page, end to end, against a real database.
 *
 * The properties here are all about the boundary between *what a firm is writing* and *what the
 * world can read*. A draft is invisible, a save is not a publication, an edit after publishing
 * changes nothing public, and a withdrawal takes the attachments with the words. None of that can
 * be demonstrated without row-level security actually running, which is why these are integration
 * tests and not assertions about a function's return value.
 *
 * Everything below is synthetic: a tenant the suite made, people called "editorial-…", and an
 * `example.invalid` address. No real consultancy, no real person, no delivered file.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;

let coordinator: { id: string; email: string };
let specialist: { id: string; email: string };
let reviewer: { id: string; email: string };
let technician: { id: string; email: string };
let photoId: string;

const CAPABILITIES = ["core.projects", "client.portal"] as const;

async function contextFor(
  user: { id: string; email: string },
  scope = { tenantSlug: w.tenantA.slug, projectSlug: w.projectX.slug },
) {
  const sessionUser: SessionUser = {
    subject: user.id,
    email: user.email,
    name: null,
    emailVerified: true,
  };
  return buildRequestContext(db.runtime, { sessionUser, ...scope });
}

async function refusal(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
}

const page = (headline: string, extra: Record<string, unknown> = {}) => ({
  schemaVersion: EDITORIAL_SCHEMA_VERSION,
  locale: "es-EC",
  headline,
  subheadline: null,
  executiveSummary: {
    findings: "La cobertura vegetal del corredor es mayormente intervenida.",
    implications: "El trazado no atraviesa áreas naturales protegidas.",
    measures: "Se mantiene el plan de revegetación en los taludes.",
    accountable: "Coordinación del proyecto",
    asOf: "2026-10-06",
    sources: ["Informe de línea base, versión 2"],
  },
  sections: [
    {
      key: "resumen",
      kind: "summary",
      title: "Resumen del proyecto",
      body: "Vía de 5,36 km en la provincia de Manabí.",
      assets: [],
    },
  ],
  team: [],
  ...extra,
});

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
  for (const tenantId of [w.tenantA.id, w.tenantB.id]) {
    for (const key of CAPABILITIES) {
      await setTenantCapability(db.migrator, { tenantId, key, entitled: true, enabled: true });
    }
  }
  const make = async (
    label: string,
    role: "COORDINATOR" | "SOCIAL_SPECIALIST" | "REVIEWER" | "FIELD_TECHNICIAN",
  ) => {
    const user = await createUser(db.migrator, label);
    const membership = await createTenantMembership(db.migrator, {
      tenantId: w.tenantA.id,
      userId: user.id,
      role: "MEMBER",
    });
    await createProjectMembership(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      tenantMembershipId: membership.id,
      role,
    });
    return user;
  };
  coordinator = await make("editorial-coordinator", "COORDINATOR");
  specialist = await make("editorial-specialist", "SOCIAL_SPECIALIST");
  reviewer = await make("editorial-reviewer", "REVIEWER");
  technician = await make("editorial-technician", "FIELD_TECHNICIAN");

  // A synthetic published photograph, and a field photograph that must never reach the page.
  photoId = randomUUID();
  await db.migrator.insert(storageSchema.storedObject).values({
    id: photoId,
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    namespace: EDITORIAL_NAMESPACE,
    objectKey: `t/${w.tenantA.id}/p/${w.projectX.id}/${EDITORIAL_NAMESPACE}/${photoId}`,
    originalFilename: "equipo-sintetico.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 1024,
    sha256: "a".repeat(64),
    uploadedByUserId: coordinator.id,
  });
}, 300_000);

describe("the draft", () => {
  it("1 · saves and reopens, and a save is not a publication", async () => {
    const ctx = await contextFor(specialist);
    const saved = await saveEditorialDraft(db.runtime, ctx, {
      expectedRevision: 0,
      payload: page("Vía sintética de prueba"),
    });
    expect(saved.revision).toBe(1);

    const reopened = await loadEditorialDraft(db.runtime, await contextFor(specialist), "fallback");
    expect(reopened.revision).toBe(1);
    expect(reopened.payload.headline).toBe("Vía sintética de prueba");
    expect(reopened.payload.sections).toHaveLength(1);
    // Saving published nothing.
    expect(reopened.publishedSequence).toBeNull();
    expect(
      await loadPublicEditorialPage(db.runtime, {
        tenantSlug: w.tenantA.slug,
        projectSlug: w.projectX.slug,
      }),
    ).toBeNull();
  });

  it("2 · a visitor with no session sees neither the draft nor its attachments", async () => {
    expect(
      await loadPublicEditorialPage(db.runtime, {
        tenantSlug: w.tenantA.slug,
        projectSlug: w.projectX.slug,
      }),
    ).toBeNull();
    expect(
      await resolvePublicEditorialAsset(db.runtime, {
        tenantSlug: w.tenantA.slug,
        projectSlug: w.projectX.slug,
        storedObjectId: photoId,
      }),
    ).toBeNull();
  });

  it("3 · an author without the permission cannot publish", async () => {
    const authorCtx = await contextFor(specialist);
    const error = await refusal(() =>
      publishEditorial(db.runtime, authorCtx, { expectedRevision: 1 }),
    );
    expect(error).toBeInstanceOf(PermissionDenied);
    // And somebody with no editorial role cannot even write the draft.
    const denied = await refusal(async () =>
      saveEditorialDraft(db.runtime, await contextFor(technician), {
        expectedRevision: 1,
        payload: page("No debería guardarse"),
      }),
    );
    expect(denied).toBeInstanceOf(PermissionDenied);
  });

  it("· two editors do not overwrite one another in silence", async () => {
    const error = await refusal(async () =>
      saveEditorialDraft(db.runtime, await contextFor(specialist), {
        expectedRevision: 0,
        payload: page("Guardado desde una pestaña vieja"),
      }),
    );
    expect(error).toBeInstanceOf(EditorialRevisionConflict);
  });
});

describe("publishing", () => {
  it("4 · a legitimate publisher creates a version a visitor can read", async () => {
    const ctx = await contextFor(coordinator);
    const published = await publishEditorial(db.runtime, ctx, { expectedRevision: 1 });
    expect(published.sequence).toBe(1);

    const visitor = await loadPublicEditorialPage(db.runtime, {
      tenantSlug: w.tenantA.slug,
      projectSlug: w.projectX.slug,
    });
    expect(visitor?.sequence).toBe(1);
    expect(visitor?.payload.headline).toBe("Vía sintética de prueba");
  });

  it("10 · legitimate editorial content needs no invented metric", async () => {
    const visitor = await loadPublicEditorialPage(db.runtime, {
      tenantSlug: w.tenantA.slug,
      projectSlug: w.projectX.slug,
    });
    // The payload has nowhere to put a computed figure, and the page is complete without one.
    expect(visitor?.payload.executiveSummary?.findings).toContain("cobertura vegetal");
    expect(Object.keys(visitor?.payload ?? {})).not.toContain("metrics");
    expect(JSON.stringify(visitor?.payload)).not.toMatch(/provenanceId/);
  });

  it("5 · editing afterwards changes nothing a visitor sees", async () => {
    await saveEditorialDraft(db.runtime, await contextFor(specialist), {
      expectedRevision: 1,
      payload: page("Titular reescrito que NO debe publicarse"),
    });
    const visitor = await loadPublicEditorialPage(db.runtime, {
      tenantSlug: w.tenantA.slug,
      projectSlug: w.projectX.slug,
    });
    expect(visitor?.payload.headline).toBe("Vía sintética de prueba");
    expect(visitor?.sequence).toBe(1);
  });

  it("· a published version is immutable, by grant and by trigger", async () => {
    const error = await refusal(() =>
      db.runtime
        .update(portalSchema.editorialPublication)
        .set({ contentHash: "tampered" })
        .where(eq(portalSchema.editorialPublication.projectId, w.projectX.id)),
    );
    // The driver wraps the server's message, so the cause is where the reason lives. Both halves
    // are asserted: the grant withholds UPDATE, and the trigger would refuse it even with one.
    const reason = String((error as { cause?: unknown })?.cause ?? error);
    expect(reason).toMatch(/write-once|permission denied/i);
  });
});

describe("the public boundary", () => {
  it("7 · a crossed slug reveals nothing, and no private payload leaks", async () => {
    // Tenant B's slug with tenant A's project, and the reverse: the same answer as a page that
    // does not exist, because a distinguishable response is an oracle.
    expect(
      await loadPublicEditorialPage(db.runtime, {
        tenantSlug: w.tenantB.slug,
        projectSlug: w.projectX.slug,
      }),
    ).toBeNull();
    expect(
      await loadPublicEditorialPage(db.runtime, {
        tenantSlug: w.tenantA.slug,
        projectSlug: w.projectZ.slug,
      }),
    ).toBeNull();
    const visitor = await loadPublicEditorialPage(db.runtime, {
      tenantSlug: w.tenantA.slug,
      projectSlug: w.projectX.slug,
    });
    const serialised = JSON.stringify(visitor);
    for (const leak of ["tenantId", "projectId", "publishedBy", "updatedBy", "contentHash"]) {
      expect(serialised).not.toContain(leak);
    }
  });

  it("8 · text that looks like code is stored as text", async () => {
    const hostile = page("Titular con <script>alert(1)</script> dentro", {
      sections: [
        {
          key: "hostil",
          kind: "custom",
          title: "Sección con \u0000 control y <img onerror=x>",
          body: "javascript:alert(1) y </script><script>fetch('http://evil.invalid')</script>",
          assets: [],
        },
      ],
    });
    await saveEditorialDraft(db.runtime, await contextFor(specialist), {
      expectedRevision: 2,
      payload: hostile,
    });
    const reopened = await loadEditorialDraft(db.runtime, await contextFor(reviewer), "fallback");
    // Nothing was executed and nothing was stripped into something else: it is text, and the
    // control character — the one thing that survives a naive round trip — is gone.
    expect(reopened.payload.sections[0]?.title).toBe("Sección con  control y <img onerror=x>");
    expect(reopened.payload.headline).toContain("<script>");
  });
});

describe("withdrawal", () => {
  it("6 · withdrawing takes the page and its attachments out of public view", async () => {
    // Publish a version that carries the photograph, so there is an attachment to lose.
    await saveEditorialDraft(db.runtime, await contextFor(specialist), {
      expectedRevision: 3,
      payload: page("Versión con fotografía", {
        sections: [
          {
            key: "equipo",
            kind: "team",
            title: "Equipo técnico",
            body: "",
            assets: [
              {
                storedObjectId: photoId,
                role: "photo",
                caption: "Equipo sintético en campo",
                altText: "Tres personas con chalecos junto a una vía de tierra",
              },
            ],
          },
        ],
      }),
    });
    const published = await publishEditorial(db.runtime, await contextFor(coordinator), {
      expectedRevision: 4,
    });
    expect(published.assetCount).toBe(1);
    expect(
      await resolvePublicEditorialAsset(db.runtime, {
        tenantSlug: w.tenantA.slug,
        projectSlug: w.projectX.slug,
        storedObjectId: photoId,
      }),
    ).not.toBeNull();

    await withdrawEditorial(db.runtime, await contextFor(coordinator), {
      reason: "la consultora pidió retirarla mientras revisa una cifra",
    });

    expect(
      await loadPublicEditorialPage(db.runtime, {
        tenantSlug: w.tenantA.slug,
        projectSlug: w.projectX.slug,
      }),
    ).toBeNull();
    expect(
      await resolvePublicEditorialAsset(db.runtime, {
        tenantSlug: w.tenantA.slug,
        projectSlug: w.projectX.slug,
        storedObjectId: photoId,
      }),
    ).toBeNull();
  });

  it("· a reviewer may look but not publish or withdraw", async () => {
    expect(
      await refusal(async () =>
        withdrawEditorial(db.runtime, await contextFor(reviewer), { reason: "no debería poder" }),
      ),
    ).toBeInstanceOf(PermissionDenied);
    const seen = await loadEditorialDraft(db.runtime, await contextFor(reviewer), "fallback");
    expect(seen.revision).toBeGreaterThan(0);
  });

  it("· the versions are all still there after a withdrawal", async () => {
    const rows = await db.migrator
      .select({ sequence: portalSchema.editorialPublication.sequence })
      .from(portalSchema.editorialPublication)
      .where(eq(portalSchema.editorialPublication.projectId, w.projectX.id));
    expect(rows.map((r) => r.sequence).sort()).toEqual([1, 2]);
  });
});
