import { PROJECT_ROLES, TENANT_ROLES } from "@eia/domain";
import { z } from "zod";

/**
 * Taking a consultancy's own delivery and planning what the product would have to create
 * (Visión Ambiental, block 1).
 *
 * ## Why a manifest and not a seeder
 *
 * A seeder is a program that knows the answer. An onboarding does not have one: the delivery
 * arrives with a consultancy's spelling of its own roads, a team whose email addresses nobody has
 * yet confirmed, and cartography that may or may not be in a form this product can read. So the
 * manifest is **data outside the code** — one file per engagement — and this module is the part
 * that reads it and says what it would do.
 *
 * ## What `plan` is, and what it is not
 *
 * A **pure** function over the manifest and a snapshot of what already exists. It performs no
 * write, opens no transaction and reaches no network: the caller supplies the snapshot and
 * decides, separately and explicitly, whether to apply anything. That ordering is the whole
 * point — the first run of an onboarding should be readable, not consequential.
 *
 * Four outcomes, and the two that are not "yes" carry the reason:
 *
 * - `would_create` — the product has nowhere this belongs yet, and the manifest says enough.
 * - `exists` — already present, by stable identifier. Re-planning is therefore idempotent: a
 *   second run of the same manifest proposes nothing, which is what stops a repeated load
 *   duplicating projects or memberships.
 * - `requires_review` — the manifest deliberately does not say. A pending email address is not a
 *   defect to fill in with a guess; it is the one thing nobody may invent, because an invented
 *   address is an invitation sent to a stranger.
 * - `not_supported` — the delivery contains something this product has no path for. A rendered
 *   map sheet is not a layer, and calling it one would produce cartography nobody could query.
 */

/* ---------------------------------------------------------------------------------------------
 * The manifest
 * ------------------------------------------------------------------------------------------ */

/** A name as the consultancy wrote it, plus every other spelling the delivery used for it. */
const deliveredName = z
  .object({
    /** The spelling this product will show. Chosen by the owner, never normalised here. */
    canonical: z.string().min(1),
    /**
     * Other spellings seen in the delivery. Kept rather than resolved: two spellings of one
     * person are one person, and a manifest that silently picked one would lose the evidence
     * that the question was ever open.
     */
    variants: z.array(z.string().min(1)).default([]),
  })
  .strict();

const stableKey = z
  .string()
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "must be a lowercase slug")
  .min(2)
  .max(64);

export const consultancyPersonSchema = z
  .object({
    /** Stable within the manifest, so a re-plan matches the same person after a spelling fix. */
    key: stableKey,
    name: deliveredName,
    /** The consultancy's own words for what this person does. Not a role. */
    statedRole: z.string().min(1),
    /**
     * `null` means **not confirmed**, and the planner refuses to invent one. Deriving an address
     * from a name is how an onboarding emails somebody who never agreed to be in the system.
     */
    email: z.string().email().nullable(),
    /** `null` when nobody has decided, which is the normal state of a fresh onboarding. */
    tenantRole: z.enum(TENANT_ROLES).nullable().default(null),
    /** Per-project assignment. An empty list is a decision nobody has taken yet, not "all". */
    projectRoles: z
      .array(z.object({ projectKey: stableKey, role: z.enum(PROJECT_ROLES) }).strict())
      .default([]),
    /** Anything the owner must settle before this person is created. Free text, shown verbatim. */
    openQuestions: z.array(z.string().min(1)).default([]),
  })
  .strict();

/** How a delivered file maps onto something the product can hold. Explicit, never inferred. */
export const deliveredLayerSchema = z
  .object({
    /** Path inside the delivered archive, as delivered. */
    path: z.string().min(1),
    projectKey: stableKey.nullable(),
    /**
     * What the file actually is. `map_sheet` is a rendered image or PDF of a map: it carries no
     * geometry, so it is **not** cartography this product can query, however much it looks like
     * a map on screen.
     */
    kind: z.enum(["vector_layer", "raster_layer", "map_sheet", "spreadsheet", "unknown"]),
    /** Declared CRS, or `null`. Never guessed: a wrong SRID is silently wrong geometry. */
    declaredCrs: z.string().min(1).nullable(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    sizeBytes: z.number().int().nonnegative(),
    note: z.string().nullable().default(null),
  })
  .strict();

export const consultancyManifestSchema = z
  .object({
    manifestVersion: z.literal(1),
    consultancy: z
      .object({
        name: deliveredName,
        tenantSlug: stableKey,
        /**
         * The engagement the roads belong to. A label, deliberately: this product has no entity
         * between a tenant and a project, and inventing one to hold a title would be a schema
         * change in service of a heading.
         */
        engagementLabel: z.string().min(1),
      })
      .strict(),
    projects: z
      .array(
        z
          .object({
            key: stableKey,
            /** The consultancy's spelling, preserved exactly — accents, spacing and all. */
            name: deliveredName,
            slug: stableKey,
            profileKey: z.string().min(1),
            /** Facts read from the delivery, not computed. */
            attributes: z.record(z.string(), z.string()).default({}),
            openQuestions: z.array(z.string().min(1)).default([]),
          })
          .strict(),
      )
      .min(1),
    people: z.array(consultancyPersonSchema).default([]),
    delivery: z
      .object({
        archiveName: z.string().min(1),
        archiveSha256: z.string().regex(/^[0-9a-f]{64}$/),
        archiveSizeBytes: z.number().int().positive(),
        /** Where the private inventory lives. Never a path inside the repository. */
        inventoryReference: z.string().min(1),
        layers: z.array(deliveredLayerSchema).default([]),
      })
      .strict(),
    /** Everything this manifest refuses to decide. Rendered by the planner, not hidden. */
    openDecisions: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type ConsultancyManifest = z.infer<typeof consultancyManifestSchema>;

/* ---------------------------------------------------------------------------------------------
 * The snapshot and the plan
 * ------------------------------------------------------------------------------------------ */

/** What already exists, as the caller observed it. An empty snapshot means nothing was checked. */
export interface IntakeSnapshot {
  readonly tenantSlugs: ReadonlyArray<string>;
  readonly projectSlugsByTenant: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly userEmails: ReadonlyArray<string>;
  /** `tenantSlug/projectSlug/email`, lowercased: the identity of a project membership. */
  readonly projectMemberships: ReadonlyArray<string>;
  /** Hashes of dataset versions already imported, so the same bytes are never imported twice. */
  readonly importedLayerHashes: ReadonlyArray<string>;
}

export const EMPTY_SNAPSHOT: IntakeSnapshot = {
  tenantSlugs: [],
  projectSlugsByTenant: {},
  userEmails: [],
  projectMemberships: [],
  importedLayerHashes: [],
};

export type IntakeOutcome = "would_create" | "exists" | "requires_review" | "not_supported";

export interface IntakeStep {
  readonly kind: "tenant" | "project" | "user" | "project_membership" | "layer";
  /** Stable within a plan, so two runs can be compared line by line. */
  readonly ref: string;
  readonly outcome: IntakeOutcome;
  /** Why, in the owner's language. Always present for anything that is not `would_create`. */
  readonly reason: string | null;
}

export interface IntakePlan {
  readonly steps: ReadonlyArray<IntakeStep>;
  readonly counts: Readonly<Record<IntakeOutcome, number>>;
  readonly openDecisions: ReadonlyArray<string>;
  /** True when nothing in the plan would write. The first run should look like this. */
  readonly nothingToDo: boolean;
}

/** The formats the product can actually hold as queryable cartography today. */
const IMPORTABLE_LAYER_KINDS = new Set(["vector_layer", "raster_layer"]);

export function plan(manifest: ConsultancyManifest, snapshot: IntakeSnapshot): IntakePlan {
  const steps: IntakeStep[] = [];
  const tenant = manifest.consultancy.tenantSlug;
  const projects = new Set(snapshot.projectSlugsByTenant[tenant] ?? []);
  const emails = new Set(snapshot.userEmails.map((e) => e.toLowerCase()));
  const memberships = new Set(snapshot.projectMemberships.map((m) => m.toLowerCase()));
  const hashes = new Set(snapshot.importedLayerHashes);
  const projectSlugByKey = new Map(manifest.projects.map((p) => [p.key, p.slug]));

  steps.push({
    kind: "tenant",
    ref: tenant,
    outcome: snapshot.tenantSlugs.includes(tenant) ? "exists" : "would_create",
    reason: snapshot.tenantSlugs.includes(tenant)
      ? "a tenant with this slug is already here"
      : null,
  });

  for (const project of manifest.projects) {
    const exists = projects.has(project.slug);
    steps.push({
      kind: "project",
      ref: `${tenant}/${project.slug}`,
      outcome: exists
        ? "exists"
        : project.openQuestions.length > 0
          ? "requires_review"
          : "would_create",
      reason: exists
        ? "a project with this slug is already here"
        : project.openQuestions.length > 0
          ? project.openQuestions.join("; ")
          : null,
    });
  }

  for (const person of manifest.people) {
    if (person.email === null) {
      steps.push({
        kind: "user",
        ref: person.key,
        outcome: "requires_review",
        reason: "no confirmed email address; an address is never derived from a name",
      });
    } else {
      const exists = emails.has(person.email.toLowerCase());
      steps.push({
        kind: "user",
        ref: person.email,
        outcome: exists ? "exists" : "would_create",
        reason: exists ? "an identity with this address is already here" : null,
      });
    }

    for (const assignment of person.projectRoles) {
      const slug = projectSlugByKey.get(assignment.projectKey);
      if (slug === undefined) {
        steps.push({
          kind: "project_membership",
          ref: `${person.key}@${assignment.projectKey}`,
          outcome: "requires_review",
          reason: `names a project key this manifest does not define: ${assignment.projectKey}`,
        });
        continue;
      }
      if (person.email === null) {
        steps.push({
          kind: "project_membership",
          ref: `${person.key}@${slug}`,
          outcome: "requires_review",
          reason: "the person has no confirmed address, so there is nobody to assign yet",
        });
        continue;
      }
      const ref = `${tenant}/${slug}/${person.email.toLowerCase()}`;
      steps.push({
        kind: "project_membership",
        ref,
        outcome: memberships.has(ref) ? "exists" : "would_create",
        reason: memberships.has(ref) ? "this person already holds a role on this project" : null,
      });
    }
  }

  for (const layer of manifest.delivery.layers) {
    if (!IMPORTABLE_LAYER_KINDS.has(layer.kind)) {
      steps.push({
        kind: "layer",
        ref: layer.path,
        outcome: "not_supported",
        // Named rather than skipped: a delivery whose cartography is unusable is a finding the
        // consultancy has to hear, not a row to drop quietly.
        reason:
          layer.kind === "map_sheet"
            ? "a rendered map sheet carries no geometry; the product cannot hold it as cartography"
            : `the product has no import path for ${layer.kind}`,
      });
      continue;
    }
    if (hashes.has(layer.sha256)) {
      steps.push({
        kind: "layer",
        ref: layer.path,
        outcome: "exists",
        reason: "these exact bytes have already been imported as a dataset version",
      });
      continue;
    }
    if (layer.declaredCrs === null || layer.projectKey === null) {
      steps.push({
        kind: "layer",
        ref: layer.path,
        outcome: "requires_review",
        reason:
          layer.declaredCrs === null
            ? "no declared CRS; an assumed SRID is silently wrong geometry"
            : "no project named; a layer is never attributed to a road by name resemblance",
      });
      continue;
    }
    steps.push({ kind: "layer", ref: layer.path, outcome: "would_create", reason: null });
  }

  const counts: Record<IntakeOutcome, number> = {
    would_create: 0,
    exists: 0,
    requires_review: 0,
    not_supported: 0,
  };
  for (const step of steps) counts[step.outcome] += 1;

  return {
    steps,
    counts,
    openDecisions: manifest.openDecisions,
    nothingToDo: counts.would_create === 0,
  };
}
