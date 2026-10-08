import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";

import { downloadProject } from "../sync/engine";
import { useT } from "../i18n";
import { useField } from "../store";
import { theme } from "../theme";
import { Body, Button, Card, Chip, Heading, Label, Notice, Screen, Title } from "../ui";
import type { LocalAssignmentRow } from "../db/repo";
import type { LocalInvitationRow } from "../db/repo-v4";

/**
 * *Mi trabajo* — the list a technician opens standing beside a road.
 *
 * It shows two states per row and never merges them: what the **server** thinks of the assignment,
 * and what this **device** holds. A row that says *Enviada en el dispositivo · pendiente de
 * sincronización* is telling the truth about both, and that sentence is the reason this
 * application exists.
 */
export function MyWorkScreen({
  onOpen,
  onOpenInvitation,
  onChooseProject,
}: {
  onOpen: (assignmentId: string) => void;
  onOpenInvitation: (invitationId: string) => void;
  onChooseProject: () => void;
}) {
  const t = useT();
  const {
    workPack,
    pack,
    assignments,
    invitations,
    pending,
    online,
    syncing,
    sync,
    refresh,
    db,
    offlineState,
  } = useField();
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  /*
   * Re-download the active road's work. **Choosing** a road is the selector's job, and a device
   * with none is sent there rather than having one picked for it.
   */
  const download = async () => {
    if (!db || !workPack) {
      onChooseProject();
      return;
    }
    const result = await downloadProject(db, {
      tenantSlug: workPack.project.tenantSlug,
      projectSlug: workPack.project.projectSlug,
    });
    setMessage(result.ok ? t("mobile.workUpdated") : result.message);
    await refresh();
  };

  const needle = query.trim().toLowerCase();
  const visibleInvitations = invitations.filter(
    (invitation) =>
      needle === "" ||
      invitation.parcelCode.toLowerCase().includes(needle) ||
      invitation.eventTitle.toLowerCase().includes(needle),
  );
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
          <Label>{workPack?.project.projectName ?? t("mobile.downloadedWork")}</Label>
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

        {/*
         * Two kinds of work, never merged. A technician's surveys and their invitations are
         * different jobs with different states, and one list with one counter would answer
         * neither question. A project with no survey work shows no campaign at all rather
         * than an empty one — `pack` is null in that case, by design.
         */}
        <Label>{t("mobile.surveys")}</Label>
        {pack === null ? (
          <Card>
            <Body muted>{t("mobile.noSurveyWork")}</Body>
          </Card>
        ) : visible.length === 0 ? (
          <Card>
            <Heading>{t("mobile.noAssignments")}</Heading>
            <Body muted>{t("mobile.noAssignmentsBody")}</Body>
          </Card>
        ) : (
          visible.map((assignment) => (
            <AssignmentRow assignment={assignment} key={assignment.id} onOpen={onOpen} />
          ))
        )}

        <Label>{t("mobile.invitations")}</Label>
        {visibleInvitations.length === 0 ? (
          <Card>
            <Heading>{t("mobile.noInvitations")}</Heading>
            <Body muted>{t("mobile.noInvitationsBody")}</Body>
          </Card>
        ) : (
          visibleInvitations.map((invitation) => (
            <InvitationRow invitation={invitation} key={invitation.id} onOpen={onOpenInvitation} />
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
          <Button label={t("mobile.changeProject")} onPress={onChooseProject} tone="secondary" />
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

/**
 * One invitation, with the two states that must not be merged: what the **server** last said
 * about it, and what this **device** holds against it.
 *
 * `REQUIRES_REVIEW` stays visible after another sync, because it is not a transport failure
 * that will clear itself — a person has to look at it.
 */
function InvitationRow({
  invitation,
  onOpen,
}: {
  invitation: LocalInvitationRow;
  onOpen: (id: string) => void;
}) {
  const t = useT();
  const state = invitation.attemptState;
  return (
    <Card onPress={() => onOpen(invitation.id)}>
      <Heading>
        {t("mobile.parcel")} {invitation.parcelCode}
      </Heading>
      <Body>{invitation.eventTitle}</Body>
      <Body muted>
        {[
          new Date(invitation.startsAt).toLocaleString(),
          invitation.locationLabel,
          invitation.recipientLabel,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Body>
      <View style={styles.chips}>
        {state === null ? (
          <Chip text={t("mobile.recordDelivery")} tone="neutral" />
        ) : (
          <Chip
            text={t(`mobile.deliveryState${state}` as "mobile.deliveryStateSAVED")}
            tone={
              state === "SYNCED"
                ? "ok"
                : state === "REQUIRES_REVIEW" || state === "SYNC_ERROR"
                  ? "crit"
                  : "warn"
            }
          />
        )}
        {invitation.revoked ? <Chip text={t("mobile.invitationRevoked")} tone="crit" /> : null}
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
