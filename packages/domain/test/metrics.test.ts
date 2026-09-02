import { describe, expect, it } from "vitest";

import { isMetricKey, METRIC_DEFINITIONS, METRIC_KEYS } from "../src/index";

/**
 * The scope guard for IG1-002. `metric_snapshot` is a curated Command Center projection, not the
 * analytics store: this test pins the exact set so that adding a key is a conscious decision and
 * cannot happen by drift, and names the module measurements that must never be added here.
 */
describe("metric vocabulary stays a curated Command Center projection", () => {
  const CURATED = [
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
  ];

  it("contains exactly the curated set", () => {
    // Changing this list is a Command Center curation decision (IG1-002). If you are adding a
    // module's measurement rather than a figure a coordinator reads at a glance, it belongs in
    // that module's own model instead.
    expect([...METRIC_KEYS]).toEqual(CURATED);
  });

  it("stays small enough to be a glance, not a warehouse", () => {
    expect(METRIC_KEYS.length).toBeLessThanOrEqual(16);
  });

  it("holds no module-owned measurement", () => {
    // Each of these belongs to a module's canonical model: parcels and affectations to gis,
    // visits and answers to field, codings to social, findings to quality.
    const moduleOwned = [
      "parcel_area_ha",
      "affectation_percentage",
      "visit_duration_minutes",
      "answer_coding_score",
      "open_findings",
      "document_versions",
    ];
    for (const key of moduleOwned) expect(isMetricKey(key), key).toBe(false);
  });
});

describe("metric vocabulary", () => {
  it("is a closed set with one definition per key", () => {
    expect(Object.keys(METRIC_DEFINITIONS).sort()).toEqual([...METRIC_KEYS].sort());
    for (const key of METRIC_KEYS) expect(METRIC_DEFINITIONS[key].key).toBe(key);
  });

  it("rejects invented metric keys", () => {
    expect(isMetricKey("surveys_complete")).toBe(true);
    expect(isMetricKey("hallazgos_abiertos")).toBe(false);
  });

  it("carries no pilot-specific vocabulary", () => {
    const text = JSON.stringify(METRIC_DEFINITIONS).toLowerCase();
    for (const forbidden of ["zamora", "hachos", "puente del amor", "chinchipe"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});
