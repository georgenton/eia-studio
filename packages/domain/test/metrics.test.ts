import { describe, expect, it } from "vitest";

import { isMetricKey, METRIC_DEFINITIONS, METRIC_KEYS } from "../src/index";

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
