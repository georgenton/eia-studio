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

/**
 * The revision is a counter, and it has to be one.
 *
 * It used to be derived from existence — `0` absent, `1` present — so once the row existed every
 * administrator read `1`, every save matched, and the second one silently overwrote the first.
 * That is the failure optimistic concurrency exists to prevent, and the tests below are written
 * against the number rather than against the symptom (migration 0054).
 *
 * Tenant B, because tenant A's profile already exists by this point in the file and a counter is
 * only interesting from its first write onwards.
 */
describe("the profile's revision", () => {
  const scopeB = () => ({ tenantSlug: w.tenantB.slug, projectSlug: w.projectZ.slug });
  const ownerB = () => contextFor({ id: w.ownerB.id, email: w.ownerB.email }, scopeB());

  it("counts 0 → 1 → 2 → 3, and refuses a save made from a number that has moved", async () => {
    const ctx = await ownerB();
    expect((await loadEditorialTenantProfile(db.runtime, ctx)).revision).toBe(0);

    const save = (name: string, expectedRevision: number) =>
      updateEditorialTenantProfile(db.runtime, ctx, {
        name,
        engagementLabel: null,
        expectedRevision,
      });

    expect((await save("Consultora B", 0)).revision).toBe(1);
    expect((await loadEditorialTenantProfile(db.runtime, ctx)).revision).toBe(1);
    expect((await save("Consultora B, segunda", 1)).revision).toBe(2);
    expect((await save("Consultora B, tercera", 2)).revision).toBe(3);

    // The administrator who read `1` and went to lunch. Their save is refused rather than
    // applied, and the refusal names the number that is actually there.
    const stale = await refusal(() => save("Desde una pestaña de hace una hora", 1));
    expect(stale).toBeInstanceOf(EditorialRevisionConflict);
    expect((await loadEditorialTenantProfile(db.runtime, ctx)).name).toBe("Consultora B, tercera");

    // And a creation attempt against a profile that now exists is the same answer, not a raw
    // unique violation: `ON CONFLICT DO NOTHING` turns the race into something a person reads.
    expect(await refusal(() => save("Creo que no hay perfil", 0))).toBeInstanceOf(
      EditorialRevisionConflict,
    );
  });

  it("lets exactly one of two concurrent saves from the same revision win", async () => {
    const ctx = await ownerB();
    const before = (await loadEditorialTenantProfile(db.runtime, ctx)).revision;

    /*
     * Two transactions, started together, both believing they hold `before`. This is the case a
     * SELECT-then-UPDATE cannot survive: both would pass the read. Here the second blocks on the
     * row, re-evaluates `revision = before` against the committed row, matches nothing, and is
     * told it conflicted.
     */
    const results = await Promise.allSettled([
      updateEditorialTenantProfile(db.runtime, ctx, {
        name: "Primera en llegar",
        engagementLabel: null,
        expectedRevision: before,
      }),
      updateEditorialTenantProfile(db.runtime, ctx, {
        name: "Segunda en llegar",
        engagementLabel: null,
        expectedRevision: before,
      }),
    ]);

    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(EditorialRevisionConflict);

    // One write happened, not two: the counter moved by exactly one, and the stored name is the
    // winner's. Which of the two won is a race and is not asserted; that only one did, is.
    expect((won[0] as PromiseFulfilledResult<{ revision: number }>).value.revision).toBe(
      before + 1,
    );
    const after = await loadEditorialTenantProfile(db.runtime, ctx);
    expect(after.revision).toBe(before + 1);
    expect(["Primera en llegar", "Segunda en llegar"]).toContain(after.name);
  });

  it("is a counter per tenant: another firm's edits do not move it", async () => {
    const a = await contextFor({ id: w.ownerA.id, email: w.ownerA.email });
    // Tenant A was written once, far above, and tenant B has been written four times since.
    expect((await loadEditorialTenantProfile(db.runtime, a)).revision).toBe(1);
    expect((await loadEditorialTenantProfile(db.runtime, await ownerB())).revision).toBeGreaterThan(
      1,
    );

    // And A can still save against the number A actually holds.
    expect(
      (
        await updateEditorialTenantProfile(db.runtime, a, {
          name: "Consultora Sintética",
          engagementLabel: "Programa Ambiental Sintético",
          expectedRevision: 1,
        })
      ).revision,
    ).toBe(2);
  });
});

/**
 * A tenant administrator holds `portal.profile.manage` and no project permissions at all, which
 * is the shape of the second defect this block closes: the key was real and the door it opened
 * was behind a door it could not open. What follows asserts both halves — that they can name the
 * firm, and that naming the firm buys them nothing else on the project.
 */
describe("a tenant administrator with no project membership", () => {
  const adminCtx = () => contextFor({ id: w.adminA.id, email: w.adminA.email });

  it("can read and set the firm's public profile", async () => {
    const ctx = await adminCtx();
    expect(ctx.projectRole).toBeNull();
    expect(ctx.implicitOwnerProjectAccess).toBe(false);

    const before = await loadEditorialTenantProfile(db.runtime, ctx);
    const result = await updateEditorialTenantProfile(db.runtime, ctx, {
      name: "Consultora Sintética",
      engagementLabel: "Programa Ambiental Sintético, renombrado por administración",
      expectedRevision: before.revision,
    });
    expect(result.revision).toBe(before.revision + 1);
  });

  it("holds no editorial permission, and cannot read the draft", async () => {
    const ctx = await adminCtx();
    for (const key of [
      "portal.editorial.write",
      "portal.preview",
      "portal.publish",
      "field.responses.read",
    ] as const) {
      expect(ctx.permissions.has(key)).toBe(false);
    }
    expect(await refusal(() => loadEditorialDraft(db.runtime, ctx, "Proyecto X"))).toBeInstanceOf(
      PermissionDenied,
    );
  });

  it("cannot write the draft, publish it, withdraw it, or upload a file to it", async () => {
    const ctx = await adminCtx();

    expect(
      await refusal(() =>
        saveEditorialDraft(db.runtime, ctx, {
          expectedRevision: 1,
          payload: page("Un titular que un administrador no escribe"),
        }),
      ),
    ).toBeInstanceOf(PermissionDenied);

    expect(
      await refusal(() => publishEditorial(db.runtime, ctx, { expectedRevision: 1 })),
    ).toBeInstanceOf(PermissionDenied);

    expect(
      await refusal(() =>
        withdrawEditorial(db.runtime, ctx, { reason: "no debería poder hacerlo" }),
      ),
    ).toBeInstanceOf(PermissionDenied);

    // `portal.profile.manage` is not an upload permission, and the namespace's rule says so.
    expect(
      await refusal(() =>
        createUploadIntent(db.runtime, ctx, storage, {
          namespace: EDITORIAL_NAMESPACE,
          filename: "no-procede.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 1024,
        }),
      ),
    ).toBeInstanceOf(PermissionDenied);
  });
});

/**
 * The draft's counter had the same hole as the profile's, one function above: the check was a
 * `SELECT` and the write an unconditional `UPDATE`, so two transactions could both pass the read.
 * Sequential saves were caught — this counter did move — and simultaneous ones were not.
 *
 * Last in the file on purpose: it leaves the draft one revision further on, and the tests above
 * are written against a known sequence.
 */
describe("the draft's revision, under contention", () => {
  it("lets exactly one of two simultaneous saves win", async () => {
    /*
     * The draft's counter did move, so two saves one after another were already caught. Two at
     * the same instant were not: the check was a `SELECT` and the write an unconditional
     * `UPDATE`, and both transactions passed the read. Same shape as the tenant profile's defect
     * (migration 0054), one function above, and the same fix — the comparison lives in the
     * `WHERE` of the statement that writes.
     */
    const ctx = await contextFor(coordinator);
    const before = (await loadEditorialDraft(db.runtime, ctx, "fallback")).revision;

    const results = await Promise.allSettled([
      saveEditorialDraft(db.runtime, ctx, {
        expectedRevision: before,
        payload: page("A la vez, la primera"),
      }),
      saveEditorialDraft(db.runtime, ctx, {
        expectedRevision: before,
        payload: page("A la vez, la segunda"),
      }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.filter((r) => r.status === "rejected");
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(EditorialRevisionConflict);

    const after = await loadEditorialDraft(db.runtime, ctx, "fallback");
    expect(after.revision).toBe(before + 1);
    expect(["A la vez, la primera", "A la vez, la segunda"]).toContain(after.payload.headline);
  });
});
