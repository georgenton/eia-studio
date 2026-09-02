import { z } from "zod";

import { InvalidInput } from "../core/errors";

/**
 * Offline capture policy (Architecture decision D-020, ADR-018).
 *
 * D-020 asked whether offline field capture is a **capability** or a **configuration**. It is
 * configuration. The capability catalogue stays at its fourteen approved keys, `field.surveys`
 * covers field capture, and how a project captures is a setting under it —
 * `field.surveys.offline_mode`.
 *
 * The distinction is the one FEATURES.md §1 draws: a capability answers *does this functionality
 * exist here*, and gates navigation, routes, actions and jobs; a configuration answers *how does
 * enabled functionality behave*. Offline capture is the second question. A project with offline
 * disabled still has FieldFlow, the same routes and the same surfaces; only the channel it may
 * capture through differs. Making it a capability would also have meant a fifteenth key whose
 * absence hides a surface the project can plainly use.
 */
export const FIELD_OFFLINE_MODES = ["disabled", "optional", "required"] as const;
export const fieldOfflineModeSchema = z.enum(FIELD_OFFLINE_MODES);
export type FieldOfflineMode = z.infer<typeof fieldOfflineModeSchema>;

/** Default for a project that has never chosen: online capture, which is what we can actually do. */
export const DEFAULT_FIELD_OFFLINE_MODE: FieldOfflineMode = "disabled";

export interface OfflineModeSemantics {
  readonly label: string;
  /** What the mode means, in the words the settings surface uses. */
  readonly description: string;
  /** Whether a campaign may activate on a channel that cannot work offline. */
  readonly allowsOnlineOnlyChannel: boolean;
}

export const FIELD_OFFLINE_MODE_SEMANTICS: Readonly<
  Record<FieldOfflineMode, OfflineModeSemantics>
> = {
  disabled: {
    label: "Sin captura offline",
    description:
      "El proyecto captura en línea. El canal web de EIA Studio es válido para sus campañas.",
    allowsOnlineOnlyChannel: true,
  },
  optional: {
    label: "Captura offline opcional",
    description:
      "La captura en línea sigue siendo válida. Un canal con soporte offline puede usarse cuando " +
      "esté configurado, pero no es obligatorio.",
    allowsOnlineOnlyChannel: true,
  },
  required: {
    label: "Captura offline obligatoria",
    description:
      "Una campaña no puede activarse si su canal de captura no declara soporte offline. El canal " +
      "web de EIA Studio no lo tiene todavía.",
    allowsOnlineOnlyChannel: false,
  },
};

/**
 * A project requires offline capture but the campaign's channel cannot do it.
 *
 * This is the honest outcome, and the point of closing D-020 this way: the product does not
 * pretend. There is no service worker queue, no IndexedDB answer store and no sync protocol in
 * this slice, so a project that genuinely needs offline capture cannot run a campaign on the
 * native web channel — and says so, at activation, instead of losing a technician's day of work
 * in a tunnel.
 */
export class OfflineCaptureUnsupported extends InvalidInput {
  constructor(
    readonly channel: string,
    readonly offlineMode: FieldOfflineMode,
  ) {
    super(
      `capture channel ${channel} does not support offline capture, which this project requires ` +
        `(field.surveys.offline_mode = ${offlineMode})`,
    );
    this.name = "OfflineCaptureUnsupported";
  }
}
