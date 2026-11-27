import { z } from "zod";

/**
 * The cartographic resource a technician's device may hold, as a **separate** resource.
 *
 * ## Why not a field on the pack
 *
 * `packParcelContextSchema` is `.strict()` and carries a code, a sector, an abscissa label and a
 * side — deliberately no geometry. Adding one would be a parse error on every installed build,
 * because the pack travels *server → device* and the device holds the strict schema. That is the
 * direction where growth costs a version, and the brief's own instruction was to choose a
 * compatible extension or a separate, limited resource.
 *
 * This is the separate resource. It has its own endpoint, its own version, and its own schema; a
 * build that does not know about it simply never asks, and the pack it already understands is
 * unchanged byte for byte.
 *
 * ## What it is limited to
 *
 * The geometry a technician needs **to find the parcels they were assigned**, and nothing else:
 *
 * - the parcels of *their own* assignments, by the row-level policy rather than by a filter;
 * - the axis, as context, simplified to what a phone screen can draw;
 * - the kilometre posts, each with its place;
 * - where the numbering starts and whether anybody declared it.
 *
 * There is nowhere in it to put a survey answer, another technician's work, a respondent, an owner,
 * a household's position or a photograph. The absence is structural: those fields do not exist.
 *
 * ## What a parcel's place means
 *
 * `polygon` is the parcel's own boundary as the cartography holds it. `reference_point` is a
 * **derived** point — a centroid — for a parcel whose boundary is not available or is too large to
 * send, and it is named that way on purpose: it is somewhere inside the parcel, not its entrance,
 * not a dwelling, and nothing on the device presents it as either.
 */
export const FIELD_MAP_SCHEMA_VERSION = 1;

/**
 * What a build that understands multi-part parcels and holes asks for.
 *
 * ## Why a second version rather than a field
 *
 * `fieldMapResponseSchema` is `.strict()` **and** pins `schemaVersion` to a literal, and the
 * device holds that schema. Adding `parts` to the response would be an unknown key on every
 * installed build; bumping the literal would be a parse error on every installed build. Either
 * way the map stops working on the phones already in people's hands.
 *
 * So the device says what it can read, in the **request** — the direction where an *optional*
 * field costs nothing, because `.strict()` refuses unknown keys and not absent ones — and the
 * server answers in that version. A build that says nothing gets version 1, byte for byte what it
 * gets today.
 */
export const FIELD_MAP_SCHEMA_VERSION_PARTS = 2;

const uuid = z.string().uuid();
const instant = z.iso.datetime();

/** A longitude/latitude pair in EPSG:4326, the one CRS this product stores and every map consumes. */
export const mapPositionSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
export type MapPosition = z.infer<typeof mapPositionSchema>;

/**
 * One piece of a parcel: its outer ring and the holes inside it.
 *
 * A parcel is not always one ring. Twenty of the study's 141 are multi-part, and a ring can
 * enclose a hole — a right of way, an excluded plot. Version 1 of this contract sent a single
 * outer ring, which means a device drew **one piece of a multi-part parcel as if it were the
 * whole parcel**, and drew a hole as solid ground. Neither is a rounding error: a technician
 * sent to the smaller piece would be looking at the wrong field.
 */
export const mapParcelPartSchema = z
  .object({
    outer: z.array(mapPositionSchema).min(4).max(600),
    /** Rings inside the outer one. Absent is not the same as none, so it is always present. */
    holes: z.array(z.array(mapPositionSchema).min(4).max(600)).max(12),
  })
  .strict();
export type MapParcelPart = z.infer<typeof mapParcelPartSchema>;

export const mapParcelPlaceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("polygon"),
      /**
       * The outer ring of the parcel's **largest** piece, closed.
       *
       * Version 1 of this contract, kept because builds already in the field hold a `.strict()`
       * schema that would reject anything else. It used to be the *first* piece, which is
       * whichever one the cartography happened to store first; the largest is at least the piece
       * a technician is most likely to be looking for. A build that reads `parts` ignores this.
       */
      ring: z.array(mapPositionSchema).min(4).max(600),
    })
    .strict(),
  z
    .object({
      kind: z.literal("reference_point"),
      /**
       * A point **inside** the parcel, derived. Never an entrance and never a dwelling; the device
       * labels it as a reference rather than as a destination.
       */
      at: mapPositionSchema,
    })
    .strict(),
]);
export type MapParcelPlace = z.infer<typeof mapParcelPlaceSchema>;

/** Version 2's place: every piece, with its holes, beside the version 1 ring. */
export const mapParcelPlaceV2Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("polygon"),
      ring: z.array(mapPositionSchema).min(4).max(600),
      /** Every piece of the parcel. One entry for a simple polygon. */
      parts: z.array(mapParcelPartSchema).min(1).max(40),
    })
    .strict(),
  z.object({ kind: z.literal("reference_point"), at: mapPositionSchema }).strict(),
]);
export type MapParcelPlaceV2 = z.infer<typeof mapParcelPlaceV2Schema>;

export const mapParcelSchema = z
  .object({
    /** The assignment this parcel is on. The device joins its own work by this. */
    assignmentId: uuid,
    parcelCode: z.string().min(1).max(40),
    /** Formatted by the server, like the pack's: surveying notation, not a number to re-render. */
    chainageLabel: z.string().max(40).nullable(),
    side: z.enum(["left", "right", "both"]).nullable(),
    place: mapParcelPlaceSchema,
  })
  .strict();
export type MapParcel = z.infer<typeof mapParcelSchema>;

export const mapMilestoneSchema = z
  .object({
    /** `0+000`, `1+000`, … — written the same way in either language. */
    label: z.string().min(1).max(40),
    at: mapPositionSchema,
  })
  .strict();
export type MapMilestone = z.infer<typeof mapMilestoneSchema>;

export const mapAxisSchema = z
  .object({
    label: z.string().min(1).max(120),
    /**
     * The route, simplified for a screen. One continuous line: a delivery whose pieces do not meet
     * has no single route, and the axis is then absent rather than drawn in fragments the device
     * would join visually.
     */
    coordinates: z.array(mapPositionSchema).min(2).max(2_000),
  })
  .strict();
export type MapAxis = z.infer<typeof mapAxisSchema>;

export const fieldMapRequestSchema = z
  .object({
    tenantSlug: z.string().min(1).max(80),
    projectSlug: z.string().min(1).max(80),
    /**
     * The highest response version this build can parse. **Optional on purpose**: a build that
     * predates it sends nothing and is answered in version 1, exactly as today.
     */
    acceptsSchemaVersion: z.number().int().min(1).max(99).optional(),
  })
  .strict();
export type FieldMapRequest = z.infer<typeof fieldMapRequestSchema>;

export const fieldMapResponseSchema = z
  .object({
    schemaVersion: z.literal(FIELD_MAP_SCHEMA_VERSION),
    projectName: z.string().min(1).max(200),
    /** When the server produced it. The device shows it: a map is as old as its download. */
    generatedAt: instant,
    /**
     * The provenance of the cartography, in the words the dataset carries. A technician is told
     * whether they are looking at a delivered axis or a reconstruction, because the two are not
     * the same claim about the ground.
     */
    provenance: z
      .object({
        datasetVersionLabel: z.string().min(1).max(120),
        origin: z.string().min(1).max(60),
        /** `PRELIMINARY_DRAFT` or `FINAL`, as the delivery declared it. */
        condition: z.string().min(1).max(40).nullable(),
      })
      .strict(),
    axis: mapAxisSchema.nullable(),
    /**
     * False when nobody declared where the numbering starts. The posts are still drawn — a
     * technician needs something to navigate by — and the device must say they are a **calculated
     * distance** rather than the study's abscissado.
     */
    chainageDeclared: z.boolean(),
    milestones: z.array(mapMilestoneSchema).max(400),
    parcels: z.array(mapParcelSchema).max(200),
  })
  .strict();
export type FieldMapResponse = z.infer<typeof fieldMapResponseSchema>;

/**
 * Version 2: every piece of every parcel, and the whole axis.
 *
 * Identical to version 1 but for the parcels' `place`, which gains `parts`. A device asks for it
 * by name; a device that does not ask is answered in version 1 and is no worse off than before.
 */
export const mapParcelV2Schema = mapParcelSchema.omit({ place: true }).extend({
  place: mapParcelPlaceV2Schema,
});
export type MapParcelV2 = z.infer<typeof mapParcelV2Schema>;

export const fieldMapResponseV2Schema = fieldMapResponseSchema
  .omit({ schemaVersion: true, parcels: true })
  .extend({
    schemaVersion: z.literal(FIELD_MAP_SCHEMA_VERSION_PARTS),
    parcels: z.array(mapParcelV2Schema).max(200),
    /**
     * Where the device may fetch reference imagery, when this deployment has a key for it.
     *
     * **Handed to a signed-in device rather than built into the application.** An APK is readable
     * by whoever holds the phone, and ADR-028's rule is that a distributable binary carries no
     * credential; this arrives over an authenticated request and lives in the device's encrypted
     * database beside the session it was fetched with.
     *
     * Null is the ordinary state, not an error: the device then draws the study's own geometry on
     * a plain ground — the croquis it has always drawn — and says that is what it is showing.
     * **It is not an offline background**: these are tiles fetched over the network.
     */
    referenceBasemap: z
      .object({
        /** An XYZ template with `{z}`, `{x}` and `{y}`. */
        tileUrl: z.string().min(1).max(500),
        attribution: z.string().max(200),
        maxZoom: z.number().int().min(1).max(24),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type FieldMapResponseV2 = z.infer<typeof fieldMapResponseV2Schema>;
