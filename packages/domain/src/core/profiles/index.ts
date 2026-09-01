import type { CapabilityKey } from "../capabilities/catalog";

/**
 * Project profiles (ADR-003): versioned templates copied into a project at creation.
 * Slice 0 carries only the capability part; instruments, taxonomies and rule sets arrive with
 * their slices. The pilot profile is a system profile (tenantId null); it is generic to linear
 * corridor studies and contains no pilot-project data.
 */
export interface ProjectProfile {
  readonly key: string;
  readonly version: number;
  readonly label: string;
  readonly description: string;
  readonly territorialModel: { readonly unitKind: "linear_corridor" | "site" | "zone" };
  readonly capabilities: {
    readonly enabled: ReadonlyArray<CapabilityKey>;
    readonly disabled: ReadonlyArray<CapabilityKey>;
  };
}

export const ROAD_EIA_SOCIAL_PROFILE: ProjectProfile = {
  key: "road_eia_social",
  version: 1,
  label: "EIA social vial",
  description:
    "Corredor vial con predios frentistas, abscisado, ficha socioeconómica por predio, consulta significativa y generación de capítulo social.",
  territorialModel: { unitKind: "linear_corridor" },
  capabilities: {
    enabled: [
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
    ],
    disabled: ["climate.analytics", "compliance.pma", "audit.environmental"],
  },
};

export const SYSTEM_PROFILES: ReadonlyMap<string, ProjectProfile> = new Map([
  [ROAD_EIA_SOCIAL_PROFILE.key, ROAD_EIA_SOCIAL_PROFILE],
]);

export function getSystemProfile(key: string): ProjectProfile | undefined {
  return SYSTEM_PROFILES.get(key);
}
