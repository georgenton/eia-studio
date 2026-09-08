import { z } from "zod";

import type { CapabilityKey } from "../core/capabilities/catalog";
import type { ProvenanceFacets } from "../provenance/facets";

/**
 * Workspace surfaces (design v0.2 §03 and the rail of the approved shell). One registry drives
 * the rail, the breadcrumb and the route guard, so a surface can never appear in navigation
 * without a capability behind it, nor be reachable by URL without `requireCapability`.
 *
 * `implemented` says whether this slice ships the surface. It is presentation metadata only:
 * an unimplemented surface is still capability-guarded server-side, exactly like a built one.
 */
export const WORKSPACE_SURFACES = [
  "command-center",
  "gis",
  "field",
  "social",
  "quality",
  "documents",
  "pgas",
  "reports",
  "portal",
] as const;

export const workspaceSurfaceSchema = z.enum(WORKSPACE_SURFACES);
export type WorkspaceSurface = z.infer<typeof workspaceSurfaceSchema>;

export interface SurfaceDefinition {
  readonly key: WorkspaceSurface;
  /** The capability that governs the surface; the rail and the route both consult it. */
  readonly capability: CapabilityKey;
  readonly label: string;
  /** URL segment under `/t/:tenant/p/:project`; empty for the project root. */
  readonly segment: string;
  readonly implemented: boolean;
  /** Shown on the placeholder when the surface is not part of this slice. */
  readonly plannedIn: string | null;
}

/**
 * The rail, in the language of the people who use it (ADR-025).
 *
 * The approved bundle names these modules in English — *Command Center*, *Social Intelligence*,
 * *Quality Gate*. They read as product branding to the people who wrote them and as untranslated
 * software to the environmental consultant who has to use the product. The keys, the capability
 * names and the URL segments are unchanged: only the words on the screen are Spanish.
 */
export const SURFACE_DEFINITIONS: Readonly<Record<WorkspaceSurface, SurfaceDefinition>> = {
  "command-center": {
    key: "command-center",
    capability: "core.projects",
    label: "Centro de control",
    segment: "",
    implemented: true,
    plannedIn: null,
  },
  gis: {
    key: "gis",
    capability: "gis.parcels",
    label: "Cartografía y predios",
    segment: "gis",
    implemented: true,
    plannedIn: null,
  },
  field: {
    key: "field",
    capability: "field.surveys",
    label: "Trabajo de campo",
    segment: "field",
    implemented: true,
    plannedIn: null,
  },
  social: {
    key: "social",
    capability: "social.analytics",
    label: "Análisis social",
    segment: "social",
    implemented: true,
    plannedIn: null,
  },
  quality: {
    key: "quality",
    capability: "quality.document_gate",
    label: "Control de consistencia",
    segment: "quality",
    implemented: true,
    plannedIn: null,
  },
  documents: {
    key: "documents",
    capability: "core.documents",
    label: "Documentos",
    segment: "documents",
    implemented: true,
    plannedIn: null,
  },
  pgas: {
    key: "pgas",
    capability: "compliance.pma",
    label: "Plan de Manejo",
    segment: "pgas",
    implemented: true,
    plannedIn: null,
  },
  reports: {
    key: "reports",
    capability: "reports.social_generator",
    label: "Informes",
    segment: "reports",
    implemented: true,
    plannedIn: null,
  },
  /**
   * Preparing and publishing what the client sees. The *client's* page is not this surface and is
   * not in the rail: it is a separate route group with its own chrome (ADR-009), and this one is
   * where the firm decides what goes into it.
   */
  portal: {
    key: "portal",
    capability: "client.portal",
    label: "Portal del cliente",
    segment: "portal",
    implemented: true,
    plannedIn: null,
  },
};

/**
 * Rail order: the order the work happens in.
 *
 * *Proyecto → territorio → levantamiento → resultados → revisión → gestión ambiental → documentos
 * → informe.* The management plan sits before the documents and the report because that is where a
 * consultant reaches it: after the findings are reviewed and before the chapter is written. The
 * approved bundle's grouping is unchanged; only the position of the plan moved, and only because
 * the plan did not exist when the bundle was drawn.
 */
export const WORKSPACE_RAIL_ORDER: ReadonlyArray<WorkspaceSurface> = [
  "command-center",
  "gis",
  "field",
  "social",
  "quality",
  "pgas",
  "documents",
  "reports",
  // Last, because publishing is the last thing that happens: everything above is the work, and
  // this is the decision to show some of it to the customer.
  "portal",
];

export function isWorkspaceSurface(value: string): value is WorkspaceSurface {
  return (WORKSPACE_SURFACES as ReadonlyArray<string>).includes(value);
}

/** Resolve a URL segment back to its surface; the project root is the Command Center. */
export function surfaceForSegment(segment: string): SurfaceDefinition | null {
  for (const key of WORKSPACE_SURFACES) {
    const def = SURFACE_DEFINITIONS[key];
    if (def.segment === segment) return def;
  }
  return null;
}

/** Severity of an item in "Requiere atención hoy"; always rendered with a label, not colour alone. */
export const ATTENTION_SEVERITIES = ["high", "medium", "low"] as const;
export const attentionSeveritySchema = z.enum(ATTENTION_SEVERITIES);
export type AttentionSeverity = z.infer<typeof attentionSeveritySchema>;

export const ATTENTION_SEVERITY_LABEL: Readonly<Record<AttentionSeverity, string>> = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

export interface AttentionItem {
  readonly id: string;
  readonly severity: AttentionSeverity;
  readonly title: string;
  readonly note: string | null;
  /** Where the item lives, e.g. "Quality Gate"; a label, not a link. */
  readonly surfaceLabel: string;
  /** Target surface when it exists in this slice; null renders no action link. */
  readonly surface: WorkspaceSurface | null;
  readonly actionLabel: string | null;
  readonly provenanceId: string;
  readonly provenance: ProvenanceFacets;
}

export interface ActivityEvent {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actorLabel: string;
  readonly action: string;
  readonly objectLabel: string | null;
  readonly provenanceId: string;
  readonly provenance: ProvenanceFacets;
}
