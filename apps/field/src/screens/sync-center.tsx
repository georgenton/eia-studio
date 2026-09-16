import { CONFLICT_REASON_LABEL, type ConflictReason } from "@eia/field-sync-contract";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { pendingCommands, type OutboxRow } from "../db/repo";
import { useField } from "../store";
import { theme } from "../theme";
import { Body, Button, Card, Chip, Heading, Label, Notice, Screen, Title } from "../ui";

/**
 * The screen a technician opens when they want to know whether their day arrived.
 *
 * It answers in counts and in plain sentences: how many commands are waiting, what failed and why,
 * which assignments need somebody to look. It deliberately shows **no answer content** — a
 * diagnostics screen that prints what a household said is a second, unprotected copy of the
 * response.
 */
export function SyncCenterScreen({ onBack }: { onBack: () => void }) {
  const { db, pending, online, syncing, sync, lastSyncAt, lastOutcome, assignments } = useField();
  const [queue, setQueue] = useState<ReadonlyArray<OutboxRow>>([]);

  useEffect(() => {
    if (!db) return;
    void pendingCommands(db, 50).then(setQueue);
  }, [db, pending, syncing]);

  const conflicted = assignments.filter(
    (assignment) => assignment.surveyState === "CONFLICT" || assignment.revokedAt !== null,
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Label>Sincronización</Label>
          <Title>Centro de sincronización</Title>
          <View style={styles.chips}>
            <Chip text={online ? "Con conexión" : "Sin conexión"} tone={online ? "ok" : "warn"} />
            <Chip
              text={pending === 0 ? "Sin pendientes" : `${pending} por sincronizar`}
              tone={pending === 0 ? "ok" : "warn"}
            />
          </View>
          <Body muted>
            {lastSyncAt
              ? `Última sincronización: ${new Date(lastSyncAt).toLocaleString("es-EC")}`
              : "Todavía no se ha sincronizado desde este dispositivo."}
          </Body>
        </View>

        {lastOutcome?.error ? <Notice text={lastOutcome.error} tone="warn" /> : null}

        <Card>
          <Heading>Órdenes pendientes</Heading>
          {queue.length === 0 ? (
            <Body muted>Nada pendiente. Todo lo capturado está en el servidor.</Body>
          ) : (
            queue.map((row) => (
              <View key={row.commandId} style={styles.row}>
                <Body>{describe(row.commandType)}</Body>
                <Body muted>
                  {row.attempts === 0
                    ? "En cola"
                    : `${row.attempts} intento(s)${row.lastError ? ` · ${row.lastError}` : ""}`}
                </Body>
              </View>
            ))
          )}
        </Card>

        {conflicted.length > 0 ? (
          <Card>
            <Heading>Requieren revisión</Heading>
            <Body muted>
              Tu trabajo local se conservó completo. La coordinación del proyecto debe resolver
              estos casos.
            </Body>
            {conflicted.map((assignment) => (
              <View key={assignment.id} style={styles.row}>
                <Body>Predio {assignment.parcelCode}</Body>
                <Body muted>
                  {assignment.conflictReason
                    ? (CONFLICT_REASON_LABEL[assignment.conflictReason as ConflictReason] ??
                      assignment.conflictReason)
                    : "Requiere revisión."}
                </Body>
              </View>
            ))}
          </Card>
        ) : null}

        <Button
          disabled={!online || syncing}
          label={syncing ? "Sincronizando…" : "Sincronizar ahora"}
          onPress={() => void sync()}
        />
        <Button label="Volver" onPress={onBack} tone="secondary" />
      </ScrollView>
    </Screen>
  );
}

function describe(commandType: string): string {
  switch (commandType) {
    case "visit.start":
      return "Inicio de visita";
    case "survey.upsert_draft":
      return "Borrador de ficha";
    case "survey.submit":
      return "Envío de ficha";
    case "visit.finish":
      return "Cierre de visita";
    default:
      return commandType;
  }
}

const styles = StyleSheet.create({
  content: { padding: theme.space.lg, gap: theme.space.md },
  header: { gap: theme.space.xs },
  chips: { flexDirection: "row", gap: theme.space.sm, flexWrap: "wrap" },
  row: { paddingVertical: theme.space.sm, borderTopWidth: 1, borderTopColor: theme.hairline },
});
