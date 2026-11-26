import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { visitStartCommand } from "../core/commands";
import { mediaStateFor } from "../core/media-upload";
import {
  attachMediaLocation,
  enqueue,
  insertVisit,
  listMediaForAssignment,
  upsertSurvey,
} from "../db/repo";
import type { LocalMediaRecord } from "../db/repo";
import { captureMedia } from "../sync/media";
import { fieldConfig } from "../config";
import { useT } from "../i18n";
import { useField } from "../store";
import { theme } from "../theme";
import { Body, Button, Card, Chip, Heading, Label, Notice, Screen, Title } from "../ui";

/**
 * One assignment: where the parcel is, and the two actions a technician takes there.
 *
 * ## Location
 *
 * Asked for when the visit starts, and recorded as **what happened**: captured, denied,
 * unavailable, or not attempted. A refused permission is a fact about the visit, not an error to
 * retry until it succeeds, and a coordinate is never synthesised to fill the column. It is the
 * *technician's* position at that moment — the domain says so, and this screen says so on the
 * button — never an inference about where a household lives.
 */
export function AssignmentScreen({
  assignmentId,
  onOpenSurvey,
  onBack,
}: {
  assignmentId: string;
  onOpenSurvey: (assignmentId: string) => void;
  onBack: () => void;
}) {
  const t = useT();
  const { db, pack, assignments, refresh, offlineState } = useField();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [media, setMedia] = useState<ReadonlyArray<LocalMediaRecord>>([]);
  // Bumped after a capture, so the effect below re-reads. A counter rather than a callback,
  // because the hooks must run before the early return and a stable dependency is what makes that
  // readable.
  const [mediaVersion, setMediaVersion] = useState(0);
  const assignment = assignments.find((row) => row.id === assignmentId);

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    void (async () => {
      const rows = await listMediaForAssignment(db, assignmentId);
      if (!cancelled) setMedia(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [assignmentId, db, mediaVersion]);

  if (!assignment || !pack) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.content}>
          <Title>{t("mobile.parcelUnavailable")}</Title>
          <Button label={t("common.back")} onPress={onBack} tone="secondary" />
        </ScrollView>
      </Screen>
    );
  }

  const startVisit = async () => {
    if (!db) return;
    setBusy(true);
    setMessage(null);
    try {
      const { coords, outcome } = await readLocation();
      const visitId = Crypto.randomUUID();
      await insertVisit(db, {
        id: visitId,
        assignmentId: assignment.id,
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
        accuracyM: coords?.accuracy ?? null,
        locationCapturedAt: coords ? new Date().toISOString() : null,
        locationOutcome: outcome,
      });
      const surveyId = Crypto.randomUUID();
      await upsertSurvey(db, {
        id: surveyId,
        assignmentId: assignment.id,
        visitId,
        surveyVersionId: pack.campaign.surveyVersion.id,
        state: "DRAFT",
      });
      await enqueue(db, {
        entityKind: "visit",
        entityLocalId: visitId,
        command: visitStartCommand(
          {
            appVersion: fieldConfig().appVersion,
            deviceRevision: 0,
            occurredAt: new Date(),
            newId: () => Crypto.randomUUID(),
          },
          {
            assignmentId: assignment.id,
            location: coords
              ? {
                  latitude: coords.latitude,
                  longitude: coords.longitude,
                  accuracyM: coords.accuracy ?? null,
                  capturedAt: new Date().toISOString(),
                }
              : null,
            locationOutcome: outcome,
          },
        ),
      });
      await refresh();
      onOpenSurvey(assignment.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("mobile.startVisit"));
    } finally {
      setBusy(false);
    }
  };

  const hasLocalWork = assignment.localSurveyId !== null;

  /**
   * Take a photograph, and keep it before anything else is attempted.
   *
   * The order is the guarantee (ADR-032): the file is copied into this application's own directory
   * and the row is written **first**, offline, with no server involved. Upload happens later, when
   * there is signal, and the local file is not released until the server says the row exists.
   *
   * The camera is asked for directly rather than offering the photo library: a photograph of a
   * parcel is evidence of *this* visit, and a picker over the whole device is a picker over
   * everything else on it.
   */
  const capture = async (kind: "parcel" | "affectation" | "access" | "other") => {
    if (!db) return;
    setMessage(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setMessage(t("mobile.cameraDenied"));
      return;
    }
    setBusy(true);
    try {
      const shot = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        // Not edited and not re-encoded by us beyond the camera's own compression: a photograph a
        // device silently altered is not the photograph the technician took.
        allowsEditing: false,
        quality: 0.8,
        exif: false,
      });
      if (shot.canceled || !shot.assets[0]) return;
      const asset = shot.assets[0];
      /*
       * **The photograph is kept before anything that can block is attempted.**
       *
       * This used to `await readLocation()` first and pass the result into `captureMedia`, which
       * meant the file was still in the picker's cache — a directory the operating system clears
       * on its own schedule — for as long as the platform took to answer. `getCurrentPositionAsync`
       * has no timeout of its own, so indoors, with the aerial blocked, that wait is unbounded:
       * a technician who backgrounded the app, or an Android that reclaimed it, lost the
       * photograph entirely and the row that would have described it was never written.
       *
       * Now the order is the one every other durable thing in this application uses: persist,
       * then enrich. `captureMedia` copies the file into the application's own documents directory
       * and writes the row marked `pending`, and the position is attached to that row afterwards.
       * A process that dies in between leaves a photograph with its location recorded as
       * unavailable, which is a true statement and a deliverable file.
       */
      const localId = await captureMedia(db, {
        assignmentId,
        visitServerId: assignment.openVisitId ?? null,
        sourceUri: asset.uri,
        mimeType: asset.mimeType === "image/png" ? "image/png" : "image/jpeg",
        sizeBytes: asset.fileSize ?? 0,
        kind,
        note: null,
        locationIntent: "will_ask",
      });
      setMediaVersion((version) => version + 1);
      /*
       * Bounded, and its outcome is always written. The photograph is already safe, so the only
       * thing at stake here is whether the study learns where it was taken — never the evidence
       * itself. A refusal, a timeout and a platform error are three different recorded facts, and
       * none of them is a coordinate.
       */
      const where = await readPhotographLocation();
      await attachMediaLocation(db, localId, where);
      /*
       * **And the shared summary.** `mediaVersion` only re-reads this parcel's own list; the store
       * holds the number every other surface shows — the chip, the badge, Ajustes and the Centro
       * de sincronización. Without this it stayed as it was until the next synchronisation or
       * pull-to-refresh: observed on the emulator on 19 November 2026 with the chip reading
       * *2 por sincronizar* while the phone held three things.
       *
       * What this is **not**: a data-loss fix. The sign-out refusal does not read this number —
       * since ADR-028's hardening it calls `summarisePendingWork` against the database at the
       * moment of the tap, precisely because a snapshot can be stale (`screens/settings.tsx`).
       * The defect here is a count a technician reads, which is reason enough.
       */
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("mobile.captureFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Label>{pack.campaign.name}</Label>
          <Title>
            {t("mobile.parcel")} {assignment.parcelCode}
          </Title>
          <Body muted>
            {[
              assignment.sectorLabel,
              assignment.chainageLabel
                ? `${t("mobile.chainageAbbrev")} ${assignment.chainageLabel}`
                : null,
              assignment.side
                ? t(`vocabulary.parcelSide.${assignment.side}` as "vocabulary.parcelSide.left")
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || t("mobile.noContext")}
          </Body>
        </View>

        {/*
            A correction revisit says what it is and why, and nothing about the previous answers
            (ADR-038). The reason is a coordinator's own words; the old response stays on the
            server, where reading it is a permission this technician does not hold.
        */}
        {assignment.correctsAssignmentId !== null ? (
          <>
            <Chip text={t("mobile.correctionRevisit")} tone="warn" />
            <Notice text={t("mobile.correctionNotice")} tone="warn" />
            {assignment.correctionReason ? (
              <Body muted>
                {t("mobile.correctionWhy", { reason: assignment.correctionReason })}
              </Body>
            ) : null}
          </>
        ) : null}
        {assignment.revokedAt ? <Notice text={t("mobile.assignmentRevoked")} tone="crit" /> : null}
        {offlineState === "expired" ? (
          <Notice text={t("mobile.offlineExpired")} tone="crit" />
        ) : null}
        {message ? <Notice text={message} tone="crit" /> : null}

        <Card>
          <Heading>{pack.campaign.surveyVersion.templateName}</Heading>
          <Body muted>
            {t("common.version")} {pack.campaign.surveyVersion.versionLabel}
          </Body>
          <Chip
            text={t("mobile.questions", { count: pack.campaign.surveyVersion.questions.length })}
          />
        </Card>

        <Card>
          <Heading>{t("mobile.photographs")}</Heading>
          {/* The distinction that matters on a phone with no signal: *on the device* is not
           *the server has it*, and a photograph waiting for a connection is safe. */}
          <Body muted>{t("mobile.photographsNote")}</Body>
          {media.length === 0 ? (
            <Body muted>{t("mobile.noPhotographs")}</Body>
          ) : (
            <View style={styles.mediaList}>
              {media.map((item) => (
                <Chip
                  key={item.localId}
                  text={`${t(`vocabulary.mediaKind.${item.kind}` as "vocabulary.mediaKind.parcel")} · ${t(
                    `vocabulary.mediaState.${mediaStateFor({
                      ...item,
                      attempts: item.attempts,
                    })}` as "vocabulary.mediaState.PENDING_UPLOAD",
                  )}`}
                />
              ))}
            </View>
          )}
          <View style={styles.mediaActions}>
            {(["parcel", "affectation", "access"] as const).map((kind) => (
              <Button
                disabled={busy || offlineState === "expired"}
                key={kind}
                label={t(`vocabulary.mediaKind.${kind}` as "vocabulary.mediaKind.parcel")}
                onPress={() => void capture(kind)}
                tone="secondary"
              />
            ))}
          </View>
        </Card>

        <View style={styles.actions}>
          {hasLocalWork ? (
            <Button
              label={t("mobile.continueSurvey")}
              onPress={() => onOpenSurvey(assignment.id)}
            />
          ) : (
            <Button
              disabled={busy || offlineState === "expired"}
              hint={t("vocabulary.locationOutcome.captured")}
              label={busy ? t("mobile.startingVisit") : t("mobile.startVisit")}
              onPress={() => void startVisit()}
            />
          )}
          <Button label={t("common.back")} onPress={onBack} tone="secondary" />
        </View>
      </ScrollView>
    </Screen>
  );
}

/**
 * Ask once, and record the answer honestly.
 *
 * Four outcomes, and three of them are "no coordinate". A denied permission is not retried in a
 * loop and never becomes a fabricated point: the visit is recorded with *why* it has no location,
 * which is a fact the study can read later.
 */
async function readLocation(): Promise<{
  coords: { latitude: number; longitude: number; accuracy: number | null } | null;
  outcome: "captured" | "denied" | "unavailable" | "not_attempted";
}> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) return { coords: null, outcome: "denied" };
  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      coords: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy ?? null,
      },
      outcome: "captured",
    };
  } catch {
    return { coords: null, outcome: "unavailable" };
  }
}

/** How long a photograph's position request may take before it is recorded as timed out. */
const LOCATION_TIMEOUT_MS = 12_000;

/**
 * The position of a photograph: bounded, and reported exactly as the platform reported it.
 *
 * `getCurrentPositionAsync` resolves when it has a fix and otherwise waits — there is no timeout
 * parameter — so the bound is ours. Twelve seconds is long enough for a warm fix outdoors and
 * short enough that a technician under a tin roof is not left holding the screen; the photograph
 * is already saved, so the only consequence of giving up is a recorded absence.
 *
 * Nothing stands in for a position that was not obtained. No `0,0`, no centroid of the parcel, no
 * last known fix: those are three ways of writing a coordinate nobody measured into a study's
 * evidence (ADR-032).
 *
 * `mocked` is read from the platform and never inferred. Android sets it on a position produced by
 * a mock provider, which is every position an emulator reports, and a simulated point presented as
 * a measurement is the one thing this metadata exists to prevent.
 */
async function readPhotographLocation(): Promise<{
  outcome: "captured" | "denied" | "unavailable" | "timed_out";
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  locatedAt: string | null;
  mocked: boolean | null;
  source: string | null;
}> {
  const absent = {
    latitude: null,
    longitude: null,
    accuracyM: null,
    locatedAt: null,
    mocked: null,
    source: null,
  } as const;

  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) return { outcome: "denied", ...absent };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), LOCATION_TIMEOUT_MS);
      }),
    ]);
    if (position === "timeout") return { outcome: "timed_out", ...absent };
    return {
      outcome: "captured",
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyM: position.coords.accuracy ?? null,
      // The platform's own timestamp for the fix, not the clock at the moment we read it.
      locatedAt: new Date(position.timestamp).toISOString(),
      mocked: typeof position.mocked === "boolean" ? position.mocked : null,
      source: permission.android?.accuracy === "coarse" ? "coarse" : null,
    };
  } catch {
    return { outcome: "unavailable", ...absent };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const styles = StyleSheet.create({
  content: { padding: theme.space.lg, gap: theme.space.md },
  header: { gap: theme.space.xs },
  actions: { gap: theme.space.sm, marginTop: theme.space.md },
  mediaList: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs },
  mediaActions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs },
});
