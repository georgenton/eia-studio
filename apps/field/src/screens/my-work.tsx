import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";

import { refreshFieldPack } from "../sync/engine";
import { useT } from "../i18n";
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
  const t = useT();
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
    setMessage(result.ok ? t("mobile.workUpdated") : result.message);
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
          <Label>{pack?.project.projectName ?? t("mobile.downloadedWork")}</Label>
          <Title>{t("mobile.myWork")}</Title>
          <View style={styles.chips}>
            <Chip
              text={online ? t("systemState.online") : t("systemState.offline")}
              tone={online ? "ok" : "warn"}
            />
            <Chip
              text={
                pending === 0 ? t("mobile.allSynced") : t("mobile.pendingCount", { count: pending })
              }
              tone={pending === 0 ? "ok" : "warn"}
            />
          </View>
        </View>

        {offlineState === "expired" ? (
          <Notice text={t("mobile.offlineExpired")} tone="crit" />
        ) : offlineState === "expiring" ? (
          <Notice text={t("mobile.offlineExpiring")} tone="warn" />
        ) : null}

        {message ? <Notice text={message} tone="ok" /> : null}

        <TextInput
          accessibilityLabel={t("common.search")}
          onChangeText={setQuery}
          placeholder={t("mobile.searchPlaceholder")}
          style={styles.search}
          value={query}
        />

        {visible.length === 0 ? (
          <Card>
            <Heading>{t("mobile.noAssignments")}</Heading>
            <Body muted>{t("mobile.noAssignmentsBody")}</Body>
          </Card>
        ) : (
          visible.map((assignment) => (
            <AssignmentRow assignment={assignment} key={assignment.id} onOpen={onOpen} />
          ))
        )}

        <View style={styles.actions}>
          <Button
            disabled={!online || syncing}
            hint={t("mobile.syncNow")}
            label={syncing ? t("mobile.syncing") : t("mobile.syncNow")}
            onPress={() => void sync()}
          />
          <Button
            disabled={!online}
            label={t("mobile.refreshWork")}
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
  const t = useT();
  const revoked = assignment.revokedAt !== null;
  return (
    <Card onPress={() => onOpen(assignment.id)}>
      <Heading>
        {t("mobile.parcel")} {assignment.parcelCode}
      </Heading>
      {/* A revisit is not a second household (ADR-038); the row says so before it is opened. */}
      {assignment.correctsAssignmentId !== null ? (
        <Chip text={t("mobile.correctionRevisit")} tone="warn" />
      ) : null}
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
      <View style={styles.chips}>
        <Chip
          text={t(
            `mobile.localSurveyState.${assignment.surveyState}` as "mobile.localSurveyState.DRAFT",
          )}
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
        {revoked ? <Chip text={t("mobile.localSurveyState.CONFLICT")} tone="crit" /> : null}
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
