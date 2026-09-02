import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { calculateForecast, FORECAST_ALGORITHM_VERSION, type ForecastInput } from "../src/index";

/** The pilot-shaped inputs: 22 pending at an observed 5,2 per day, three days before the target. */
const BASE: ForecastInput = {
  pending: 22,
  dailyCompletions: [4, 6, 5, 3, 7, 5, 6, 4, 6, 5],
  windowDays: 5,
  calculatedFrom: "2026-09-17",
  targetDate: "2026-09-20",
  activeTechnicians: 3,
  assignedTechnicians: 4,
  assumptions: ["6 predios por técnico en tramos accesibles"],
};

describe("operational forecast (invariant 5)", () => {
  it("is arithmetic a reviewer can reproduce by hand", () => {
    const result = calculateForecast({ ...BASE });
    // last five days: 5 + 6 + 4 + 6 + 5 = 26; 26 / 5 = 5.2
    expect(result.movingAveragePerDay).toBe(5.2);
    // 22 pending ÷ 5.2 per day = 4.23… → 5 whole days of work
    expect(result.remainingDays).toBe(5);
    expect(result.projectedCloseDate).toBe("2026-09-22");
    // three days to the target, five days of work → two days late
    expect(result.daysToTarget).toBe(3);
    expect(result.delayDays).toBe(2);
    // 22 pending ÷ 3 days = 7.33… → 7.3 per day to arrive on the target date
    expect(result.requiredRatePerDay).toBe(7.3);
    expect(result.algorithmVersion).toBe(FORECAST_ALGORITHM_VERSION);
  });

  it("uses only the last `windowDays` observations", () => {
    const wide = calculateForecast({ ...BASE, windowDays: 10 });
    expect(wide.movingAveragePerDay).toBe(5.1);
    const narrow = calculateForecast({ ...BASE, windowDays: 2 });
    expect(narrow.movingAveragePerDay).toBe(5.5);
  });

  it("is deterministic: identical inputs always give an identical result", () => {
    expect(calculateForecast({ ...BASE })).toEqual(calculateForecast({ ...BASE }));
  });

  it("reports being ahead of schedule as a negative delay", () => {
    const result = calculateForecast({ ...BASE, targetDate: "2026-10-20" });
    expect(result.delayDays).toBeLessThan(0);
    expect(result.projectedCloseDate).toBe("2026-09-22");
  });

  it("does not project a close date when nothing is being completed", () => {
    const result = calculateForecast({ ...BASE, dailyCompletions: [0, 0, 0, 0, 0] });
    expect(result.movingAveragePerDay).toBe(0);
    expect(result.remainingDays).toBe(Number.POSITIVE_INFINITY);
    expect(result.delayDays).toBe(0);
  });

  it("has no required rate once the target date has passed", () => {
    const result = calculateForecast({ ...BASE, targetDate: "2026-09-17" });
    expect(result.requiredRatePerDay).toBeNull();
  });

  it("rejects an empty observation series", () => {
    expect(() => calculateForecast({ ...BASE, dailyCompletions: [] })).toThrow();
  });
});

/**
 * The demo scenario clock (IG1-003). A demo shown in six months must produce the figures a
 * reviewer approved today, so the forecast may never consult the machine's date: `calculatedFrom`
 * is an input, and the only clock in the system is the one the fixture states.
 */
describe("the forecast is anchored to its inputs, never to the machine's clock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("produces the same result whatever date the machine believes it is", () => {
    const expected = calculateForecast({ ...BASE });
    for (const pretendToday of [
      "2020-01-01T00:00:00.000Z",
      "2026-09-17T14:02:00.000Z",
      "2027-12-31T23:59:59.000Z",
      "2099-06-15T09:30:00.000Z",
    ]) {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(pretendToday));
      expect(calculateForecast({ ...BASE }), pretendToday).toEqual(expected);
      vi.useRealTimers();
    }
  });

  it("keeps the same projected close date across a year boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-31T23:59:00.000Z"));
    const endOfYear = calculateForecast({ ...BASE });
    vi.setSystemTime(new Date("2027-01-01T00:01:00.000Z"));
    const newYear = calculateForecast({ ...BASE });
    expect(endOfYear.projectedCloseDate).toBe("2026-09-22");
    expect(newYear).toEqual(endOfYear);
  });

  it("the implementation contains no reference to the current time", () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../src/projects/forecast.ts"),
      "utf8",
    );
    // `new Date(ms)` is used to format a computed instant; `Date.now()` and a bare `new Date()`
    // would mean the result depends on when it ran.
    expect(source).not.toMatch(/Date\.now\(\)/);
    expect(source).not.toMatch(/new Date\(\s*\)/);
  });
});
