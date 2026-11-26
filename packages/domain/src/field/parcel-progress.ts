import { z } from "zod";

/**
 * What the field work has done to a parcel, as one state a map can be coloured by.
 *
 * ## Why this is not the parcel's status
 *
 * `ParcelStatus` — confirmed, estimated, not located, excluded — is **cartographic**: it says
 * whether the geometry is trusted. Whether anybody has been to the parcel is a different fact
 * about the same object, and a palette that meant both would make *confirmado* and *con ficha*
 * the same colour on different days. Two colourings, two legends; the surface switches between
 * them and never merges them.
 *
 * ## The order, which is the whole of the logic
 *
 * A parcel can be several of these at once — assigned *and* answered *and* being corrected — so
 * the state is the **most informative** one true of it, in this order:
 *
 * | State | When | Why it wins |
 * |---|---|---|
 * | `correcting` | an open correction assignment | somebody has said the response is wrong, which is the thing a reader needs to see; a parcel that also has a submitted response is not "done" |
 * | `answered` | an effective response exists | the work arrived |
 * | `assigned` | somebody was sent, nothing arrived | the work is out |
 * | `unassigned` | nothing at all | nobody has been sent |
 *
 * `unassigned` is a **real state**, not a missing value: a parcel nobody was sent to is a fact
 * about the campaign's coverage, and it is the one a coordinator planning the next week looks
 * for. It is deliberately a different thing from *we are not allowed to tell you*, which the
 * read model reports as unavailability and the surface renders as a refusal rather than as grey.
 */
export const PARCEL_FIELD_STATES = ["answered", "correcting", "assigned", "unassigned"] as const;
export const parcelFieldStateSchema = z.enum(PARCEL_FIELD_STATES);
export type ParcelFieldState = z.infer<typeof parcelFieldStateSchema>;

/**
 * The glyph, for the same reason `PARCEL_STATUS_PRESENTATION` carries one: state is never
 * communicated by colour alone, and the mark is the same in every language so it belongs to the
 * domain. The words are in the catalogue.
 */
export interface ParcelFieldStatePresentation {
  readonly glyph: string;
}

export const PARCEL_FIELD_STATE_PRESENTATION: Readonly<
  Record<ParcelFieldState, ParcelFieldStatePresentation>
> = {
  answered: { glyph: "✓" },
  correcting: { glyph: "↺" },
  assigned: { glyph: "→" },
  unassigned: { glyph: "·" },
};

export interface ParcelFieldCounts {
  readonly assigned: number;
  readonly submitted: number;
  readonly correctionsOpen: number;
}

export function parcelFieldStateOf(counts: ParcelFieldCounts | undefined): ParcelFieldState {
  // Absent counts mean a parcel the progress query returned nothing for, which can only be a
  // parcel with no field work at all: the function returns a row per parcel of the project.
  if (counts === undefined) return "unassigned";
  if (counts.correctionsOpen > 0) return "correcting";
  if (counts.submitted > 0) return "answered";
  if (counts.assigned > 0) return "assigned";
  return "unassigned";
}
