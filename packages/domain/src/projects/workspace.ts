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
  "reports",
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

export const SURFACE_DEFINITIONS: Readonly<Record<WorkspaceSurface, SurfaceDefinition>> = {
  "command-center": {
    key: "command-center",
    capability: "core.projects",
    label: "Command Center",
    segment: "",
    implemented: true,
    plannedIn: null,
  },
  gis: {
    key: "gis",
    capability: "gis.parcels",
    label: "GIS & Predios",
    segment: "gis",
    implemented: false,
    plannedIn: "la fase de GIS y predios",
  },
  field: {
    key: "field",
    capability: "field.surveys",
    label: "Field Surveys",
    segment: "field",
    implemented: false,
    plannedIn: "la fase de levantamiento de campo",
  },
  social: {
    key: "social",
    capability: "social.analytics",
    label: "Social Intelligence",
    segment: "social",
    implemented: false,
    plannedIn: "la fase de análisis social",
  },
  quality: {
    key: "quality",
    capability: "quality.document_gate",
    label: "Quality Gate",
    segment: "quality",
    implemented: false,
    plannedIn: "la fase de revisión de calidad",
  },
  documents: {
    key: "documents",
    capability: "core.documents",
    label: "Documents",
    segment: "documents",
    implemented: false,
    plannedIn: "una fase posterior",
  },
  reports: {
    key: "reports",
    capability: "reports.social_generator",
    label: "Reports",
    segment: "reports",
    implemented: false,
    plannedIn: "la fase 3",
  },
};

/** Rail order of the approved design: workspace surfaces, then the client portal link. */
export const WORKSPACE_RAIL_ORDER: ReadonlyArray<WorkspaceSurface> = [
  "command-center",
  "gis",
  "field",
  "social",
  "quality",
  "documents",
  "reports",
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

/**
 * Fixed as-of date of a project's demo simulation (IG1-003). Operational values of a
 * DEMO_SIMULATION dataset — the forecast, the activity feed, "pending today" — are anchored to
 * this date rather than to the machine's clock, so the same scenario yields the same figures in
 * every future session. `null` means the project carries no simulation.
 *
 * Historical observed facts do **not** inherit it: an aggregate from a concluded study keeps its
 * own capture date, which is why the two live in different places (the fact's provenance record,
 * versus the project's scenario clock).
 */
export interface DemoScenarioClock {
  readonly scenarioDate: string;
  /** Copy for the badge, e.g. "Escenario demo · fecha de corte: 17 sep 2026". */
  readonly label: string;
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
