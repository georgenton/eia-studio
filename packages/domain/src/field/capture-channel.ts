import { z } from "zod";

import {
  FIELD_OFFLINE_MODE_SEMANTICS,
  OfflineCaptureUnsupported,
  type FieldOfflineMode,
} from "./offline-mode";

/**
 * How a campaign's answers reach EIA Studio.
 *
 * This is the smallest thing that can answer "does this project's offline policy permit this
 * campaign", and nothing more. It is **not** a provider framework: there is no plugin registry, no
 * channel table an administrator can add rows to, and no adapter interface with methods nobody
 * calls. One channel exists, it is the one we built, and its descriptor states plainly what it
 * cannot do.
 *
 * The second entry is **EIA Field**, this product's own mobile application (Wave 1). The earlier
 * plan — that offline capture would arrive as an ODK/Kobo/XLSForm adapter — is superseded for
 * Production V1 and kept as history in `docs/FIELD_CAPTURE_ADAPTER_CONTRACT.md`: an external form
 * product would have put the questionnaire, the identities and the raw answers in somebody else's
 * system, and the mapping back would have been the hard part rather than the capture.
 */
export const CAPTURE_CHANNELS = ["NATIVE_WEB", "EIA_FIELD_MOBILE"] as const;
export const captureChannelSchema = z.enum(CAPTURE_CHANNELS);
export type CaptureChannel = z.infer<typeof captureChannelSchema>;

export interface CaptureChannelDescriptor {
  readonly key: CaptureChannel;
  /**
   * Whether a technician can complete a survey with no connectivity and have it arrive later.
   *
   * `false` for the native web channel, and truthfully so: the browser form posts to the server.
   * There is no queue behind it, so claiming otherwise would cost someone a day of field work.
   *
   * The channel's name and its one-line note are `vocabulary.captureChannel.*` and
   * `vocabulary.captureChannelNote.*` in the message catalogue. This flag is not copy: it decides
   * whether a campaign may activate.
   */
  readonly supportsOffline: boolean;
}

export const CAPTURE_CHANNEL_DESCRIPTORS: Readonly<
  Record<CaptureChannel, CaptureChannelDescriptor>
> = {
  NATIVE_WEB: {
    key: "NATIVE_WEB",
    supportsOffline: false,
  },
  /**
   * EIA Field, the first-party mobile application (Production V1, Wave 1).
   *
   * `supportsOffline: true` is a claim the product now earns rather than asserts: the device holds
   * a downloaded Field Pack, captures into an encrypted local database, queues domain commands in
   * an outbox that survives a restart, and replays them idempotently when a signal returns. It is
   * the reason a project may set `field.surveys.offline_mode = required` and still run a campaign.
   */
  EIA_FIELD_MOBILE: {
    key: "EIA_FIELD_MOBILE",
    supportsOffline: true,
  },
};

export function captureChannel(key: CaptureChannel): CaptureChannelDescriptor {
  return CAPTURE_CHANNEL_DESCRIPTORS[key];
}

/**
 * The one rule that connects the two: a project whose `offline_mode` is `required` cannot run a
 * campaign on a channel that does not support offline capture.
 *
 * Throws rather than returning false, because every caller's next step would be to throw.
 */
export function assertCaptureChannelSatisfiesOfflineMode(
  channel: CaptureChannel,
  offlineMode: FieldOfflineMode,
): void {
  if (FIELD_OFFLINE_MODE_SEMANTICS[offlineMode].allowsOnlineOnlyChannel) return;
  if (captureChannel(channel).supportsOffline) return;
  throw new OfflineCaptureUnsupported(channel, offlineMode);
}

/** Non-throwing form, for a settings surface that wants to explain rather than fail. */
export function captureChannelSatisfiesOfflineMode(
  channel: CaptureChannel,
  offlineMode: FieldOfflineMode,
): boolean {
  return (
    FIELD_OFFLINE_MODE_SEMANTICS[offlineMode].allowsOnlineOnlyChannel ||
    captureChannel(channel).supportsOffline
  );
}
