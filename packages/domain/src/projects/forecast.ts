import { z } from "zod";

import type { ProvenanceFacets } from "../provenance/facets";

/**
 * Operational forecast (invariant 5). Deterministic arithmetic over the observed rate:
 *
 *     media móvil   = promedio de los últimos `windowDays` días de predios completados
 *     días restantes = techo(pendientes ÷ media móvil)
 *     cierre proyectado = fecha de cálculo + días restantes
 *     retraso        = cierre proyectado − fecha objetivo
 *     ritmo necesario = pendientes ÷ días hasta la fecha objetivo
 *
 * It is not a model and must never be described with probabilistic language. Every output is
 * reproducible by hand from the stored inputs, which is why the inputs are persisted next to the
 * result (`ForecastSnapshot`) instead of being recomputed from live tables.
 */
export const FORECAST_ALGORITHM_VERSION = "operational-forecast@1";

export const forecastInputSchema = z
  .object({
    /** Units of work still to complete. */
    pending: z.number().int().min(0),
    /** Completed units per day, ordered oldest → newest; the window reads from the end. */
    dailyCompletions: z.array(z.number().min(0)).min(1),
    windowDays: z.number().int().min(1),
    /** Calendar date the calculation is anchored to (ISO `YYYY-MM-DD`). */
    calculatedFrom: z.iso.date(),
    targetDate: z.iso.date(),
    activeTechnicians: z.number().int().min(0),
    assignedTechnicians: z.number().int().min(0),
    assumptions: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type ForecastInput = z.infer<typeof forecastInputSchema>;

export interface ForecastResult {
  readonly algorithmVersion: string;
  readonly movingAveragePerDay: number;
  readonly remainingDays: number;
  readonly projectedCloseDate: string;
  /** Positive = later than the target; negative = earlier; zero = on the target date. */
  readonly delayDays: number;
  readonly requiredRatePerDay: number | null;
  readonly daysToTarget: number;
}

const MS_PER_DAY = 86_400_000;

function parseDate(iso: string): number {
  return Date.parse(`${iso}T00:00:00.000Z`);
}

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** One decimal, half-up — the precision the design shows for rates (`5,2 pred/día`). */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function calculateForecast(rawInput: ForecastInput): ForecastResult {
  const input = forecastInputSchema.parse(rawInput);
  const window = input.dailyCompletions.slice(-input.windowDays);
  const movingAveragePerDay = round1(window.reduce((a, b) => a + b, 0) / window.length);

  const from = parseDate(input.calculatedFrom);
  const target = parseDate(input.targetDate);
  const daysToTarget = Math.round((target - from) / MS_PER_DAY);

  // A stalled rate cannot produce a finite projection; the caller renders that honestly.
  const remainingDays =
    movingAveragePerDay > 0
      ? Math.ceil(input.pending / movingAveragePerDay)
      : Number.POSITIVE_INFINITY;
  const projectedCloseDate = Number.isFinite(remainingDays)
    ? toIsoDate(from + remainingDays * MS_PER_DAY)
    : input.targetDate;
  const delayDays = Number.isFinite(remainingDays) ? remainingDays - daysToTarget : 0;
  const requiredRatePerDay = daysToTarget > 0 ? round1(input.pending / daysToTarget) : null;

  return {
    algorithmVersion: FORECAST_ALGORITHM_VERSION,
    movingAveragePerDay,
    remainingDays,
    projectedCloseDate,
    delayDays,
    requiredRatePerDay,
    daysToTarget,
  };
}

/** Persisted forecast: inputs, assumptions and result, so the drawer can show the calculation. */
export interface ForecastSnapshot {
  readonly id: string;
  readonly algorithmVersion: string;
  /**
   * The date the calculation is anchored to — `calculatedFrom` above, persisted so the input
   * snapshot is complete and the result can be recomputed from the row alone.
   *
   * For a `DEMO_SIMULATION` forecast this date *is* the demo scenario clock (IG1-009). The
   * scenario has no other home and needs none: it is a property of the simulated calculation,
   * not of the project, which is a real EIA Studio entity that knows nothing about demos.
   */
  readonly asOfDate: string;
  readonly pending: number;
  readonly dailyCompletions: ReadonlyArray<number>;
  readonly windowDays: number;
  readonly movingAveragePerDay: number;
  readonly requiredRatePerDay: number | null;
  readonly activeTechnicians: number;
  readonly assignedTechnicians: number;
  readonly targetDate: string;
  readonly projectedCloseDate: string;
  readonly delayDays: number;
  readonly assumptions: ReadonlyArray<string>;
  readonly calculatedAt: Date;
  readonly provenanceId: string;
}

/**
 * The fixed as-of date of a demo simulation, or `null` when the forecast is a real one.
 *
 * There is no scenario subsystem and no scenario table: a demo forecast's anchor already *is*
 * the clock, and its provenance already says the regime. This is the whole rule.
 */
export function demoScenarioDate(
  forecast: Pick<ForecastSnapshot, "asOfDate">,
  provenance: ProvenanceFacets,
): string | null {
  return provenance.regime === "DEMO_SIMULATION" ? forecast.asOfDate : null;
}
