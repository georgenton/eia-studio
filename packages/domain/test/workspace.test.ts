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

  it("every surface a slice has built is marked implemented, and no other", () => {
    const implemented = WORKSPACE_SURFACES.filter((k) => SURFACE_DEFINITIONS[k].implemented);
    // Every workspace surface the catalogue ships is implemented, and the registry says so — a
    // surface added later starts false and this assertion notices. `pgas` joined with ADR-024.
    expect(implemented).toEqual([
      "command-center",
      "gis",
      "field",
      "social",
      "quality",
      "documents",
      "pgas",
      "reports",
      "portal",
    ]);
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
    expect(outcome(true, "social")).toBe("ok");
    expect(outcome(true, "quality")).toBe("ok");
    expect(outcome(true, "documents")).toBe("ok");
    expect(outcome(true, "reports")).toBe("ok");

    // The "module not implemented" state now has **no** reachable route: every workspace surface is
    // built (TD-055). The policy that produces it is still asserted here, against a constructed
    // registry entry rather than a real one, because manufacturing a route for it would mean
    // shipping a capability nobody implements purely so a test could visit it. GIS was the live
    // example until Slice 2, FieldFlow until Slice 3, Quality Gate until Slice 5, Documents until
    // Slice 6, Reports until Slice 7.
    const unbuilt = { ...SURFACE_DEFINITIONS.reports, implemented: false };
    const outcomeFor = (effective: boolean, surface: { implemented: boolean }) =>
      !effective ? "not-found" : surface.implemented ? "ok" : "not-implemented";
    expect(outcomeFor(true, unbuilt)).toBe("not-implemented");
    expect(outcomeFor(false, unbuilt)).toBe("not-found");
  });

  it("presentation cannot widen the policy: a capability the tenant lacks is refused", () => {
    // Every workspace capability now ships (`AVAILABLE`), so the example is a tenant that has not
    // enabled one rather than a product status that forbids it. The rule is unchanged: whatever the
    // rail shows, `requireCapability` reads the effective boolean and nothing else.
    for (const surface of ["reports", "documents", "quality"] as const) {
      const key = SURFACE_DEFINITIONS[surface].capability;
      expect(CAPABILITY_CATALOG[key].productStatus).toBe("AVAILABLE");
      const capabilities = emptyCapabilitySet();
      expect(capabilities[key]).toBe(false);
      expect(() => requireCapability({ capabilities }, key)).toThrow(FeatureDisabled);
    }
  });
});
