import { describe, expect, it } from "vitest";

import {
  CAPABILITY_CATALOG,
  CAPABILITY_KEYS,
  FeatureDisabled,
  assertProjectOverrideAllowed,
  navigationPresentation,
  requireCapability,
  resolveCapabilities,
  type CapabilityKey,
  type TenantCapabilitySettings,
} from "../src/index";

function tenantAll(keys: ReadonlyArray<CapabilityKey>, enabled = true): TenantCapabilitySettings {
  return new Map(keys.map((k) => [k, { entitled: true, enabled }]));
}

const ALL_KEYS = CAPABILITY_KEYS;

describe("capability catalogue", () => {
  it("has exactly the 14 approved keys and no offline_sync", () => {
    expect(ALL_KEYS).toHaveLength(14);
    expect(ALL_KEYS).not.toContain("field.offline_sync");
    for (const key of ALL_KEYS) expect(CAPABILITY_CATALOG[key].key).toBe(key);
  });
});

describe("resolveCapabilities (boolean, D-014)", () => {
  it("is false for everything when the tenant has no rows", () => {
    const set = resolveCapabilities({ tenant: new Map() });
    for (const key of ALL_KEYS) expect(set[key]).toBe(false);
  });

  it("requires product availability: ANNOUNCED and EXTENSION never resolve to enabled", () => {
    const set = resolveCapabilities({ tenant: tenantAll(ALL_KEYS) });
    expect(set["core.projects"]).toBe(true);
    expect(set["core.documents"]).toBe(false);
    expect(set["quality.rag_assistant"]).toBe(false);
    expect(set["reports.social_generator"]).toBe(false);
    expect(set["climate.analytics"]).toBe(false);
  });

  it("requires entitlement AND tenant toggle", () => {
    const notEntitled: TenantCapabilitySettings = new Map([
      ["core.projects", { entitled: false, enabled: true }],
    ]);
    expect(resolveCapabilities({ tenant: notEntitled })["core.projects"]).toBe(false);
    const disabled: TenantCapabilitySettings = new Map([
      ["core.projects", { entitled: true, enabled: false }],
    ]);
    expect(resolveCapabilities({ tenant: disabled })["core.projects"]).toBe(false);
  });

  it("propagates dependencies", () => {
    const tenant = tenantAll([
      "core.projects",
      "gis.maps",
      "gis.parcels",
      "field.surveys",
      "social.analytics",
      "social.ai_coding",
    ]);
    const set = resolveCapabilities({ tenant });
    expect(set["social.ai_coding"]).toBe(true);
    const withoutMaps: TenantCapabilitySettings = new Map(tenant);
    (withoutMaps as Map<CapabilityKey, { entitled: boolean; enabled: boolean }>).set("gis.maps", {
      entitled: true,
      enabled: false,
    });
    const broken = resolveCapabilities({ tenant: withoutMaps });
    expect(broken["gis.parcels"]).toBe(false);
    expect(broken["field.surveys"]).toBe(false);
    expect(broken["social.ai_coding"]).toBe(false);
  });

  it("project override can restrict but never widen", () => {
    const tenant = tenantAll(["core.projects", "gis.maps"]);
    const restricted = resolveCapabilities({
      tenant,
      project: new Map([["gis.maps", { enabled: false }]]),
    });
    expect(restricted["gis.maps"]).toBe(false);
    const corruptedRow = resolveCapabilities({
      tenant: new Map([["core.projects", { entitled: true, enabled: true }]]),
      project: new Map([["gis.maps", { enabled: true }]]),
    });
    expect(corruptedRow["gis.maps"]).toBe(false);
    expect(() => assertProjectOverrideAllowed(tenant, "gis.parcels", true)).toThrowError(
      FeatureDisabled,
    );
    expect(() => assertProjectOverrideAllowed(tenant, "gis.parcels", false)).not.toThrow();
  });

  it("navigation presentation is separate from authorization", () => {
    const tenant = tenantAll(["core.projects", "reports.social_generator", "social.analytics"]);
    const set = resolveCapabilities({ tenant });
    expect(set["reports.social_generator"]).toBe(false);
    expect(navigationPresentation("reports.social_generator", set, tenant)).toBe("ANNOUNCED");
    expect(navigationPresentation("climate.analytics", set, tenant)).toBe("HIDDEN");
    expect(navigationPresentation("core.projects", set, tenant)).toBe("ACTIVE");
    expect(() => requireCapability({ capabilities: set }, "reports.social_generator")).toThrowError(
      FeatureDisabled,
    );
    expect(() => requireCapability({ capabilities: set }, "core.projects")).not.toThrow();
  });

  it("returns a frozen set", () => {
    const set = resolveCapabilities({ tenant: tenantAll(["core.projects"]) });
    expect(Object.isFrozen(set)).toBe(true);
  });
});
