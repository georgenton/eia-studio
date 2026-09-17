import {
  CAPABILITY_KEYS,
  evaluateReadiness,
  PROJECT_ROLE_PERMISSIONS,
  READINESS_RULES,
  type CapabilityKey,
  type ReadinessSnapshot,
} from "../src/index";
import { describe, expect, it } from "vitest";

/**
 * Readiness says **EIA Studio can operate this project** — and only that.
 *
 * The tests below are deliberately about two things: that the answer is a function of the snapshot
 * (same picture, same report, no clock and no I/O), and that the one rule with teeth — a project
 * that requires offline capture cannot run on a channel that posts to a server — holds however the
 * rest of the project is arranged.
 */
function capabilities(over: Partial<Record<CapabilityKey, boolean>> = {}) {
  const all = Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, true])) as Record<
    CapabilityKey,
    boolean
  >;
  return { ...all, ...over };
}

function snapshot(over: Partial<ReadinessSnapshot> = {}): ReadinessSnapshot {
  return {
    project: {
      name: "Vía de prueba",
      officialTitle: "Estudio socioambiental de prueba",
      locationLabel: "Provincia, País",
      lifecycle: "planning",
      ...(over.project ?? {}),
    },
    roles: over.roles ?? ["COORDINATOR", "FIELD_TECHNICIAN"],
    capabilities: over.capabilities ?? capabilities(),
    cartography: { activeDatasets: 2, parcelsWithGeometry: 141, ...(over.cartography ?? {}) },
    questionnaire: { publishedVersions: 1, draftVersions: 0, ...(over.questionnaire ?? {}) },
    campaign: { captureChannel: "NATIVE_WEB", status: "ACTIVE", ...(over.campaign ?? {}) },
    offlineMode: over.offlineMode ?? "disabled",
    corpus: { documents: 6, ...(over.corpus ?? {}) },
    storage: { available: true, reason: null, ...(over.storage ?? {}) },
  };
}

describe("what readiness reports", () => {
  it("reports every rule, every time", () => {
    const report = evaluateReadiness(snapshot());
    expect(report.checks.map((c) => c.key)).toEqual([...READINESS_RULES]);
  });

  it("is a function of the snapshot and nothing else", () => {
    const input = snapshot();
    expect(evaluateReadiness(input)).toEqual(evaluateReadiness(input));
  });

  it("calls a fully prepared project operable", () => {
    const report = evaluateReadiness(snapshot());
    expect(report.operable).toBe(true);
    expect(report.blocking).toEqual([]);
    expect(report.advisory).toEqual([]);
  });

  it("names what a project is missing rather than only that something is", () => {
    const report = evaluateReadiness(
      snapshot({
        project: {
          name: "Vía de prueba",
          officialTitle: null,
          locationLabel: "  ",
          lifecycle: "planning",
        },
      }),
    );
    const identity = report.checks.find((c) => c.key === "project.identity")!;
    expect(identity.outcome).toBe("blocked");
    expect(identity.detail).toEqual({ missing: "officialTitle, locationLabel" });
    expect(report.operable).toBe(false);
  });

  it("blocks a project nobody coordinates", () => {
    const report = evaluateReadiness(snapshot({ roles: ["FIELD_TECHNICIAN", "VIEWER"] }));
    expect(report.blocking).toContain("project.coordinator");
    expect(report.operable).toBe(false);
  });

  it("blocks a project whose questionnaire is still a draft", () => {
    const report = evaluateReadiness(
      snapshot({ questionnaire: { publishedVersions: 0, draftVersions: 2 } }),
    );
    const rule = report.checks.find((c) => c.key === "project.questionnaire")!;
    expect(rule.outcome).toBe("blocked");
    expect(rule.detail).toEqual({ drafts: 2 });
    expect(report.operable).toBe(false);
  });
});

describe("advisory is not blocking", () => {
  it("a project with no cartography and no documents is still operable", () => {
    const report = evaluateReadiness(
      snapshot({
        cartography: { activeDatasets: 0, parcelsWithGeometry: 0 },
        corpus: { documents: 0 },
      }),
    );
    expect(report.advisory).toEqual(["project.cartography", "project.corpus"]);
    expect(report.blocking).toEqual([]);
    // A study begins before its GIS package arrives, and saying otherwise would block every
    // project for the weeks that takes — which teaches a reader to ignore the report.
    expect(report.operable).toBe(true);
  });

  it("a module the project does not have is not a gap", () => {
    const report = evaluateReadiness(
      snapshot({
        capabilities: capabilities({
          "field.surveys": false,
          "gis.parcels": false,
          "core.documents": false,
        }),
        questionnaire: { publishedVersions: 0, draftVersions: 0 },
        cartography: { activeDatasets: 0, parcelsWithGeometry: 0 },
        corpus: { documents: 0 },
        campaign: { captureChannel: null, status: null },
      }),
    );
    for (const key of [
      "project.cartography",
      "project.questionnaire",
      "project.capture_channel",
      "project.offline_channel",
      "project.corpus",
    ]) {
      expect(report.checks.find((c) => c.key === key)!.outcome, key).toBe("not_applicable");
    }
    expect(report.operable).toBe(true);
  });
});

describe("the offline gate (D-020, ADR-018)", () => {
  it("is not applicable when the project does not require offline capture", () => {
    for (const mode of ["disabled", "optional"] as const) {
      const report = evaluateReadiness(snapshot({ offlineMode: mode }));
      expect(report.checks.find((c) => c.key === "project.offline_channel")!.outcome, mode).toBe(
        "not_applicable",
      );
    }
  });

  it("blocks a project that requires offline on a channel that cannot do it", () => {
    const report = evaluateReadiness(
      snapshot({
        offlineMode: "required",
        campaign: { captureChannel: "NATIVE_WEB", status: "DRAFT" },
      }),
    );
    const rule = report.checks.find((c) => c.key === "project.offline_channel")!;
    expect(rule.outcome).toBe("blocked");
    expect(rule.severity).toBe("required");
    expect(rule.detail).toEqual({ offlineMode: "required", channel: "NATIVE_WEB" });
    expect(report.operable).toBe(false);
  });

  it("blocks a project that requires offline and has no channel at all", () => {
    const report = evaluateReadiness(
      snapshot({ offlineMode: "required", campaign: { captureChannel: null, status: null } }),
    );
    expect(report.blocking).toContain("project.offline_channel");
  });

  it("is satisfied by the mobile channel, which is the one that earns the claim", () => {
    const report = evaluateReadiness(
      snapshot({
        offlineMode: "required",
        campaign: { captureChannel: "EIA_FIELD_MOBILE", status: "ACTIVE" },
      }),
    );
    expect(report.checks.find((c) => c.key === "project.offline_channel")!.outcome).toBe(
      "satisfied",
    );
    expect(report.operable).toBe(true);
  });
});

describe("the Project Data Manager's least privilege (ADR-030)", () => {
  const dataManager = PROJECT_ROLE_PERMISSIONS.PROJECT_DATA_MANAGER;

  it("prepares a project", () => {
    for (const permission of [
      "project.intake.read",
      "project.intake.write",
      "documents.write",
      "geometry.import",
      "parcels.write",
    ] as const) {
      expect(dataManager.has(permission), permission).toBe(true);
    }
  });

  it("never reads what a household answered", () => {
    // The whole reason the role exists as its own set rather than as "coordinator, roughly".
    expect(dataManager.has("field.responses.read")).toBe(false);
    expect(dataManager.has("pii.read")).toBe(false);
    expect(dataManager.has("pii.export")).toBe(false);
  });

  it("settles nothing and publishes nothing", () => {
    for (const permission of [
      "social.coding.review",
      "social.ai.run",
      "quality.review",
      "quality.write",
      "deliverables.approve",
      "portal.preview",
      "portal.publish",
    ] as const) {
      expect(dataManager.has(permission), permission).toBe(false);
    }
  });

  it("cannot turn a module on or off, or manage the project's members", () => {
    expect(dataManager.has("project.configure")).toBe(false);
    expect(dataManager.has("project.members.manage")).toBe(false);
  });
});

describe("somewhere to put a file (ADR-031)", () => {
  it("is advisory: a deployment with no storage does not stop field work", () => {
    const report = evaluateReadiness(
      snapshot({ storage: { available: false, reason: "NOT_CONFIGURED" } }),
    );
    const storage = report.checks.find((c) => c.key === "project.storage");
    expect(storage?.outcome).toBe("blocked");
    expect(storage?.severity).toBe("advisory");
    // Field capture stores nothing. Refusing to activate a project because a document could not be
    // uploaded would stop the work over a facility that work does not use.
    expect(report.operable).toBe(true);
    expect(report.advisory).toContain("project.storage");
  });

  it("carries the reason as a code, never the operator-facing detail", () => {
    const report = evaluateReadiness(
      snapshot({ storage: { available: false, reason: "BLOCKED_EXTERNAL_CONFIG" } }),
    );
    const storage = report.checks.find((c) => c.key === "project.storage");
    expect(storage?.detail).toEqual({ reason: "BLOCKED_EXTERNAL_CONFIG" });
    // The resolver's `detail` names environment variables; it belongs in a log, not on a screen.
    expect(JSON.stringify(storage?.detail)).not.toMatch(/STORAGE_/);
  });

  it("does not apply when nothing on this project would ever store a file", () => {
    const report = evaluateReadiness(
      snapshot({
        capabilities: capabilities({ "core.documents": false, "field.surveys": false }),
        storage: { available: false, reason: "NOT_CONFIGURED" },
      }),
    );
    expect(report.checks.find((c) => c.key === "project.storage")?.outcome).toBe("not_applicable");
  });
});
