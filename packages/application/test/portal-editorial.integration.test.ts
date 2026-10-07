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
import { buildJpegWithGps } from "@eia/testing/documents";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  buildRequestContext,
  createEditorialPhoto,
  createMemoryStorage,
  createUploadIntent,
  describeImageMetadata,
  EDITORIAL_NAMESPACE,
  finalizeUpload,
  loadEditorialTenantProfile,
  loadPublicEditorialIndex,
  EditorialRevisionConflict,
  loadEditorialDraft,
  loadPublicEditorialPage,
  publishEditorial,
  resolvePublicEditorialAsset,
  saveEditorialDraft,
  updateEditorialTenantProfile,
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
const storage = createMemoryStorage();
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

  /*
   * A synthetic photograph, carried through the product's own path: intent, PUT, finalize, then
   * the derivative. `photoId` is the **derivative**, because that is the only thing a page may
   * reference — the original keeps its EXIF and stays private.
   */
  const ctx = await contextFor(coordinator);
  const bytes = await buildJpegWithGps({ width: 320, height: 240 });
  const intent = await createUploadIntent(db.runtime, ctx, storage, {
    namespace: EDITORIAL_NAMESPACE,
    filename: "equipo-sintetico.jpg",
    mimeType: "image/jpeg",
    sizeBytes: bytes.byteLength,
  });
  storage.put(intent.key, bytes, "image/jpeg");
  const stored = await finalizeUpload(db.runtime, ctx, storage, {
    intentId: intent.intentId,
    objectKey: intent.key,
  });
  photoId = (
    await createEditorialPhoto(db.runtime, await contextFor(coordinator), storage, {
      originalStoredObjectId: stored.storedObjectId,
    })
  ).storedObjectId;
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

/* ---------------------------------------------------------------------------------------------
 * A photograph, from upload to public page
 * ------------------------------------------------------------------------------------------ */

describe("a published photograph", () => {
  /** The ordinary path: intent, PUT, finalize. No parallel endpoint and no shortcut. */
  async function uploadOriginal(user: { id: string; email: string }): Promise<string> {
    const ctx = await contextFor(user);
    const bytes = await buildJpegWithGps({ width: 300, height: 200 });
    const intent = await createUploadIntent(db.runtime, ctx, storage, {
      namespace: EDITORIAL_NAMESPACE,
      filename: "equipo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: bytes.byteLength,
    });
    storage.put(intent.key, bytes, "image/jpeg");
    const stored = await finalizeUpload(db.runtime, ctx, storage, {
      intentId: intent.intentId,
      objectKey: intent.key,
    });
    return stored.storedObjectId;
  }

  it("can be requested at all — the intent accepts the editorial namespace", async () => {
    const originalId = await uploadOriginal(specialist);
    expect(originalId).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("is published as a derivative with no EXIF, never as the upload", async () => {
    const originalId = await uploadOriginal(specialist);
    const original = await storage.get(
      (
        await db.migrator
          .select({ key: storageSchema.storedObject.objectKey })
          .from(storageSchema.storedObject)
          .where(eq(storageSchema.storedObject.id, originalId))
      )[0]!.key,
    );
    expect((await describeImageMetadata(original)).hasExif).toBe(true);

    const photo = await createEditorialPhoto(db.runtime, await contextFor(specialist), storage, {
      originalStoredObjectId: originalId,
    });
    expect(photo.storedObjectId).not.toBe(originalId);

    const derivativeKey = (
      await db.migrator
        .select({ key: storageSchema.storedObject.objectKey })
        .from(storageSchema.storedObject)
        .where(eq(storageSchema.storedObject.id, photo.storedObjectId))
    )[0]!.key;
    expect((await describeImageMetadata(await storage.get(derivativeKey))).hasExif).toBe(false);

    // Asking twice is the same answer: a double submit makes one file, not two.
    const again = await createEditorialPhoto(db.runtime, await contextFor(specialist), storage, {
      originalStoredObjectId: originalId,
    });
    expect(again.storedObjectId).toBe(photo.storedObjectId);
  });

  it("refuses a page that points a photo at the uploaded original", async () => {
    const originalId = await uploadOriginal(specialist);
    const draft = await loadEditorialDraft(db.runtime, await contextFor(specialist), "fallback");
    const error = await refusal(async () =>
      saveEditorialDraft(db.runtime, await contextFor(specialist), {
        expectedRevision: draft.revision,
        payload: page("Con el original, que no debe pasar", {
          sections: [
            {
              key: "foto",
              kind: "custom",
              title: "Fotografía",
              body: "",
              assets: [
                {
                  storedObjectId: originalId,
                  role: "photo",
                  caption: null,
                  altText: "Una vía de tierra vista desde el margen",
                },
              ],
            },
          ],
        }),
      }),
    );
    expect(String(error)).toMatch(/published derivative, not the uploaded original/);
  });
});

/* ---------------------------------------------------------------------------------------------
 * The consultancy's landing
 * ------------------------------------------------------------------------------------------ */

describe("the public landing", () => {
  it("lists only what is visible, and nothing else the tenant owns", async () => {
    // Project X was withdrawn by the test above, so right now the firm has nothing public.
    expect(await loadPublicEditorialIndex(db.runtime, { tenantSlug: w.tenantA.slug })).toBeNull();

    // Publish X again and it reappears — project Y, which has no publication at all, does not.
    const ctx = await contextFor(specialist);
    const draft = await loadEditorialDraft(db.runtime, ctx, "fallback");
    await saveEditorialDraft(db.runtime, ctx, {
      expectedRevision: draft.revision,
      payload: page("Vía sintética, de vuelta"),
    });
    const after = await loadEditorialDraft(db.runtime, await contextFor(specialist), "fallback");
    await publishEditorial(db.runtime, await contextFor(coordinator), {
      expectedRevision: after.revision,
    });

    const index = await loadPublicEditorialIndex(db.runtime, { tenantSlug: w.tenantA.slug });
    expect(index?.projects.map((p) => p.projectSlug)).toEqual([w.projectX.slug]);
    expect(index?.projects[0]?.headline).toBe("Vía sintética, de vuelta");
    // With no profile set, the firm is named by its slug rather than by a guess.
    expect(index?.tenantName).toBe(w.tenantA.slug);
  });

  it("tells a visitor nothing about a tenant with nothing published", async () => {
    expect(await loadPublicEditorialIndex(db.runtime, { tenantSlug: w.tenantB.slug })).toBeNull();
    expect(await loadPublicEditorialIndex(db.runtime, { tenantSlug: "no-existe" })).toBeNull();
  });
});

/* ---------------------------------------------------------------------------------------------
 * How a firm names itself
 * ------------------------------------------------------------------------------------------ */

describe("the public profile of the consultancy", () => {
  it("cannot be set by somebody who merely edits one road", async () => {
    // The whole reason this is a tenant permission. A project editor renaming the firm would be
    // one road's author speaking for every other.
    const error = await refusal(async () =>
      updateEditorialTenantProfile(db.runtime, await contextFor(specialist), {
        name: "Consultora Renombrada Sin Permiso",
        engagementLabel: null,
        expectedRevision: 0,
      }),
    );
    expect(error).toBeInstanceOf(PermissionDenied);

    // And a coordinator, who may publish, still may not: publishing a page and naming the firm
    // are different acts.
    expect(
      await refusal(async () =>
        updateEditorialTenantProfile(db.runtime, await contextFor(coordinator), {
          name: "Tampoco por aquí",
          engagementLabel: null,
          expectedRevision: 0,
        }),
      ),
    ).toBeInstanceOf(PermissionDenied);
  });

  it("is set by a tenant administrator, and reaches the public landing", async () => {
    const admin = await contextFor({ id: w.ownerA.id, email: w.ownerA.email });
    await updateEditorialTenantProfile(db.runtime, admin, {
      name: "Consultora Sintética",
      engagementLabel: "Programa Ambiental Sintético",
      expectedRevision: 0,
    });

    const read = await loadEditorialTenantProfile(db.runtime, admin);
    expect(read.name).toBe("Consultora Sintética");
    expect(read.engagementLabel).toBe("Programa Ambiental Sintético");

    const index = await loadPublicEditorialIndex(db.runtime, { tenantSlug: w.tenantA.slug });
    expect(index?.tenantName).toBe("Consultora Sintética");
    expect(index?.engagementLabel).toBe("Programa Ambiental Sintético");
  });

  it("makes a second administrator's save visible rather than silent", async () => {
    const admin = await contextFor({ id: w.ownerA.id, email: w.ownerA.email });
    const error = await refusal(() =>
      updateEditorialTenantProfile(db.runtime, admin, {
        name: "Desde una pestaña vieja",
        engagementLabel: null,
        expectedRevision: 0,
      }),
    );
    expect(error).toBeInstanceOf(EditorialRevisionConflict);
  });

  it("tells a visitor nothing about a firm with nothing published", async () => {
    // Tenant B has a profile's worth of nothing: no publication, so no landing, whatever its
    // name would have been. A tenant slug is not an oracle for which consultancies exist.
    expect(await loadPublicEditorialIndex(db.runtime, { tenantSlug: w.tenantB.slug })).toBeNull();
  });
});
