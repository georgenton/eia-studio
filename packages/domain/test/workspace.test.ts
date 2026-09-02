import { describe, expect, it } from "vitest";

import {
  CAPABILITY_CATALOG,
  isWorkspaceSurface,
  ROAD_EIA_SOCIAL_PROFILE,
  SURFACE_DEFINITIONS,
  surfaceForSegment,
  WORKSPACE_RAIL_ORDER,
  WORKSPACE_SURFACES,
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

  it("only the Command Center is implemented in this slice", () => {
    const implemented = WORKSPACE_SURFACES.filter((k) => SURFACE_DEFINITIONS[k].implemented);
    expect(implemented).toEqual(["command-center"]);
  });

  it("the pilot profile enables every surface capability except the announced ones", () => {
    const enabled = new Set(ROAD_EIA_SOCIAL_PROFILE.capabilities.enabled);
    for (const key of WORKSPACE_SURFACES) {
      expect(enabled.has(SURFACE_DEFINITIONS[key].capability), `${key} in profile`).toBe(true);
    }
  });
});
