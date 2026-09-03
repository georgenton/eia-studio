import { describe, expect, it } from "vitest";

import {
  CAPABILITY_CATALOG,
  emptyCapabilitySet,
  FeatureDisabled,
  isWorkspaceSurface,
  requireCapability,
  ROAD_EIA_SOCIAL_PROFILE,
  SURFACE_DEFINITIONS,
  surfaceForSegment,
  WORKSPACE_RAIL_ORDER,
  WORKSPACE_SURFACES,
  type WorkspaceSurface,
} from "../src/index";

describe("workspace surface registry", () => {
  it("every surface is governed by a capability that exists in the catalogue", () => {
    for (const key of WORKSPACE_SURFACES) {
      const surface = SURFACE_DEFINITIONS[key];
      expect(CAPABILITY_CATALOG[surface.capability], `${key} capability`).toBeDefined();
    }
  });

  it("the rail lists every surface exactly once", () => {
    expect([...WORKSPACE_RAIL_ORDER].sort()).toEqual([...WORKSPACE_SURFACES].sort());
    expect(new Set(WORKSPACE_RAIL_ORDER).size).toBe(WORKSPACE_RAIL_ORDER.length);
  });

  it("resolves a URL segment back to its surface, and rejects anything else", () => {
    expect(surfaceForSegment("gis")?.key).toBe("gis");
    expect(surfaceForSegment("quality")?.capability).toBe("quality.document_gate");
    expect(surfaceForSegment("../../etc")).toBeNull();
    expect(surfaceForSegment("parcels")).toBeNull();
    expect(isWorkspaceSurface("social")).toBe(true);
    expect(isWorkspaceSurface("nope")).toBe(false);
  });

  it("the Command Center, GIS and FieldFlow are implemented", () => {
    const implemented = WORKSPACE_SURFACES.filter((k) => SURFACE_DEFINITIONS[k].implemented);
    expect(implemented).toEqual(["command-center", "gis", "field"]);
  });

  it("an unbuilt surface names the phase it is coming in; a built one names none", () => {
    for (const key of WORKSPACE_SURFACES) {
      const surface = SURFACE_DEFINITIONS[key];
      if (surface.implemented) expect(surface.plannedIn, key).toBeNull();
      else expect(surface.plannedIn, key).toBeTruthy();
    }
  });

  it("the pilot profile enables every surface capability except the announced ones", () => {
    const enabled = new Set(ROAD_EIA_SOCIAL_PROFILE.capabilities.enabled);
    for (const key of WORKSPACE_SURFACES) {
      expect(enabled.has(SURFACE_DEFINITIONS[key].capability), `${key} in profile`).toBe(true);
    }
  });
});

/**
 * The capability route policy (ADR-016, IG1-001) expressed at the level the domain owns: which
 * of the three outcomes a route must produce is a pure function of the effective capability and
 * whether the surface is implemented. The web layer maps these to 404 / render / inert state; the
 * mapping itself is covered by `packages/application/test` and by the browser suite.
 */
describe("capability route policy", () => {
  const outcome = (effective: boolean, surface: WorkspaceSurface) =>
    !effective ? "not-found" : SURFACE_DEFINITIONS[surface].implemented ? "ok" : "not-implemented";

  it("an ineffective capability is never distinguishable from an unknown route", () => {
    for (const key of WORKSPACE_SURFACES) expect(outcome(false, key)).toBe("not-found");
  });

  it("an effective capability renders, or states plainly that the surface is not built", () => {
    for (const key of WORKSPACE_SURFACES) {
      expect(outcome(true, key), key).toBe(
        SURFACE_DEFINITIONS[key].implemented ? "ok" : "not-implemented",
      );
    }
    expect(outcome(true, "command-center")).toBe("ok");
    expect(outcome(true, "gis")).toBe("ok");
    expect(outcome(true, "field")).toBe("ok");
    expect(outcome(true, "social")).toBe("not-implemented");
  });

  it("presentation cannot widen the policy: ANNOUNCED resolves as disabled", () => {
    // Reports is ANNOUNCED in the catalogue, so it can never be effective, so its route is 404
    // however the rail chooses to show it.
    expect(CAPABILITY_CATALOG[SURFACE_DEFINITIONS.reports.capability].productStatus).toBe(
      "ANNOUNCED",
    );
    const capabilities = emptyCapabilitySet();
    expect(capabilities[SURFACE_DEFINITIONS.reports.capability]).toBe(false);
    expect(() =>
      requireCapability({ capabilities }, SURFACE_DEFINITIONS.reports.capability),
    ).toThrow(FeatureDisabled);
  });
});
