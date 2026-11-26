import { describeEpsg } from "@eia/domain";
import { describe, expect, it } from "vitest";

/**
 * What a CRS code may be allowed to say about itself.
 *
 * The point of these assertions is the **absence** in the last one: a code outside the two WGS 84
 * UTM blocks gets no zone and no datum, because `crs.ts` refuses to keep a registry and reading
 * `spatial_ref_sys` is PostGIS's job. A surface that printed a plausible datum for an unknown code
 * would be inventing cartographic metadata, which is the one thing a map legend must not do.
 */
describe("describeEpsg", () => {
  it("reads the zone and hemisphere out of the southern WGS 84 UTM block", () => {
    expect(describeEpsg(32_717)).toEqual({
      code: "EPSG:32717",
      utm: { zone: 17, hemisphere: "S" },
      datum: "WGS 84",
    });
  });

  it("reads the northern block the same way", () => {
    expect(describeEpsg(32_601)).toEqual({
      code: "EPSG:32601",
      utm: { zone: 1, hemisphere: "N" },
      datum: "WGS 84",
    });
    expect(describeEpsg(32_660)).toEqual({
      code: "EPSG:32660",
      utm: { zone: 60, hemisphere: "N" },
      datum: "WGS 84",
    });
  });

  it("names the datum of the canonical CRS and claims no zone for it", () => {
    expect(describeEpsg(4_326)).toEqual({ code: "EPSG:4326", utm: null, datum: "WGS 84" });
  });

  it("stops at the edge of each block rather than inventing zone 0 or 61", () => {
    expect(describeEpsg(32_600).utm).toBeNull();
    expect(describeEpsg(32_661).utm).toBeNull();
    expect(describeEpsg(32_700).utm).toBeNull();
    expect(describeEpsg(32_761).utm).toBeNull();
  });

  it("says only the code for anything else, including codes it could plausibly guess", () => {
    // Projected and metre-based, and inside the 4xxx block the module refuses to classify.
    expect(describeEpsg(4_087)).toEqual({ code: "EPSG:4087", utm: null, datum: null });
    // PSAD56 / UTM 17S: a real CRS, a real zone — and not derivable from the number.
    expect(describeEpsg(24_877)).toEqual({ code: "EPSG:24877", utm: null, datum: null });
    // A custom SRS legitimately registered in spatial_ref_sys.
    expect(describeEpsg(990_001)).toEqual({ code: "EPSG:990001", utm: null, datum: null });
  });
});
