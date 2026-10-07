import type { FieldPack, WorkPack } from "@eia/field-sync-contract";
import {
  FIELD_PACK_SCHEMA_VERSION_V4,
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
