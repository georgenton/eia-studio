import { z } from "zod";

import { InvalidInput } from "../core/errors";
import type { Regime } from "../provenance/facets";

/**
 * What a consulting firm publishes to its client (ADR-027, amending ADR-009 §3 and §5).
 *
 * ## The portal is a publication, not a mirror
 *
 * Nothing here is a view over the operational tables. A `ClientPublication` is a snapshot that
 * somebody with `portal.publish` decided the client may see, on a date, and it keeps saying that
 * until somebody publishes again. The client surface therefore reads one row and asks the
 * operational database nothing — not "what does the project look like now", but "what did the
 * consultancy publish".
 *
 * ## Why the payload is an allowlist and not a filtered record
 *
 * The alternative — build the full operational picture and delete the sensitive parts — fails the
 * first time somebody adds a field upstream, and it fails silently, in the one place where a
 * mistake reaches a person outside the firm. So the payload has **nowhere to put** a respondent, a
 * parcel code, an owner, a technician, a finding, a model proposal or an internal note. Every
 * object below is `strict()`, every figure comes from a closed vocabulary of keys, and the only
 * free text is written by this product rather than copied out of a record.
 *
 * ## Why the figures carry no regime, and where the regime went
 *
 * ADR-009 §5 asked every figure in the projection to carry its provenance facets. That was written
 * before there was a client reading the page: `HISTORICAL_OBSERVED` on a municipal government's
 * screen is internal vocabulary, and the useful half of provenance for that reader is the *basis*
 * — "119 fichas socioeconómicas del estudio" — in words. So the regime is enforced **at build
 * time**, where it decides whether a figure may be published at all, and the publication row keeps
 * the provenance ids of everything it rests on. The payload keeps the words. ADR-027 records the
 * amendment; `assertPublishableRegime` is where the rule actually lives.
 */

/** The payload's own version, so an old publication can still be rendered by a newer product. */
export const CLIENT_PUBLICATION_SCHEMA_VERSION = 1;

/**
 * Every figure a publication may state. A closed list, because "which numbers does the client
 * see" is a product decision and not something a builder should be able to widen by accident.
 *
 * What is deliberately **absent** is as much of the contract as what is present; see
 * `PUBLICATION_WITHHELD_FIGURES`.
 */
export const PUBLIC_FACT_KEYS = [
  "corridor_length_km",
  "parcel_universe",
  // Named for the instrument, not the person: 119 *fichas* is a count of forms the study
  // collected. A key called `respondents` would put an individual in the vocabulary of a payload
  // whose whole point is that individuals are not in it — and `findForbiddenConcepts` says so.
  "socioeconomic_surveys",
  "consultation_participants",
  "pgas_plans",
  "pgas_programmes",
  "pgas_measures",
] as const;
export const publicFactKeySchema = z.enum(PUBLIC_FACT_KEYS);
export type PublicFactKey = z.infer<typeof publicFactKeySchema>;

/**
 * Figures the builder knows about and refuses to publish, with the reason, so the internal
 * surface can say *why* something a coordinator expects to see is not there.
 *
 * `affected_parcels` is the one that matters. The project's own corpus states 70 in one place and
 * 71 in another, and the Quality Gate is holding that open. Publishing either number would settle
 * an unresolved question on the client's screen, by accident, in the firm's name; publishing both
 * would hand the client an internal review record. Omitting it is the only honest option until a
 * reviewer resolves it, and this constant is why the omission is deliberate rather than forgotten.
 */
export const PUBLICATION_WITHHELD_FIGURES: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly reason: string;
}> = [
  {
    key: "affected_parcels",
    label: "Predios con afectación",
    reason:
      "El expediente registra dos cifras distintas y la revisión de consistencia sigue abierta. " +
      "Una publicación no resuelve una discrepancia interna: la cifra se omite hasta que la " +
      "revisión concluya.",
  },
  {
    key: "field_operation_progress",
    label: "Avance del levantamiento en curso",
    reason:
      "El avance operativo disponible hoy es una simulación de demostración. Un cliente no puede " +
      "ver actividad simulada como progreso de su proyecto.",
  },
];

/**
 * One published figure.
 *
 * `value` is already formatted for `es-EC`, because the publication is what gets rendered — and
 * a number re-formatted at read time could differ from the one that was approved. `basis` is the
 * denominator or the source in words; it replaces the provenance enums, which mean nothing to the
 * reader and everything to us.
 */
export const publicFactSchema = z
  .object({
    key: publicFactKeySchema,
    label: z.string().min(1).max(120),
    value: z.string().min(1).max(60),
    unit: z.string().min(1).max(20).nullable(),
    basis: z.string().min(1).max(240).nullable(),
  })
  .strict();
export type PublicFact = z.infer<typeof publicFactSchema>;

/**
 * A published geometry: the study's own line and outlines, generalised for drawing.
 *
 * Parcels have no representation here at all. A corridor and its areas of influence are the shape
 * of the work; a parcel polygon is somebody's land, and drawing 141 of them on a page a client can
 * print is how a cadastral map leaves a consultancy.
 */
export const publishedGeometrySchema = z
  .object({
    label: z.string().min(1).max(120),
    /** GeoJSON geometry, already simplified. Validated as an object with a `type`, not by kind. */
    geometry: z
      .object({ type: z.string().min(1).max(40) })
      .catchall(z.unknown())
      .readonly(),
  })
  .strict();
export type PublishedGeometry = z.infer<typeof publishedGeometrySchema>;

export const publishedAreaSchema = publishedGeometrySchema.extend({
  areaHa: z.number().nonnegative().nullable(),
});
export type PublishedArea = z.infer<typeof publishedAreaSchema>;

export const publishedMilestoneSchema = z
  .object({
    title: z.string().min(1).max(160),
    state: z.string().min(1).max(60),
    date: z.iso.date().nullable(),
  })
  .strict();
export type PublishedMilestone = z.infer<typeof publishedMilestoneSchema>;

export const publishedDeliverableSchema = z
  .object({
    title: z.string().min(1).max(200),
    state: z.string().min(1).max(60),
    date: z.iso.date().nullable(),
  })
  .strict();
export type PublishedDeliverable = z.infer<typeof publishedDeliverableSchema>;

export const publishedPlanSchema = z
  .object({
    /** The plan's own code in the study, when it has one. Not an identifier this product minted. */
    code: z.string().min(1).max(40).nullable(),
    title: z.string().min(1).max(240),
    measures: z.number().int().nonnegative(),
  })
  .strict();
export type PublishedPlan = z.infer<typeof publishedPlanSchema>;

export const clientPublicationPayloadSchema = z
  .object({
    schemaVersion: z.literal(CLIENT_PUBLICATION_SCHEMA_VERSION),
    project: z
      .object({
        /** The short name the study is known by. */
        name: z.string().min(1).max(200),
        /** The cover title of the terms of reference, when the project carries one. */
        officialTitle: z.string().min(1).max(600).nullable(),
        locality: z.string().min(1).max(160),
        programmeReference: z.string().min(1).max(120).nullable(),
      })
      .strict(),
    summary: z
      .object({
        /** One sentence of product copy. Never generated, never copied from an internal note. */
        headline: z.string().min(1).max(400),
        facts: z.array(publicFactSchema),
      })
      .strict(),
    territory: z
      .object({
        alignment: publishedGeometrySchema.nullable(),
        influenceAreas: z.array(publishedAreaSchema),
        /** Says the drawn outlines are generalised, because they are. */
        note: z.string().min(1).max(400),
      })
      .strict(),
    participation: z
      .object({
        facts: z.array(publicFactSchema),
        note: z.string().min(1).max(400).nullable(),
      })
      .strict(),
    managementPlan: z
      .object({
        facts: z.array(publicFactSchema),
        plans: z.array(publishedPlanSchema),
        note: z.string().min(1).max(400).nullable(),
      })
      .strict()
      .nullable(),
    /** Empty until a milestone exists that somebody decided to publish. Never invented. */
    milestones: z.array(publishedMilestoneSchema),
    /** Empty until an approved deliverable exists. Never a draft. */
    deliverables: z.array(publishedDeliverableSchema),
    /**
     * D-019: off by default, and a simulated projection can never be published at all. The shape
     * exists so that a project that turns it on has somewhere to put one, with its wording.
     */
    forecast: z
      .object({
        statement: z.string().min(1).max(400),
        calculatedAt: z.iso.datetime(),
        algorithmVersion: z.string().min(1).max(40),
        assumptions: z.array(z.string().min(1).max(240)).min(1),
      })
      .strict()
      .nullable(),
    /** Publication-safe notes shown at the foot of the page, e.g. what the figures do not cover. */
    notes: z.array(z.string().min(1).max(400)),
  })
  .strict();
export type ClientPublicationPayload = z.infer<typeof clientPublicationPayloadSchema>;

/**
 * Which regimes may reach a client, and why the answer is not "anything that is not demo".
 *
 * `HISTORICAL_OBSERVED` is the study's own concluded record: aggregate, dated, already delivered.
 * `LIVE_OPERATIONAL` may be published **only** where the value is an aggregate and the caller has
 * declared it publication-safe — a running count of visits is a statement about staff work as much
 * as about progress. `DEMO_SIMULATION` can never be published, whatever else is true: a client
 * looking at simulated activity and reading it as their project's progress is the single worst
 * failure this product could have.
 */
export function assertPublishableRegime(
  regime: Regime,
  context: { readonly figure: string; readonly aggregate: boolean; readonly declaredSafe: boolean },
): void {
  if (regime === "DEMO_SIMULATION") {
    throw new InvalidInput(
      `publication_refuses_simulation: "${context.figure}" carries regime DEMO_SIMULATION. ` +
        "Simulated activity is never published as a client's progress.",
    );
  }
  if (regime === "LIVE_OPERATIONAL" && !(context.aggregate && context.declaredSafe)) {
    throw new InvalidInput(
      `publication_refuses_live_detail: "${context.figure}" is live operational data that is ` +
        "neither aggregated nor declared publication-safe.",
    );
  }
}

/**
 * Concepts that must not exist anywhere in a serialised payload.
 *
 * The strict schema is the real defence — none of these has a field to live in. This is the second
 * one, and it exists because the first is a claim about the *shape* of the payload and this is a
 * claim about its *content*: a label, a plan title or a note is free text, and free text is where
 * a technician's name or a finding's wording would actually arrive.
 */
export const FORBIDDEN_PAYLOAD_CONCEPTS: ReadonlyArray<string> = [
  "respondent",
  "encuestado",
  "owner",
  "propietario",
  "phone",
  "telefono",
  "teléfono",
  "email",
  "cedula",
  "cédula",
  "parcelcode",
  "parcel_code",
  "surveyanswer",
  "survey_answer",
  "technician",
  "tecnico",
  "técnico",
  "qualityfinding",
  "quality_finding",
  "humanreview",
  "human_review",
  "aiclassification",
  "ai_classification",
  "classification",
  "confidence",
  "confianza",
  "audit",
  "demo_simulation",
  "live_operational",
  "historical_observed",
  "provenance",
  "procedencia",
];

/**
 * Scan a payload for a forbidden concept, in keys and in values alike.
 *
 * Case-insensitive and accent-aware, over the whole serialised structure: a concept smuggled into
 * a plan title is exactly as published as one in a field name.
 */
export function findForbiddenConcepts(payload: unknown): ReadonlyArray<string> {
  const haystack = JSON.stringify(payload ?? null).toLowerCase();
  return FORBIDDEN_PAYLOAD_CONCEPTS.filter((concept) => haystack.includes(concept.toLowerCase()));
}

/** Parse and check a payload; the one door every publication goes through. */
export function assertPublishablePayload(payload: unknown): ClientPublicationPayload {
  const parsed = clientPublicationPayloadSchema.parse(payload);
  const found = findForbiddenConcepts(parsed);
  if (found.length > 0) {
    throw new InvalidInput(
      `publication_forbidden_concept: the payload mentions ${found.join(", ")}. A client ` +
        "publication carries aggregates and the study's own geometry, never internal records.",
    );
  }
  if (parsed.forecast !== null) {
    // Belt and braces: the builder never produces one, and D-019 keeps the configuration false.
    throw new InvalidInput(
      "publication_forecast_not_authorized: publishing an operational projection requires an " +
        "explicitly published, non-simulated forecast snapshot (D-019).",
    );
  }
  return parsed;
}

/**
 * The canonical serialisation of a publication's content: key order fixed, so two payloads that say
 * the same thing produce the same string.
 *
 * It is the *input* to the hash rather than the hash itself, because hashing needs a crypto
 * primitive and this package depends on nothing but zod (ADR-015). `publishClientPublication`
 * hashes it, and the stored `content_hash` is therefore a hash rather than a second copy of a
 * payload that already carries several thousand coordinates.
 */
export function publicationCanonicalForm(payload: ClientPublicationPayload): string {
  return stableStringify(payload);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** `v1`, `v2`, … — the product's one version convention, as everywhere else. */
export function publicationVersionLabel(sequence: number): string {
  return `v${sequence}`;
}
