import { z } from "zod";

import { InvalidInput } from "../core/errors";

/**
 * A photograph a technician took, and the four places it must never go.
 *
 * ## What field media is
 *
 * Evidence of a visit: the parcel, what the works would affect, how the place is reached. It is
 * captured on a phone, often with no signal, and it belongs to the visit that produced it.
 *
 * ## Why the vocabulary is this short, and what is missing from it
 *
 * There is no `document` kind and no `signature` kind. Photographing an identity card, a deed or a
 * signed attendance sheet produces **identified personal data** — a name, a number, a handwriting
 * sample — and the compliance gate of SECURITY.md §10a has not authorised collecting any. A kind
 * for it would be a field somebody fills in, and the honest way to not collect something is to
 * have nowhere to put it (the same argument the classifier's input type makes for respondents).
 *
 * A photograph of a parcel can still contain a person, a house number or a number plate. That is
 * why media inherits the row-ownership rule of survey responses rather than ordinary project
 * access: `field.responses.read`, or it is your own.
 *
 * ## The four prohibitions
 *
 * Field media must never *automatically* enter the client portal, an AI provider, the document
 * corpus, or a public map. Each is prevented by structure rather than by a rule somebody has to
 * remember, and `packages/domain/test/field-media.test.ts` asserts each one:
 *
 * | Where | What stops it |
 * |---|---|
 * | Client portal | the publication payload is *composed* from a closed vocabulary that has nowhere to put a photograph, an object key or a file (ADR-027) |
 * | AI provider | the classifier's input carries text and a taxonomy, and the assistant reads `document_chunk`. Neither type can hold an image |
 * | Document corpus | `uploadDocumentVersion` refuses a stored object whose namespace is `field-media` — a namespace is what a file *is*, not who can see it (ADR-031) |
 * | Public maps | a map layer comes from a `SpatialDatasetVersion`; media has no geometry column and is not a layer |
 *
 * What a person may do deliberately is a separate question, and the answer today is *nothing*:
 * there is no export, no attach-to-report and no publish. When one is built it will be an explicit,
 * audited, permission-guarded act, which is the opposite of automatic.
 */
export const FIELD_MEDIA_KINDS = ["parcel", "affectation", "access", "other"] as const;
export type FieldMediaKind = (typeof FIELD_MEDIA_KINDS)[number];

/* A kind's words are `vocabulary.mediaKind.*` in `@eia/i18n` (ADR-029). */

/**
 * What the **device** believes about one photograph. The server has no such column.
 *
 * `PENDING_UPLOAD` is the state a file is in the moment the shutter closes, and it is the state
 * that must survive a battery dying, an application being force-quit and a week with no signal.
 * `UPLOADED` is the only state in which the local file may be deleted, and it is set from the
 * server's answer — never from "the PUT returned 200", because the bytes being in a bucket is not
 * the same fact as the row existing.
 */
export const LOCAL_MEDIA_STATES = ["PENDING_UPLOAD", "UPLOADING", "UPLOADED", "FAILED"] as const;
export type LocalMediaState = (typeof LOCAL_MEDIA_STATES)[number];

/**
 * Whether the local copy of a photograph may be deleted.
 *
 * One predicate, used by the device's retention sweep and asserted by its tests, because the
 * failure it prevents is the one that cannot be undone: a technician's only copy of a photograph
 * removed because an upload *looked* finished. Only the server's own acknowledgement — the media
 * row exists, by id — releases it.
 */
export function mayDeleteLocalFile(media: {
  readonly state: LocalMediaState;
  readonly serverMediaId: string | null;
}): boolean {
  return media.state === "UPLOADED" && media.serverMediaId !== null;
}

/**
 * The declaration a device sends once the bytes are stored.
 *
 * `localId` is minted on the device at capture and never regenerated, exactly like `commandId`:
 * it is what makes a retry one photograph rather than two. The server keys the media row on it,
 * so the idempotency does not depend on the sync receipt alone — a device that lost its outbox but
 * kept its gallery still cannot produce a duplicate.
 */
export const fieldMediaDeclarationSchema = z
  .object({
    assignmentId: z.uuid(),
    visitId: z.uuid(),
    /** Minted on the device at the moment of capture. Stable across every retry. */
    localId: z.uuid(),
    /** The upload this product issued and verified. Never a key the device chose. */
    storedObjectId: z.uuid(),
    kind: z.enum(FIELD_MEDIA_KINDS),
    /** The device's clock, recorded as what the device believed — never the workflow's time. */
    capturedAt: z.iso.datetime(),
    /** What the technician wrote about the photograph. Bounded; never a place for a name. */
    note: z.string().trim().max(300).nullable(),
    /**
     * Where the **technician** was, not where a household is — the same distinction a visit makes.
     * Absent when the device had no fix, and never fabricated.
     */
    location: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        accuracyM: z.number().positive().max(100_000).nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type FieldMediaDeclaration = z.infer<typeof fieldMediaDeclarationSchema>;

export function parseFieldMediaDeclaration(input: unknown): FieldMediaDeclaration {
  const parsed = fieldMediaDeclarationSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidInput(parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  return parsed.data;
}

/**
 * How many photographs one visit may carry.
 *
 * A bound rather than a policy: a device looping on a broken retry should cost a refusal and not a
 * bucket. Generous enough that no honest visit meets it — a technician photographing a frontage,
 * an access and three affected areas is nowhere near.
 */
export const MAX_MEDIA_PER_VISIT = 40;

export function assertVisitMediaWithinLimit(existingCount: number): void {
  if (existingCount >= MAX_MEDIA_PER_VISIT) {
    throw new InvalidInput(
      `a visit may carry at most ${MAX_MEDIA_PER_VISIT} photographs; this one already has ${existingCount}`,
    );
  }
}
