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
 * A future ODK/Kobo/XLSForm adapter becomes a second entry here with `supportsOffline: true` and
 * the mapping contract in `docs/FIELD_CAPTURE_ADAPTER_CONTRACT.md`. Adding it will be a change to
 * this list and an adapter package — not a redesign of the campaign model.
 */
export const CAPTURE_CHANNELS = ["NATIVE_WEB"] as const;
export const captureChannelSchema = z.enum(CAPTURE_CHANNELS);
export type CaptureChannel = z.infer<typeof captureChannelSchema>;

export interface CaptureChannelDescriptor {
  readonly key: CaptureChannel;
  readonly label: string;
  /**
   * Whether a technician can complete a survey with no connectivity and have it arrive later.
   *
   * `false` for the native web channel, and truthfully so: the browser form posts to the server.
   * There is no queue behind it, so claiming otherwise would cost someone a day of field work.
   */
  readonly supportsOffline: boolean;
  readonly note: string;
}

export const CAPTURE_CHANNEL_DESCRIPTORS: Readonly<
  Record<CaptureChannel, CaptureChannelDescriptor>
> = {
  NATIVE_WEB: {
    key: "NATIVE_WEB",
    label: "Captura web de EIA Studio",
    supportsOffline: false,
    note: "Formulario web responsivo. Requiere conexión al enviar; no hay cola offline.",
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
