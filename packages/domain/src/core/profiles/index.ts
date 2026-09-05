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
    "Corredor vial con predios frentistas, abscisado, ficha socioeconómica por predio, consulta significativa, plan de manejo ambiental y social, y generación de capítulo social.",
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
      // The plan the study proposes, not its execution (ADR-024 §6). A road EIA in Ecuador always
      // carries a Plan de Manejo Ambiental y Social; following whether its measures are carried
      // out belongs to `audit.environmental`, which this profile leaves disabled.
      "compliance.pma",
      "client.portal",
    ],
    disabled: ["climate.analytics", "audit.environmental"],
  },
};

export const SYSTEM_PROFILES: ReadonlyMap<string, ProjectProfile> = new Map([
  [ROAD_EIA_SOCIAL_PROFILE.key, ROAD_EIA_SOCIAL_PROFILE],
]);

export function getSystemProfile(key: string): ProjectProfile | undefined {
  return SYSTEM_PROFILES.get(key);
}

/**
 * What a project's profile is called on screen.
 *
 * `road_eia_social` is a key the code matches on; *EIA social vial* is what it means to the person
 * reading a project card. An unknown key falls back to itself rather than to nothing: a profile
 * this build does not know about is a fact worth showing, not a blank.
 */
export function profileLabel(key: string): string {
  return getSystemProfile(key)?.label ?? key;
}
