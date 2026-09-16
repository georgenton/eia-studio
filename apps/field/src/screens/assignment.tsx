import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { visitStartCommand } from "../core/commands";
import { enqueue, insertVisit, upsertSurvey } from "../db/repo";
import { fieldConfig } from "../config";
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
  const { db, pack, assignments, refresh, offlineState } = useField();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const assignment = assignments.find((row) => row.id === assignmentId);

  if (!assignment || !pack) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.content}>
          <Title>Predio no disponible</Title>
          <Button label="Volver" onPress={onBack} tone="secondary" />
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
      setMessage(error instanceof Error ? error.message : "No se pudo iniciar la visita.");
    } finally {
      setBusy(false);
    }
  };

  const hasLocalWork = assignment.localSurveyId !== null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Label>{pack.campaign.name}</Label>
          <Title>Predio {assignment.parcelCode}</Title>
          <Body muted>
            {[
              assignment.sectorLabel,
              assignment.chainageLabel ? `ABS ${assignment.chainageLabel}` : null,
              assignment.side,
            ]
              .filter(Boolean)
              .join(" · ") || "Sin contexto adicional"}
          </Body>
        </View>

        {assignment.revokedAt ? (
          <Notice
            text="Esta asignación ya no aparece en tu trabajo del servidor. Lo que capturaste aquí se conservó y la coordinación debe revisarlo."
            tone="crit"
          />
        ) : null}
        {offlineState === "expired" ? (
          <Notice
            text="El trabajo descargado venció. Conéctate para renovarlo antes de iniciar una visita nueva."
            tone="crit"
          />
        ) : null}
        {message ? <Notice text={message} tone="crit" /> : null}

        <Card>
          <Heading>{pack.campaign.surveyVersion.templateName}</Heading>
          <Body muted>Versión {pack.campaign.surveyVersion.versionLabel}</Body>
          <Chip text={`${pack.campaign.surveyVersion.questions.length} preguntas`} />
        </Card>

        <View style={styles.actions}>
          {hasLocalWork ? (
            <Button label="Continuar ficha" onPress={() => onOpenSurvey(assignment.id)} />
          ) : (
            <Button
              disabled={busy || offlineState === "expired"}
              hint="Registra tu posición si lo autorizas; nunca se inventa una ubicación."
              label={busy ? "Iniciando…" : "Iniciar visita"}
              onPress={() => void startVisit()}
            />
          )}
          <Button label="Volver" onPress={onBack} tone="secondary" />
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

const styles = StyleSheet.create({
  content: { padding: theme.space.lg, gap: theme.space.md },
  header: { gap: theme.space.xs },
  actions: { gap: theme.space.sm, marginTop: theme.space.md },
});
