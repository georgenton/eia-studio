import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, TextInput, View } from "react-native";

import { readInvitation, type LocalInvitationRow } from "../db/repo-v4";
import { useT } from "../i18n";
import { useField } from "../store";
import { mayRecordDelivery } from "../core/delivery";
import { DeliveryNeedsPhotograph, saveDelivery } from "../sync/evidence-capture";
import { theme } from "../theme";
import { Body, Button, Card, Chip, Heading, Label, Notice, Screen, Title } from "../ui";

type Outcome = "DELIVERED" | "ABSENT" | "REFUSED" | "OTHER";
const OUTCOMES: ReadonlyArray<Outcome> = ["DELIVERED", "ABSENT", "REFUSED", "OTHER"];

/**
 * *Registrar entrega* — what happened when a technician reached a gate.
 *
 * ## What the screen refuses, and when
 *
 * A **delivered** invitation needs a photograph, and the button is unavailable until there is
 * one. That refusal happens here, standing in the road, rather than three hours later when the
 * sync runs: the evidence is the thing that cannot be recreated afterwards, and telling somebody
 * about it once they are home is telling them too late.
 *
 * The other three outcomes record that *nothing was delivered*, so there is nothing to evidence.
 * Requiring a photograph of an empty gate teaches people to photograph empty gates.
 *
 * ## Saving needs no connection, and starts no upload
 *
 * The row and the file land on the device and that is the end of the interaction. A technician
 * with eleven gates to visit should not be waiting on a radio between them; the upload happens
 * on the next sync, and the card on *Mi trabajo* says where each attempt has got to.
 *
 * GPS is captured when it is available and stored empty when it is not. It is never invented.
 */
export function InvitationDeliveryScreen({
  invitationId,
  onBack,
}: {
  invitationId: string;
  onBack: () => void;
}) {
  const t = useT();
  const { db, refresh, offlineState } = useField();
  const [invitation, setInvitation] = useState<LocalInvitationRow | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("DELIVERED");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<{
    sourceUri: string;
    mimeType: string;
    sizeBytes: number;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!db) return;
      const row = await readInvitation(db, invitationId);
      if (!cancelled) setInvitation(row);
    })();
    return () => {
      cancelled = true;
    };
  }, [db, invitationId]);

  if (!invitation) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.content}>
          <Title>{t("mobile.invitations")}</Title>
          <Button label={t("common.back")} onPress={onBack} tone="secondary" />
        </ScrollView>
      </Screen>
    );
  }

  /*
   * The camera, never the photo library — the same rule a visit's photograph follows (ADR-032).
   * A picker over the whole device is a picker over everything else on it.
   */
  const takePhoto = async () => {
    setError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError(t("mobile.cameraDenied"));
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      // Not edited and not re-encoded by us beyond the camera's own compression: evidence a
      // device silently altered is not the photograph the technician took.
      allowsEditing: false,
      quality: 0.8,
      exif: false,
    });
    if (shot.canceled || !shot.assets[0]) return;
    const asset = shot.assets[0];
    setPhoto({
      sourceUri: asset.uri,
      mimeType: asset.mimeType === "image/png" ? "image/png" : "image/jpeg",
      sizeBytes: asset.fileSize ?? 0,
    });
    setMessage(t("mobile.photoTaken"));
  };

  const save = async () => {
    if (!db) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const where = await readLocation();
      if (where === null) setMessage(t("mobile.locationDenied"));
      await saveDelivery(db, {
        newId: Crypto.randomUUID,
        invitationId: invitation.id,
        // Read from the pack at this moment. A reassignment afterwards is then a conflict the
        // server names, rather than a silent re-attribution of this walk to somebody else.
        invitationRevision: invitation.revision,
        outcome,
        note: note.trim() === "" ? null : note.trim(),
        location: where,
        photo,
      });
      await refresh();
      onBack();
    } catch (cause) {
      setError(
        cause instanceof DeliveryNeedsPhotograph
          ? t("mobile.photoRequired")
          : cause instanceof Error && cause.name === "OfflineWorkExpired"
            ? t("mobile.offlineExpired")
            : cause instanceof Error && cause.name === "InvitationNoLongerCapturable"
              ? t("mobile.invitationRevokedBody")
              : cause instanceof Error
                ? cause.message
                : t("mobile.photoRequired"),
      );
    } finally {
      setBusy(false);
    }
  };

  const needsPhoto = outcome === "DELIVERED" && photo === null;
  /*
   * The device already knows. A revocation or a settled status that arrived in a pull means a
   * new attempt here would be a walk to a gate and a photograph that comes back as a conflict —
   * so the screen stops offering the form rather than letting somebody spend their morning on
   * it. An attempt made *before* the news arrived is untouched: it keeps its row, its
   * photograph and its place in the queue.
   */
  const expired = offlineState === "expired";
  /*
   * Two reasons a gate is not worth walking to. The invitation is no longer this technician's,
   * or the downloaded work has lapsed and the server is no longer standing behind this
   * device's access (ADR-028). Either way the form is not offered, and either way everything
   * already captured stays and still syncs.
   */
  const capturable = mayRecordDelivery(invitation) && !expired;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Label>{t("mobile.invitationEvent")}</Label>
        <Title>{invitation.eventTitle}</Title>

        <Card>
          <Heading>
            {t("mobile.parcel")} {invitation.parcelCode}
          </Heading>
          <Body muted>
            {t("mobile.invitationWhen")}: {formatWhen(invitation)}
          </Body>
          <Body muted>
            {t("mobile.invitationWhere")}: {invitation.locationLabel}
          </Body>
          {invitation.recipientLabel === null ? null : (
            <Body muted>
              {t("mobile.invitationRecipient")}: {invitation.recipientLabel}
            </Body>
          )}
          {invitation.purpose === null ? null : <Body>{invitation.purpose}</Body>}
          {invitation.revoked ? <Chip text={t("mobile.invitationRevoked")} tone="crit" /> : null}
        </Card>

        {capturable ? null : (
          <Notice
            text={
              expired
                ? t("mobile.offlineExpired")
                : invitation.revoked
                  ? t("mobile.invitationRevokedBody")
                  : t("mobile.invitationSettledBody")
            }
            tone={expired ? "crit" : "warn"}
          />
        )}

        {capturable ? (
          <>
            <Label>{t("mobile.deliveryResult")}</Label>
            <View style={styles.outcomes}>
              {OUTCOMES.map((candidate) => (
                <Button
                  key={candidate}
                  label={t(`mobile.outcome${candidate}` as "mobile.outcomeDELIVERED")}
                  onPress={() => setOutcome(candidate)}
                  tone={candidate === outcome ? "primary" : "secondary"}
                />
              ))}
            </View>

            {outcome === "DELIVERED" ? (
              <Card>
                <Heading>{t("mobile.deliveryPhoto")}</Heading>
                <Body muted>{t("mobile.photoRequired")}</Body>
                <Button
                  label={photo === null ? t("mobile.takePhoto") : t("mobile.retakePhoto")}
                  onPress={() => void takePhoto()}
                  tone={photo === null ? "primary" : "secondary"}
                />
              </Card>
            ) : null}

            <Label>{t("mobile.deliveryNote")}</Label>
            <TextInput
              accessibilityLabel={t("mobile.deliveryNote")}
              maxLength={300}
              multiline
              onChangeText={setNote}
              style={styles.note}
              value={note}
            />

            {message ? <Notice text={message} tone="ok" /> : null}
            {error ? <Notice text={error} tone="crit" /> : null}

            <Button
              disabled={busy || needsPhoto}
              label={t("mobile.saveDelivery")}
              onPress={() => void save()}
            />
          </>
        ) : null}
        <Button label={t("common.back")} onPress={onBack} tone="secondary" />
      </ScrollView>
    </Screen>
  );
}

function formatWhen(invitation: LocalInvitationRow): string {
  // The event's own zone beside the instant, because an invitation prints the hour as written.
  return `${new Date(invitation.startsAt).toLocaleString()} · ${invitation.timezone}`;
}

/**
 * The technician's own position, when there is one.
 *
 * `null` for every reason there might not be: no permission, no fix, no attempt. Never a
 * fabricated point — a coordinate in this record is read later as *where somebody stood*.
 */
async function readLocation(): Promise<{
  latitude: number;
  longitude: number;
  accuracyM: number | null;
} | null> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) return null;
  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyM: position.coords.accuracy ?? null,
    };
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  content: { padding: theme.space.lg, gap: theme.space.md },
  outcomes: { gap: theme.space.sm },
  note: {
    minHeight: theme.touch * 2,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius,
    backgroundColor: theme.surface,
    padding: theme.space.md,
    fontSize: theme.font.body,
    color: theme.ink,
    textAlignVertical: "top",
  },
});
