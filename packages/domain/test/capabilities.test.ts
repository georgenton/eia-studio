import { describe, expect, it } from "vitest";

import {
  CAPABILITY_CATALOG,
  CAPABILITY_KEYS,
  FeatureDisabled,
  ROAD_EIA_SOCIAL_PROFILE,
  assertProjectOverrideAllowed,
  navigationPresentation,
  profileCapabilityDefaults,
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

/**
 * IG0-H02 canonical semantics:
 *   PRODUCT_AVAILABLE ∧ TENANT_ALLOWED ∧ PROJECT_EFFECTIVE_ENABLED ∧ DEPENDENCIES_SATISFIED
 * with PROJECT_EFFECTIVE_ENABLED = explicit override ?? profile default ?? enabled,
 * and TENANT_ALLOWED = entitled ∧ tenant toggle.
 */
describe("capability truth table (IG0-H02)", () => {
  // `gis.maps` depends only on `core.projects`, held enabled in every row, so the table isolates
  // the product / tenant / profile / override layers. `product=false` uses a catalogue key whose
  // product status is EXTENSION, the only way PRODUCT_AVAILABLE can be false.
  const KEY: CapabilityKey = "gis.maps";
  const DEP: CapabilityKey = "core.projects";
  const UNAVAILABLE: CapabilityKey = "climate.analytics";

  const cases: ReadonlyArray<{
    product: boolean;
    tenant: boolean;
    profile: boolean;
    override: boolean | null;
    expected: boolean;
  }> = [
    { product: true, tenant: true, profile: true, override: null, expected: true },
    { product: true, tenant: true, profile: false, override: null, expected: false },
    { product: true, tenant: true, profile: false, override: true, expected: true },
    { product: true, tenant: true, profile: true, override: false, expected: false },
    { product: true, tenant: false, profile: true, override: true, expected: false },
    { product: false, tenant: true, profile: true, override: true, expected: false },
    // completeness beyond the mandated rows
    { product: true, tenant: false, profile: false, override: null, expected: false },
    { product: false, tenant: false, profile: true, override: null, expected: false },
    { product: true, tenant: true, profile: false, override: false, expected: false },
  ];

  for (const c of cases) {
    const label = `product=${c.product} tenant=${c.tenant} profile=${c.profile} override=${String(c.override)} yields ${c.expected}`;
    it(label, () => {
      const key = c.product ? KEY : UNAVAILABLE;
      const tenant: TenantCapabilitySettings = new Map([
        [DEP, { entitled: true, enabled: true }],
        [key, { entitled: c.tenant, enabled: c.tenant }],
      ]);
      const profileDefaults = new Map<CapabilityKey, boolean>([[key, c.profile]]);
      const overrides =
        c.override === null
          ? new Map<CapabilityKey, boolean>()
          : new Map<CapabilityKey, boolean>([[key, c.override]]);
      const set = resolveCapabilities({ tenant, project: { overrides, profileDefaults } });
      expect(set[key]).toBe(c.expected);
    });
  }

  it("a project may re-enable a tenant-entitled capability its profile disables", () => {
    const tenant = tenantAll([DEP, KEY]);
    const profileDefaults = new Map<CapabilityKey, boolean>([[KEY, false]]);
    expect(resolveCapabilities({ tenant, project: { profileDefaults } })[KEY]).toBe(false);
    const overrides = new Map<CapabilityKey, boolean>([[KEY, true]]);
    expect(resolveCapabilities({ tenant, project: { profileDefaults, overrides } })[KEY]).toBe(
      true,
    );
  });

  it("a forged override row cannot widen past product or tenant", () => {
    const overrides = new Map<CapabilityKey, boolean>([
      ["climate.analytics", true],
      ["reports.social_generator", true],
      ["gis.maps", true],
    ]);
    const set = resolveCapabilities({ tenant: tenantAll([DEP]), project: { overrides } });
    expect(set["climate.analytics"]).toBe(false); // product status EXTENSION
    expect(set["reports.social_generator"]).toBe(false); // tenant not entitled
    expect(set["gis.maps"]).toBe(false); // tenant not entitled
  });

  it("tenant entitlement and tenant toggle are both required", () => {
    const notEntitled: TenantCapabilitySettings = new Map([
      ["core.projects", { entitled: false, enabled: true }],
    ]);
    expect(resolveCapabilities({ tenant: notEntitled })["core.projects"]).toBe(false);
    const toggledOff: TenantCapabilitySettings = new Map([
      ["core.projects", { entitled: true, enabled: false }],
    ]);
    expect(resolveCapabilities({ tenant: toggledOff })["core.projects"]).toBe(false);
  });
});

describe("dependencies", () => {
  const chain: CapabilityKey[] = [
    "core.projects",
    "gis.maps",
    "gis.parcels",
    "field.surveys",
    "social.analytics",
    "social.ai_coding",
  ];

  it("a disabled dependency disables everything downstream", () => {
    expect(resolveCapabilities({ tenant: tenantAll(chain) })["social.ai_coding"]).toBe(true);
    const tenantWithoutMaps = new Map(tenantAll(chain));
    tenantWithoutMaps.set("gis.maps", { entitled: true, enabled: false });
    const broken = resolveCapabilities({ tenant: tenantWithoutMaps });
    expect(broken["gis.parcels"]).toBe(false);
    expect(broken["field.surveys"]).toBe(false);
    expect(broken["social.ai_coding"]).toBe(false);
  });

  it("a project override cannot satisfy a missing dependency", () => {
    const tenant = tenantAll(["core.projects", "gis.parcels"]); // gis.maps absent
    const overrides = new Map<CapabilityKey, boolean>([["gis.parcels", true]]);
    expect(resolveCapabilities({ tenant, project: { overrides } })["gis.parcels"]).toBe(false);
  });

  it("disabling a dependency at project level cascades", () => {
    const overrides = new Map<CapabilityKey, boolean>([["gis.maps", false]]);
    const set = resolveCapabilities({ tenant: tenantAll(chain), project: { overrides } });
    expect(set["gis.maps"]).toBe(false);
    expect(set["gis.parcels"]).toBe(false);
    expect(set["field.surveys"]).toBe(false);
  });
});

describe("profile defaults", () => {
  it("are derived from the profile snapshot", () => {
    const defaults = profileCapabilityDefaults(ROAD_EIA_SOCIAL_PROFILE);
    expect(defaults.get("gis.parcels")).toBe(true);
    expect(defaults.get("climate.analytics")).toBe(false);
    expect(defaults.has("core.projects")).toBe(true);
  });
});

describe("product status and presentation", () => {
  it("an EXTENSION never resolves to enabled, however the tenant is configured", () => {
    const set = resolveCapabilities({ tenant: tenantAll(ALL_KEYS) });
    expect(set["core.projects"]).toBe(true);
    /*
     * Slice 6 moved `core.documents` and `quality.rag_assistant` to AVAILABLE and Slice 7 moved
     * `reports.social_generator`. `compliance.pma` joined them when the management plan was built
     * (ADR-024) — narrowed to the plan's *design*, which is what exists; following whether the
     * measures are carried out is `audit.environmental`, still an extension and still refused.
     */
    for (const key of [
      "core.documents",
      "quality.rag_assistant",
      "reports.social_generator",
      "compliance.pma",
    ] as const) {
      expect(set[key], key).toBe(true);
    }
    for (const key of ["climate.analytics", "audit.environmental"] as const) {
      expect(set[key], key).toBe(false);
    }
  });

  it("no ANNOUNCED capability remains, so the rail has no placeholder left to show", () => {
    // The eleven keys of the pilot profile are all built. `ANNOUNCED` is still a product status the
    // catalogue can carry and `navigationPresentation` still handles it — the branch is asserted
    // below against a constructed state — but nothing ships in it today (TD-055).
    const announced = ALL_KEYS.filter((k) => CAPABILITY_CATALOG[k].productStatus === "ANNOUNCED");
    expect(announced).toEqual([]);
  });

  it("a capability is about whether the functionality exists, not whether a provider answers", () => {
    // `quality.rag_assistant` is AVAILABLE even with no model configured anywhere: retrieval with
    // citations is the functionality, and the narrative paragraph is the part that degrades
    // (ADR-021 §4). Tying a capability to an external credential would make the rail flicker with
    // somebody else's outage.
    const set = resolveCapabilities({ tenant: tenantAll(ALL_KEYS) });
    expect(set["quality.rag_assistant"]).toBe(true);
  });

  it("navigation presentation is separate from authorization", () => {
    // An EXTENSION the tenant is entitled to and has enabled: effective is still false, and the
    // rail hides it. Presentation never widens the policy.
    const tenant = tenantAll(["core.projects", "climate.analytics", "social.analytics"]);
    const set = resolveCapabilities({ tenant });
    expect(set["climate.analytics"]).toBe(false);
    expect(navigationPresentation("climate.analytics", set, tenant)).toBe("HIDDEN");
    expect(navigationPresentation("core.projects", set, tenant)).toBe("ACTIVE");
    expect(() => requireCapability({ capabilities: set }, "reports.social_generator")).toThrowError(
      FeatureDisabled,
    );
    expect(() => requireCapability({ capabilities: set }, "core.projects")).not.toThrow();
  });

  it("returns a frozen set", () => {
    expect(Object.isFrozen(resolveCapabilities({ tenant: tenantAll(["core.projects"]) }))).toBe(
      true,
    );
  });
});

describe("write-time override guard", () => {
  it("rejects enabling what product or tenant disallows, always allows disabling", () => {
    const tenant = tenantAll(["core.projects", "gis.maps"]);
    expect(() => assertProjectOverrideAllowed(tenant, "gis.maps", true)).not.toThrow();
    expect(() => assertProjectOverrideAllowed(tenant, "gis.parcels", true)).toThrowError(
      FeatureDisabled,
    );
    expect(() => assertProjectOverrideAllowed(tenant, "climate.analytics", true)).toThrowError(
      FeatureDisabled,
    );
    for (const key of ALL_KEYS) {
      expect(() => assertProjectOverrideAllowed(tenant, key, false)).not.toThrow();
    }
  });
});
