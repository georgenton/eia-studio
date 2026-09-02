import { z } from "zod";

import type { ProvenanceFacets } from "../provenance/facets";

/**
 * Closed vocabulary of project metrics the Command Center and Portfolio can display.
 *
 * ## Scope invariant (IG1-002) — read before adding a key
 *
 * `MetricSnapshot` is **not** the analytics store of EIA Studio. It is a small, curated
 * projection for one purpose: the handful of figures a coordinator reads at a glance on the
 * Command Center and the Portfolio card. It exists because those figures come from several
 * modules and need one shape, one provenance link and one read model — not because measurements
 * in general belong in one table.
 *
 * Every module keeps its own canonical domain model and remains the source of truth:
 *
 * - `gis` — parcels, affectations, spatial dataset versions;
 * - `field` — assignments, visits, survey instances, answers;
 * - `social` — codings, taxonomy versions, social analytics models;
 * - `quality` — runs, findings, specialist reviews;
 * - `documents`, `reports` — their own entities.
 *
 * A module **projects** a selected output into a `MetricSnapshot` when the Command Center needs
 * to show it. It never stores its measurements here, and analytics never reads from here.
 * Adding a key is therefore a deliberate Command Center curation decision, taken with the
 * question "does a coordinator need this in the ten-second glance?" — not a place to put a
 * module's numbers. `packages/domain/test/metrics.test.ts` pins the curated set so an addition
 * has to be conscious, and the database mirrors the list as an enum so no caller can invent one.
 *
 * Nothing here is pilot-specific: these are the measurements any linear-corridor social study
 * reports. The pilot's *values* live in `fixtures/projects/*` (CLAUDE.md rule 3).
 */
export const METRIC_KEYS = [
  "corridor_length_km",
  "universe_estimated",
  "universe_confirmed",
  "parcels_visited",
  "surveys_complete",
  "revisits_scheduled",
  "parcels_pending",
  "productivity_per_day",
  "projected_close_date",
  "consultation_participants",
] as const;

export const metricKeySchema = z.enum(METRIC_KEYS);
export type MetricKey = z.infer<typeof metricKeySchema>;

/** How the stored value is typed. A metric is either a number or a calendar date, never both. */
export type MetricValueKind = "count" | "decimal" | "date";

export interface MetricDefinition {
  readonly key: MetricKey;
  readonly kind: MetricValueKind;
  /** Uppercase label of the KPI cell (design v0.2 §2, `etiqueta` 9,5/600). */
  readonly label: string;
  readonly unit: string | null;
}

export const METRIC_DEFINITIONS: Readonly<Record<MetricKey, MetricDefinition>> = {
  corridor_length_km: { key: "corridor_length_km", kind: "decimal", label: "Longitud", unit: "km" },
  universe_estimated: {
    key: "universe_estimated",
    kind: "count",
    label: "Universo estimado",
    unit: null,
  },
  universe_confirmed: {
    key: "universe_confirmed",
    kind: "count",
    label: "Universo confirmado",
    unit: null,
  },
  parcels_visited: { key: "parcels_visited", kind: "count", label: "Visitados", unit: null },
  surveys_complete: {
    key: "surveys_complete",
    kind: "count",
    label: "Encuestas completas",
    unit: null,
  },
  revisits_scheduled: { key: "revisits_scheduled", kind: "count", label: "Revisitas", unit: null },
  parcels_pending: { key: "parcels_pending", kind: "count", label: "Pendientes", unit: null },
  productivity_per_day: {
    key: "productivity_per_day",
    kind: "decimal",
    label: "Productividad",
    unit: "predios/día",
  },
  projected_close_date: {
    key: "projected_close_date",
    kind: "date",
    label: "Cierre proyectado",
    unit: null,
  },
  consultation_participants: {
    key: "consultation_participants",
    kind: "count",
    label: "Participantes",
    unit: null,
  },
};

/** One measured value of one metric, always carrying its provenance (invariant 12). */
export interface MetricSnapshot {
  readonly id: string;
  readonly key: MetricKey;
  readonly definition: MetricDefinition;
  /** Present for `count` and `decimal` metrics. */
  readonly numericValue: number | null;
  /** Present for `date` metrics, as an ISO calendar date. */
  readonly dateValue: string | null;
  /** Short note under the figure ("3 en verificación", "dato real del estudio"). */
  readonly note: string | null;
  readonly observedAt: Date;
  readonly provenanceId: string;
  readonly provenance: ProvenanceFacets;
}

export function isMetricKey(value: string): value is MetricKey {
  return (METRIC_KEYS as ReadonlyArray<string>).includes(value);
}
