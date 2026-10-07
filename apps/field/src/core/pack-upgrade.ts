import type { FieldPack, WorkPack } from "@eia/field-sync-contract";
import {
  FIELD_PACK_SCHEMA_VERSION,
  FIELD_PACK_SCHEMA_VERSION_V4,
  FIELD_SYNC_PROTOCOL_VERSION,
  FIELD_SYNC_PROTOCOL_VERSION_V4,
} from "@eia/field-sync-contract";

/**
 * A device that was in the field when the application was updated.
 *
 * It is holding a v3 `field_pack`: a project, a campaign, a questionnaire and its assignments.
 * The new application reads a v4 `work_pack`. The tempting move is to clear the old one and ask
 * the technician to download again — which is fine in an office and useless in a valley, where
 * the person needs to keep working with what they have.
 *
 * So the v3 pack is **converted**: the same project, the same campaign, the same assignments,
 * and an empty set of invitations, because a v3 pack never carried any. The result is marked
 * `origin: "converted"` so the application can say where it came from and so the next online
 * download replaces it with a real one.
 *
 * What conversion deliberately does **not** do is invent. There are no invitations in a v3 pack,
 * so there are none here; the validity window is the one the server stamped, not a new one this
 * device granted itself.
 */
export function workPackFromFieldPack(pack: FieldPack): WorkPack {
  return {
    schemaVersion: FIELD_PACK_SCHEMA_VERSION_V4,
    protocolVersion: FIELD_SYNC_PROTOCOL_VERSION_V4,
    technician: pack.technician,
    project: pack.project,
    surveyWork: { campaign: pack.campaign, assignments: pack.assignments },
    // A v3 pack carried none, and none is the truth until this device next reaches a server.
    socializationWork: { invitations: [] },
    // The server's own window, unchanged. A device does not extend its own offline access.
    validity: pack.validity,
    cursor: pack.cursor,
  };
}

/** Where an active project snapshot came from, for the diagnostics screen. */
export const WORK_PACK_ORIGINS = ["download", "converted"] as const;
export type WorkPackOrigin = (typeof WORK_PACK_ORIGINS)[number];

/**
 * The other direction: a v4 pack's survey half, in the shape the survey screens already read.
 *
 * ## The gap this closes
 *
 * `saveWorkPack` writes `work_pack` and `local_invitation`. The questionnaire screens read
 * `field_pack`, `local_assignment`, `local_question` and `local_option` — tables nothing in the
 * v4 path was filling. A clean installation could therefore hold a perfectly valid v4 pack with
 * `surveyWork` present and **show no surveys at all**.
 *
 * The fix is deliberately not a second writer. `saveFieldPack` already knows how to store a
 * campaign, its questions, its options and its assignments, and it is the code every existing
 * survey has been captured against; duplicating that into `repo-v4.ts` would be two
 * implementations of one table's contents, and the one that drifted would lose answers.
 *
 * So the survey half is projected back into the v3 shape and handed to the writer that works.
 * `null` when there is none — which is a shape, not a failure, and the caller's job is then to
 * make sure no *older* campaign is left looking current.
 */
export function fieldPackFromWorkPack(pack: WorkPack): FieldPack | null {
  if (pack.surveyWork === null) return null;
  return {
    // v3's own numbers: this object exists to be written by v3's writer, and labelling it v4
    // would make it fail that writer's own expectations about what it is.
    schemaVersion: FIELD_PACK_SCHEMA_VERSION,
    protocolVersion: FIELD_SYNC_PROTOCOL_VERSION,
    technician: pack.technician,
    project: pack.project,
    campaign: pack.surveyWork.campaign,
    assignments: pack.surveyWork.assignments,
    validity: pack.validity,
    cursor: pack.cursor,
  };
}
