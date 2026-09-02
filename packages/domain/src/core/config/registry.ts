import type { z } from "zod";

import {
  DEFAULT_FIELD_OFFLINE_MODE,
  fieldOfflineModeSchema,
  type FieldOfflineMode,
} from "../../field/offline-mode";
import type { CapabilityKey } from "../capabilities/catalog";

/**
 * Typed project configuration (FEATURES.md §4).
 *
 * Configuration answers *how does enabled functionality behave*; a capability answers *does it
 * exist here*. Keeping them apart is what stops a settings toggle from quietly hiding a route, and
 * a route guard from quietly depending on a number.
 *
 * The registry starts with the one key a slice actually needs. It is deliberately not seeded with
 * the illustrative keys listed in FEATURES.md: an unread configuration key is a switch that
 * appears to do something and does not, which is worse than its absence. Each arrives with the
 * code that reads it.
 */
export interface ConfigurationEntry<T> {
  readonly key: string;
  /** The capability this setting belongs to; reading it while that is disabled is an error. */
  readonly capability: CapabilityKey;
  readonly schema: z.ZodType<T>;
  readonly defaultValue: T;
  readonly label: string;
  readonly description: string;
}

export const FIELD_OFFLINE_MODE_KEY = "field.surveys.offline_mode" as const;

export const CONFIGURATION_REGISTRY = {
  [FIELD_OFFLINE_MODE_KEY]: {
    key: FIELD_OFFLINE_MODE_KEY,
    capability: "field.surveys",
    schema: fieldOfflineModeSchema,
    defaultValue: DEFAULT_FIELD_OFFLINE_MODE,
    label: "Modo de captura offline",
    description:
      "Define si las campañas de este proyecto pueden, o deben, capturarse sin conexión. " +
      "Es configuración del proyecto, no una capacidad del producto (D-020, ADR-018).",
  } satisfies ConfigurationEntry<z.infer<typeof fieldOfflineModeSchema>>,
} as const;

export type ConfigurationKey = keyof typeof CONFIGURATION_REGISTRY;

export const CONFIGURATION_KEYS = Object.keys(
  CONFIGURATION_REGISTRY,
) as ReadonlyArray<ConfigurationKey>;

export function isConfigurationKey(value: string): value is ConfigurationKey {
  return Object.hasOwn(CONFIGURATION_REGISTRY, value);
}

/**
 * Read the project's offline-capture policy from whatever the configuration row held.
 *
 * Concrete rather than generic over the registry: with one key, a generic accessor is a type
 * puzzle that buys nothing, and the second key can generalise it when it exists and shows what
 * shape the generalisation should take.
 *
 * A stored value that no longer parses — an enum member removed, a row written by an older
 * version — falls back to the default rather than throwing. A settings row must never be able to
 * take a surface down; it is a value, not a schema.
 */
export function readFieldOfflineMode(stored: unknown): FieldOfflineMode {
  const entry = CONFIGURATION_REGISTRY[FIELD_OFFLINE_MODE_KEY];
  if (stored === undefined || stored === null) return entry.defaultValue;
  const parsed = entry.schema.safeParse(stored);
  return parsed.success ? parsed.data : entry.defaultValue;
}

/** Parse a value on the way *in*. Writing an invalid setting is a real error and does throw. */
export function parseFieldOfflineMode(value: unknown): FieldOfflineMode {
  return CONFIGURATION_REGISTRY[FIELD_OFFLINE_MODE_KEY].schema.parse(value);
}
