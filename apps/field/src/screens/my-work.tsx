import { LOCAL_SURVEY_STATE_LABEL } from "@eia/field-sync-contract";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";

import { refreshFieldPack } from "../sync/engine";
import { useField } from "../store";
import { theme } from "../theme";
import { Body, Button, Card, Chip, Heading, Label, Notice, Screen, Title } from "../ui";
import type { LocalAssignmentRow } from "../db/repo";

/**
 * *Mi trabajo* — the list a technician opens standing beside a road.
 *
 * It shows two states per row and never merges them: what the **server** thinks of the assignment,
 * and what this **device** holds. A row that says *Enviada en el dispositivo · pendiente de
 * sincronización* is telling the truth about both, and that sentence is the reason this
 * application exists.
 */
export function MyWorkScreen({ onOpen }: { onOpen: (assignmentId: string) => void }) {
  const { pack, assignments, pending, online, syncing, sync, refresh, db, offlineState } =
    useField();
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const download = async () => {
    if (!db || !pack) return;
    const result = await refreshFieldPack(db, {
      tenantSlug: pack.project.tenantSlug,
      projectSlug: pack.project.projectSlug,
    });
    setMessage(result.ok ? "Trabajo actualizado." : result.message);
    await refresh();
  };

  const needle = query.trim().toLowerCase();
  const visible = assignments.filter(
    (assignment) =>
      needle === "" ||
      assignment.parcelCode.toLowerCase().includes(needle) ||
      (assignment.sectorLabel ?? "").toLowerCase().includes(needle) ||
      (assignment.chainageLabel ?? "").includes(needle),
  );

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl onRefresh={() => void sync()} refreshing={syncing} />}
      >
        <View style={styles.header}>
          <Label>{pack?.project.projectName ?? "Sin proyecto descargado"}</Label>
          <Title>Mi trabajo</Title>
          <View style={styles.chips}>
            <Chip text={online ? "Con conexión" : "Sin conexión"} tone={online ? "ok" : "warn"} />
            <Chip
              text={pending === 0 ? "Todo sincronizado" : `${pending} por sincronizar`}
              tone={pending === 0 ? "ok" : "warn"}
            />
          </View>
        </View>

        {offlineState === "expired" ? (
          <Notice
            text="El trabajo descargado venció. Conéctate para renovarlo; lo que ya capturaste sigue guardado y se sincronizará."
            tone="crit"
          />
        ) : offlineState === "expiring" ? (
          <Notice
            text="El trabajo descargado vence pronto. Conéctate antes de salir a campo."
            tone="warn"
          />
        ) : null}

        {message ? <Notice text={message} tone="ok" /> : null}

        <TextInput
          accessibilityLabel="Buscar predio"
          onChangeText={setQuery}
          placeholder="Buscar por predio, sector o abscisa"
          style={styles.search}
          value={query}
        />

        {visible.length === 0 ? (
          <Card>
            <Heading>Sin predios asignados</Heading>
            <Body muted>
              Descarga tu trabajo cuando tengas señal. Si crees que deberías tener predios
              asignados, habla con la coordinación del proyecto.
            </Body>
          </Card>
        ) : (
          visible.map((assignment) => (
            <AssignmentRow assignment={assignment} key={assignment.id} onOpen={onOpen} />
          ))
        )}

        <View style={styles.actions}>
          <Button
            disabled={!online || syncing}
            hint="Envía lo capturado y descarga los cambios del servidor."
            label={syncing ? "Sincronizando…" : "Sincronizar ahora"}
            onPress={() => void sync()}
          />
          <Button
            disabled={!online}
            label="Actualizar trabajo asignado"
            onPress={() => void download()}
            tone="secondary"
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

function AssignmentRow({
  assignment,
  onOpen,
}: {
  assignment: LocalAssignmentRow;
  onOpen: (id: string) => void;
}) {
  const revoked = assignment.revokedAt !== null;
  return (
    <Card onPress={() => onOpen(assignment.id)}>
      <Heading>Predio {assignment.parcelCode}</Heading>
      <Body muted>
        {[
          assignment.sectorLabel,
          assignment.chainageLabel ? `ABS ${assignment.chainageLabel}` : null,
          assignment.side,
        ]
          .filter(Boolean)
          .join(" · ") || "Sin contexto adicional"}
      </Body>
      <View style={styles.chips}>
        <Chip
          text={LOCAL_SURVEY_STATE_LABEL[assignment.surveyState]}
          tone={
            assignment.surveyState === "SYNCED"
              ? "ok"
              : assignment.surveyState === "CONFLICT" || assignment.surveyState === "SYNC_ERROR"
                ? "crit"
                : assignment.surveyState === "NOT_STARTED"
                  ? "neutral"
                  : "warn"
          }
        />
        {revoked ? <Chip text="Requiere revisión" tone="crit" /> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { padding: theme.space.lg, gap: theme.space.md },
  header: { gap: theme.space.xs },
  chips: { flexDirection: "row", gap: theme.space.sm, flexWrap: "wrap" },
  search: {
    minHeight: theme.touch,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius,
    backgroundColor: theme.surface,
    paddingHorizontal: theme.space.md,
    fontSize: theme.font.body,
    color: theme.ink,
  },
  actions: { gap: theme.space.sm, marginTop: theme.space.md },
});
