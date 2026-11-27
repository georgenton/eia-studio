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
        /**
         * When the **position** was obtained, which is not when the shutter fired.
         *
         * The device has always sent it (`wireLocationSchema.capturedAt`) and this boundary used
         * to drop it, so the two instants collapsed into one on the server. They are genuinely
         * different: a photograph is persisted at the shutter and the platform is asked for a fix
         * afterwards, with a bounded wait. Required whenever there is a position at all — a
         * coordinate whose moment is unknown is a coordinate nobody can place in the visit.
         */
        locatedAt: z.iso.datetime(),
      })
      .strict()
      .nullable(),
    /**
     * What is known about the attempt, beyond whether a point arrived.
     *
     * Optional because the payload travels device → server: an older build does not send them and
     * `.strict()` refuses unknown fields, not absent ones. **Absent means unknown** — not "no
     * position", and never a real one. Nothing derives them from the point or from `capturedAt`.
     */
    locationOutcome: z
      .enum(["captured", "denied", "unavailable", "timed_out", "not_attempted"])
      .optional(),
    /** The platform's own flag. Every position an emulator reports is a mocked one. */
    locationMocked: z.boolean().nullable().optional(),
    locationSource: z.string().trim().min(1).max(40).nullable().optional(),
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

/**
 * Why a photograph is still on the phone — and therefore what, if anything, somebody must do.
 *
 * ## The failure this exists to end
 *
 * The device's synchronisation *skips* a photograph it cannot move yet, which is correct, and
 * until now it skipped it **silently**. On 26 November 2026 a photograph of predio 100 sat on an
 * emulator across three synchronisations while the screen said only *Pendiente de subida* — true,
 * and useless: the technician had taken it before starting the visit, so it had no visit to belong
 * to, and nothing anywhere said so. The server had no `field_media` row and no visit for that
 * parcel; the device had the file and the row. Neither end was wrong and nobody could tell.
 *
 * So the reason a photograph is held is now a value rather than an unstated branch, and the same
 * value drives the synchronisation's decision and the words on the screen. They cannot disagree.
 *
 * ## The order is the synchronisation's order
 *
 * Delivered first, because nothing else matters once the server has it. Then the position, which
 * the device may still be waiting for in this very second. Then the visit. Then a refused upload.
 * `ready` means nothing is holding it: the next connection sends it.
 */
export const MEDIA_HOLD_REASONS = [
  "delivered",
  "awaiting_location",
  "awaiting_visit",
  "upload_failed",
  "ready",
] as const;
export type MediaHoldReason = (typeof MEDIA_HOLD_REASONS)[number];

/**
 * The reasons a **person** has to act on, as opposed to the ones that resolve by themselves.
 *
 * `awaiting_visit` is the only one in this product today: a position settles on its own and a
 * refused upload is retried. Starting the visit is a decision nobody but the technician can take,
 * because it is what says they are at the parcel.
 */
export const MEDIA_HOLD_NEEDS_ACTION: ReadonlyArray<MediaHoldReason> = ["awaiting_visit"];

export function mediaHoldNeedsAction(reason: MediaHoldReason): boolean {
  return MEDIA_HOLD_NEEDS_ACTION.includes(reason);
}

export function mediaHoldReason(media: {
  readonly state: LocalMediaState;
  readonly serverMediaId: string | null;
  /** The **server's** visit id. Null until `visit.start` has been acknowledged. */
  readonly visitId: string | null;
  readonly locationOutcome:
    "pending" | "captured" | "denied" | "unavailable" | "timed_out" | "not_attempted";
  readonly attempts: number;
}): MediaHoldReason {
  if (media.serverMediaId !== null) return "delivered";
  if (media.locationOutcome === "pending") return "awaiting_location";
  if (media.visitId === null) return "awaiting_visit";
  if (media.state === "FAILED" || media.attempts > 0) return "upload_failed";
  return "ready";
}

/**
 * How long a photograph may wait for a position before the wait is written off.
 *
 * The capture's own request is bounded at twelve seconds plus whatever the permission dialog
 * takes, so anything still `pending` after two minutes is a request that is never coming back —
 * an application killed between the shutter and the answer, or a platform call that threw where
 * nothing settled the row. Before this bound existed such a row was skipped by every
 * synchronisation **for the lifetime of the process**, because the abandonment sweep deliberately
 * spares the run that is still waiting.
 *
 * Writing it off means recording `unavailable`, which is the truth: no position was obtained. It
 * never invents one.
 */
export const MEDIA_LOCATION_WAIT_LIMIT_MS = 120_000;

export function locationWaitExpired(input: {
  readonly capturedAt: string;
  readonly now: Date;
}): boolean {
  const captured = Date.parse(input.capturedAt);
  if (Number.isNaN(captured)) return true;
  return input.now.getTime() - captured >= MEDIA_LOCATION_WAIT_LIMIT_MS;
}
