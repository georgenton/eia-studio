import type { ConflictReason } from "@eia/field-sync-contract";
import type { Translator } from "@eia/i18n";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { pendingCommands, type OutboxRow } from "../db/repo";
import { useT } from "../i18n";
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
  const t = useT();
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
          <Label>{t("mobile.syncCentre")}</Label>
          <Title>{t("mobile.syncCentre")}</Title>
          <View style={styles.chips}>
            <Chip
              text={online ? t("systemState.online") : t("systemState.offline")}
              tone={online ? "ok" : "warn"}
            />
            <Chip
              text={
                pending === 0 ? t("mobile.noPending") : t("mobile.pendingCount", { count: pending })
              }
              tone={pending === 0 ? "ok" : "warn"}
            />
          </View>
          <Body muted>
            {lastSyncAt
              ? t("mobile.lastSync", { when: new Date(lastSyncAt).toLocaleString(t.locale) })
              : t("mobile.neverSynced")}
          </Body>
        </View>

        {lastOutcome?.error ? <Notice text={lastOutcome.error} tone="warn" /> : null}

        <Card>
          <Heading>{t("mobile.pendingCommands")}</Heading>
          {queue.length === 0 ? (
            <Body muted>{t("mobile.nothingPending")}</Body>
          ) : (
            queue.map((row) => (
              <View key={row.commandId} style={styles.row}>
                <Body>{describe(t, row.commandType)}</Body>
                <Body muted>
                  {row.attempts === 0
                    ? t("mobile.queued")
                    : `${t("mobile.attempts", { count: row.attempts })}${
                        row.lastError ? ` · ${row.lastError}` : ""
                      }`}
                </Body>
              </View>
            ))
          )}
        </Card>

        {conflicted.length > 0 ? (
          <Card>
            <Heading>{t("mobile.needsReview")}</Heading>
            <Body muted>{t("mobile.needsReviewBody")}</Body>
            {conflicted.map((assignment) => (
              <View key={assignment.id} style={styles.row}>
                <Body>
                  {t("mobile.parcel")} {assignment.parcelCode}
                </Body>
                <Body muted>
                  {assignment.conflictReason
                    ? t(
                        `mobile.conflictReason.${assignment.conflictReason as ConflictReason}` as "mobile.conflictReason.campaign_closed",
                      )
                    : t("mobile.localSurveyState.CONFLICT")}
                </Body>
              </View>
            ))}
          </Card>
        ) : null}

        <Button
          disabled={!online || syncing}
          label={syncing ? t("mobile.syncing") : t("mobile.syncNow")}
          onPress={() => void sync()}
        />
        <Button label={t("common.back")} onPress={onBack} tone="secondary" />
      </ScrollView>
    </Screen>
  );
}

/**
 * A command type as a sentence. The catalogue's keys carry no dots — lookup is by dotted path —
 * so the mapping from the wire's `visit.start` to `mobile.commandType.visitStart` lives here.
 */
function describe(t: Translator, commandType: string): string {
  switch (commandType) {
    case "visit.start":
      return t("mobile.commandType.visitStart");
    case "survey.upsert_draft":
      return t("mobile.commandType.surveyUpsertDraft");
    case "survey.submit":
      return t("mobile.commandType.surveySubmit");
    case "visit.finish":
      return t("mobile.commandType.visitFinish");
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
