/**
 * Centralised capability catalogue (FEATURES.md §2, ADR-002). Exactly the 14 approved keys.
 * `navigationPresentationHint` is shell-only metadata and never reaches authorization.
 */
export const CAPABILITY_KEYS = [
  "core.projects",
  "core.documents",
  "gis.maps",
  "gis.parcels",
  "field.surveys",
  "social.analytics",
  "social.ai_coding",
  "quality.document_gate",
  "quality.rag_assistant",
  "reports.social_generator",
  "client.portal",
  "climate.analytics",
  "compliance.pma",
  "audit.environmental",
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

/** Product availability in the catalogue: only AVAILABLE can ever resolve to enabled. */
export type ProductStatus = "AVAILABLE" | "ANNOUNCED" | "EXTENSION" | "UNAVAILABLE";

export type DomainModule =
  | "projects"
  | "documents"
  | "gis"
  | "field"
  | "social"
  | "quality"
  | "reports"
  | "pgas"
  | "client-portal"
  | "extension";

export interface CapabilityDefinition {
  readonly key: CapabilityKey;
  readonly module: DomainModule;
  readonly dependsOn: ReadonlyArray<CapabilityKey>;
  readonly productStatus: ProductStatus;
  /** Spanish label/description as shown in Tenant Settings › Módulos. */
  readonly label: string;
  readonly description: string;
  /** Copy for the `feature disabled` state. */
  readonly whoCanEnable: string;
}

const OWNER_ENABLES = "Un Owner puede activarlo en Tenant Settings › Módulos.";
const EXTENSION_COPY =
  "Este módulo es una extensión del catálogo. Un Owner puede solicitarla y activarla en Tenant Settings › Módulos.";

export const CAPABILITY_CATALOG: Readonly<Record<CapabilityKey, CapabilityDefinition>> = {
  "core.projects": {
    key: "core.projects",
    module: "projects",
    dependsOn: [],
    productStatus: "AVAILABLE",
    label: "Project Management",
    description: "Proyectos, unidades, planificación",
    whoCanEnable: OWNER_ENABLES,
  },
  "core.documents": {
    key: "core.documents",
    module: "documents",
    dependsOn: ["core.projects"],
    // AVAILABLE since Slice 6: the surface exists, versions are immutable and chunks are cited.
    productStatus: "AVAILABLE",
    label: "Documents",
    description: "Repositorio y versionado documental",
    whoCanEnable: OWNER_ENABLES,
  },
  "gis.maps": {
    key: "gis.maps",
    module: "gis",
    dependsOn: ["core.projects"],
    productStatus: "AVAILABLE",
    label: "GIS Maps",
    description: "Capas, eje vial, visor cartográfico",
    whoCanEnable: OWNER_ENABLES,
  },
  "gis.parcels": {
    key: "gis.parcels",
    module: "gis",
    dependsOn: ["gis.maps"],
    productStatus: "AVAILABLE",
    label: "Parcel Management",
    description: "Predios, abscisas, afectaciones",
    whoCanEnable: OWNER_ENABLES,
  },
  "field.surveys": {
    key: "field.surveys",
    module: "field",
    dependsOn: ["gis.parcels"],
    productStatus: "AVAILABLE",
    label: "Field Surveys",
    description: "Instrumentos, visitas, FieldFlow móvil",
    whoCanEnable: OWNER_ENABLES,
  },
  "social.analytics": {
    key: "social.analytics",
    module: "social",
    dependsOn: ["field.surveys"],
    productStatus: "AVAILABLE",
    label: "Social Analytics",
    description: "Tabulación, frecuencias, cruces",
    whoCanEnable: OWNER_ENABLES,
  },
  "social.ai_coding": {
    key: "social.ai_coding",
    module: "social",
    dependsOn: ["social.analytics"],
    productStatus: "AVAILABLE",
    label: "AI Social Coding",
    description: "Codificación asistida de respuestas abiertas",
    whoCanEnable: OWNER_ENABLES,
  },
  "quality.document_gate": {
    key: "quality.document_gate",
    module: "quality",
    dependsOn: ["core.projects"],
    productStatus: "AVAILABLE",
    label: "Quality Gate",
    description: "Bandeja de hallazgos previa a entrega",
    whoCanEnable: OWNER_ENABLES,
  },
  "quality.rag_assistant": {
    key: "quality.rag_assistant",
    module: "quality",
    dependsOn: ["core.documents"],
    // AVAILABLE since Slice 6. What is available is *retrieval with citations*; the narrative
    // paragraph needs a generator, and where none is configured the surface says so and shows the
    // cited passages (ADR-021 §4). A capability is about whether the functionality exists here, not
    // about whether an external provider happens to be reachable.
    productStatus: "AVAILABLE",
    label: "RAG Assistant",
    description: "Consulta sobre el corpus del proyecto",
    whoCanEnable: OWNER_ENABLES,
  },
  "reports.social_generator": {
    key: "reports.social_generator",
    module: "reports",
    dependsOn: ["social.analytics", "core.documents"],
    // AVAILABLE since Slice 7. What is available is a traceable *draft*: a deterministic snapshot,
    // versioned and downloadable, whose prose is optional (ADR-022). Approval is not built.
    productStatus: "AVAILABLE",
    label: "Report Generation",
    description: "Borradores con trazabilidad de datos",
    whoCanEnable: OWNER_ENABLES,
  },
  "client.portal": {
    key: "client.portal",
    module: "client-portal",
    dependsOn: ["core.projects"],
    productStatus: "AVAILABLE",
    label: "Client Portal",
    description: "Vista externa agregada y de solo lectura",
    whoCanEnable: OWNER_ENABLES,
  },
  "climate.analytics": {
    key: "climate.analytics",
    module: "extension",
    dependsOn: ["core.projects"],
    productStatus: "EXTENSION",
    label: "Climate Analytics",
    description: "Variables climáticas y escenarios",
    whoCanEnable: EXTENSION_COPY,
  },
  "compliance.pma": {
    key: "compliance.pma",
    module: "pgas",
    dependsOn: ["core.documents"],
    productStatus: "AVAILABLE",
    label: "Plan de Manejo",
    /*
     * Narrowed deliberately (ADR-024 §6). What is built is the *design* half: the plan the study
     * proposes, its measures, and what each one states or leaves blank. Following whether the
     * measures are being carried out is `audit.environmental`, which is still an extension and
     * still hidden — and the description says so, because a capability named "compliance" that
     * showed a checklist would be read as one.
     */
    description: "Plan de Manejo Ambiental y Social del estudio: programas, medidas y su detalle",
    whoCanEnable: OWNER_ENABLES,
  },
  "audit.environmental": {
    key: "audit.environmental",
    module: "extension",
    dependsOn: ["core.projects"],
    productStatus: "EXTENSION",
    label: "Environmental Audit",
    description: "Auditorías de cumplimiento",
    whoCanEnable: EXTENSION_COPY,
  },
};

export function isCapabilityKey(value: string): value is CapabilityKey {
  return (CAPABILITY_KEYS as readonly string[]).includes(value);
}
