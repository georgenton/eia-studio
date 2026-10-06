import { describe, expect, it } from "vitest";

import {
  consultancyManifestSchema,
  EMPTY_SNAPSHOT,
  planConsultancyIntake,
  type ConsultancyManifest,
  type IntakeSnapshot,
} from "../src/index";

/**
 * Planning a consultancy's intake.
 *
 * The planner is pure, so these cases are the specification: what the four outcomes mean, and —
 * the property the whole exercise exists for — that planning the same manifest twice against a
 * product that already holds it proposes **nothing**. A repeated load that duplicated a project
 * or re-sent an invitation is the failure this prevents.
 */
const MANIFEST: ConsultancyManifest = consultancyManifestSchema.parse({
  manifestVersion: 1,
  consultancy: {
    name: { canonical: "Consultora Sintética" },
    tenantSlug: "consultora-sintetica",
    engagementLabel: "ENCARGO SINTÉTICO DE PRUEBA",
  },
  projects: [
    {
      key: "via-uno",
      name: { canonical: "Vía Uno" },
      slug: "via-uno",
      profileKey: "road_eia_social",
    },
    {
      key: "via-dos",
      name: { canonical: "Vía Dos" },
      slug: "via-dos",
      profileKey: "road_eia_social",
      openQuestions: ["no route spreadsheet was delivered"],
    },
  ],
  people: [
    {
      key: "con-correo",
      name: { canonical: "Persona Con Correo" },
      statedRole: "especialista social",
      email: "persona.con.correo@example.invalid",
      projectRoles: [{ projectKey: "via-uno", role: "SOCIAL_SPECIALIST" }],
    },
    {
      key: "sin-correo",
      name: { canonical: "Persona Sin Correo", variants: ["Persona Sín Correo"] },
      statedRole: "encuestadora",
      email: null,
      projectRoles: [{ projectKey: "via-uno", role: "FIELD_TECHNICIAN" }],
    },
    {
      key: "proyecto-inexistente",
      name: { canonical: "Persona Tercera" },
      statedRole: "cartógrafo",
      email: "tercera@example.invalid",
      projectRoles: [{ projectKey: "via-tres", role: "GIS_SPECIALIST" }],
    },
  ],
  delivery: {
    archiveName: "entrega.zip",
    archiveSha256: "a".repeat(64),
    archiveSizeBytes: 10,
    inventoryReference: "~/.config/private/inventory.json",
    layers: [
      {
        path: "capa.geojson",
        projectKey: "via-uno",
        kind: "vector_layer",
        declaredCrs: "EPSG:4326",
        sha256: "b".repeat(64),
        sizeBytes: 1,
      },
      {
        path: "sin-crs.geojson",
        projectKey: "via-uno",
        kind: "vector_layer",
        declaredCrs: null,
        sha256: "c".repeat(64),
        sizeBytes: 1,
      },
      {
        path: "sin-proyecto.geojson",
        projectKey: null,
        kind: "vector_layer",
        declaredCrs: "EPSG:4326",
        sha256: "d".repeat(64),
        sizeBytes: 1,
      },
      {
        path: "MAPAS/PDF/01_BASE.pdf",
        projectKey: "via-uno",
        kind: "map_sheet",
        declaredCrs: null,
        sha256: "e".repeat(64),
        sizeBytes: 1,
      },
      {
        path: "XLS/01_RUTA.xlsx",
        projectKey: "via-uno",
        kind: "spreadsheet",
        declaredCrs: null,
        sha256: "f".repeat(64),
        sizeBytes: 1,
      },
    ],
  },
  openDecisions: ["the tenant slug is proposed, not confirmed"],
});

const find = (plan: ReturnType<typeof planConsultancyIntake>, ref: string) =>
  plan.steps.find((s) => s.ref === ref);

describe("planning an intake against an empty product", () => {
  const plan = planConsultancyIntake(MANIFEST, EMPTY_SNAPSHOT);

  it("would create the tenant and the project that needs no decision", () => {
    expect(find(plan, "consultora-sintetica")?.outcome).toBe("would_create");
    expect(find(plan, "consultora-sintetica/via-uno")?.outcome).toBe("would_create");
  });

  it("holds back a project whose delivery left a question open", () => {
    const step = find(plan, "consultora-sintetica/via-dos");
    expect(step?.outcome).toBe("requires_review");
    expect(step?.reason).toContain("route spreadsheet");
  });

  it("never invents an email address, and will not assign somebody who has none", () => {
    const user = find(plan, "sin-correo");
    expect(user?.outcome).toBe("requires_review");
    expect(user?.reason).toMatch(/never derived from a name/);
    expect(find(plan, "sin-correo@via-uno")?.outcome).toBe("requires_review");
  });

  it("refuses a membership that names a project the manifest does not define", () => {
    const step = find(plan, "proyecto-inexistente@via-tres");
    expect(step?.outcome).toBe("requires_review");
    expect(step?.reason).toContain("via-tres");
  });

  it("would import a layer that declares both its CRS and its project", () => {
    expect(find(plan, "capa.geojson")?.outcome).toBe("would_create");
  });

  it("assumes no SRID and attributes no layer to a road by resemblance", () => {
    expect(find(plan, "sin-crs.geojson")?.reason).toMatch(/assumed SRID/);
    expect(find(plan, "sin-proyecto.geojson")?.reason).toMatch(/name resemblance/);
  });

  it("calls a rendered map sheet what it is, rather than dropping it", () => {
    const sheet = find(plan, "MAPAS/PDF/01_BASE.pdf");
    expect(sheet?.outcome).toBe("not_supported");
    expect(sheet?.reason).toMatch(/carries no geometry/);
    expect(find(plan, "XLS/01_RUTA.xlsx")?.outcome).toBe("not_supported");
  });

  it("carries the open decisions through rather than resolving them", () => {
    expect(plan.openDecisions).toEqual(MANIFEST.openDecisions);
  });
});

describe("planning the same manifest a second time", () => {
  /** What the product would hold after the first run had been applied in full. */
  const applied: IntakeSnapshot = {
    tenantSlugs: ["consultora-sintetica"],
    projectSlugsByTenant: { "consultora-sintetica": ["via-uno", "via-dos"] },
    userEmails: ["persona.con.correo@example.invalid", "tercera@example.invalid"],
    projectMemberships: ["consultora-sintetica/via-uno/persona.con.correo@example.invalid"],
    importedLayerHashes: ["b".repeat(64)],
  };
  const plan = planConsultancyIntake(MANIFEST, applied);

  it("proposes nothing: no duplicate tenant, project, identity, membership or dataset", () => {
    expect(plan.counts.would_create).toBe(0);
    expect(plan.nothingToDo).toBe(true);
  });

  it("recognises each one by its stable identifier", () => {
    expect(find(plan, "consultora-sintetica")?.outcome).toBe("exists");
    expect(find(plan, "consultora-sintetica/via-uno")?.outcome).toBe("exists");
    expect(find(plan, "persona.con.correo@example.invalid")?.outcome).toBe("exists");
    expect(
      find(plan, "consultora-sintetica/via-uno/persona.con.correo@example.invalid")?.outcome,
    ).toBe("exists");
    expect(find(plan, "capa.geojson")?.reason).toMatch(/already been imported/);
  });

  it("still withholds what was never decided, rather than quietly settling it", () => {
    // `exists` must never be reached by giving up: the person with no address is still a question.
    expect(find(plan, "sin-correo")?.outcome).toBe("requires_review");
    expect(plan.counts.requires_review).toBeGreaterThan(0);
  });
});

describe("the manifest schema", () => {
  it("rejects an unknown field rather than ignoring it", () => {
    const bad = { ...MANIFEST, sorpresa: true };
    expect(consultancyManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a project role that is not one of the product's own", () => {
    const bad = structuredClone(MANIFEST) as unknown as Record<string, unknown>;
    (bad.people as Array<{ projectRoles: unknown }>)[0]!.projectRoles = [
      { projectKey: "via-uno", role: "JEFE_SUPREMO" },
    ];
    expect(consultancyManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("keeps every delivered spelling of a name", () => {
    const person = MANIFEST.people.find((p) => p.key === "sin-correo");
    expect(person?.name.variants).toEqual(["Persona Sín Correo"]);
  });
});
