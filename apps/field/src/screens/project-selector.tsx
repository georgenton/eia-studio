import type { FieldProjectWithWork } from "@eia/field-sync-contract";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import type { PendingKind } from "../core/project-switch";
import { useT } from "../i18n";
import { useField } from "../store";
import { theme } from "../theme";
import { Body, Button, Card, Chip, Heading, Notice, Screen, Title } from "../ui";

/**
 * *Elegir vía* — which road this phone is working on.
 *
 * ## It never chooses
 *
 * With several projects the list is shown and nothing is downloaded until somebody presses a
 * button. A device that picked the first would be deciding, on a technician's behalf, which
 * study their morning belongs to — which is the decision v3 could not represent at all, and the
 * reason its `multiple_field_projects` was a dead end.
 *
 * With exactly **one** and no project yet, it downloads it: there is nothing to choose between,
 * and making somebody tap a list of length one to begin their day is ceremony.
 *
 * ## Changing road says what is in the way
 *
 * The guard answers one of three things and each gets its own sentence. *Blocked* lists what is
 * unsynced by kind, because "you have unsynced work" sends a person looking. *Offline* explains
 * that the new road is downloaded in full before the old one is touched, which is why it needs a
 * signal. *Allowed* downloads, parses, and only then replaces — a failed download leaves the
 * device exactly as it was.
 */
export function ProjectSelectorScreen({ onDone }: { onDone: () => void }) {
  const t = useT();
  const { workPack, discover, adopt, switchTo, online, pendingWork } = useField();
  const [projects, setProjects] = useState<ReadonlyArray<FieldProjectWithWork> | null>(null);
  const [blocking, setBlocking] = useState<ReadonlyArray<PendingKind>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * Ask the server, then set state — never synchronously in the effect body, which is the
   * cascade React warns about and which the store's own open effect already avoids this way.
   * The `cancelled` flag is the other half: a screen left before the answer arrives sets
   * nothing.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await discover();
      if (cancelled) return;
      if (!result.ok) {
        setError(result.message);
        setProjects([]);
        return;
      }
      setError(null);
      setProjects(result.projects);

      /*
       * One project and nothing active: adopt it. The only automatic download in this screen,
       * and automatic precisely because there is no choice being made for anybody — with two
       * or more, nothing happens until somebody presses a button.
       */
      const only = result.projects.length === 1 ? result.projects[0] : null;
      if (only === null || only === undefined || workPack !== null) return;
      const adopted = await adopt({
        tenantSlug: only.tenantSlug,
        projectSlug: only.projectSlug,
      });
      if (cancelled) return;
      if (adopted.ok) onDone();
      else setError(adopted.message ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [adopt, discover, onDone, workPack]);

  const choose = async (project: FieldProjectWithWork) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    setBlocking([]);
    try {
      const scope = { tenantSlug: project.tenantSlug, projectSlug: project.projectSlug };
      if (workPack === null) {
        const result = await adopt(scope);
        if (result.ok) onDone();
        else setError(result.message ?? null);
        return;
      }
      const result = await switchTo(scope);
      if (result.kind === "switched") {
        setMessage(t("mobile.switchDone"));
        onDone();
      } else if (result.kind === "blocked") {
        setBlocking(result.blocking);
      } else if (result.kind === "offline") {
        setError(t("mobile.switchOffline"));
      } else {
        setError(result.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Title>{t("mobile.chooseProject")}</Title>
        <Body muted>{t("mobile.chooseProjectLead")}</Body>

        {workPack === null ? null : (
          <Card>
            <Heading>{t("mobile.activeProject")}</Heading>
            <Body>{workPack.project.projectName}</Body>
          </Card>
        )}

        {blocking.length > 0 ? (
          <Notice
            text={`${t("mobile.switchBlocked")} ${blocking
              .map((kind) => `${pendingCount(pendingWork, kind)} ${t(labelFor(kind))}`)
              .join(" · ")}`}
            tone="warn"
          />
        ) : null}
        {message ? <Notice text={message} tone="ok" /> : null}
        {error ? <Notice text={error} tone="crit" /> : null}
        {!online ? <Notice text={t("mobile.switchOffline")} tone="warn" /> : null}

        {projects !== null && projects.length === 0 ? (
          <Card>
            <Heading>{t("mobile.noProjects")}</Heading>
            <Body muted>{t("mobile.noProjectsBody")}</Body>
          </Card>
        ) : null}

        {(projects ?? []).map((project) => (
          <Card key={`${project.tenantSlug}/${project.projectSlug}`}>
            <Heading>{project.projectName}</Heading>
            <View style={styles.chips}>
              {project.work.includes("survey") ? (
                <Chip text={t("mobile.surveys")} tone="neutral" />
              ) : null}
              {project.work.includes("socialization") ? (
                <Chip text={t("mobile.invitations")} tone="neutral" />
              ) : null}
            </View>
            <Button
              disabled={busy || !online}
              label={t("mobile.workInThisProject")}
              onPress={() => void choose(project)}
            />
          </Card>
        ))}

        <Button label={t("common.back")} onPress={onDone} tone="secondary" />
      </ScrollView>
    </Screen>
  );
}

function pendingCount(pending: Record<PendingKind, number>, kind: PendingKind): number {
  return pending[kind];
}

/** One message key per kind, so a refusal names the thing rather than a category. */
function labelFor(kind: PendingKind) {
  const map = {
    outboxPending: "mobile.pendingOutboxPending",
    outboxFailed: "mobile.pendingOutboxFailed",
    unsyncedSurveys: "mobile.pendingUnsyncedSurveys",
    pendingMedia: "mobile.pendingPendingMedia",
    unsettledDeliveries: "mobile.pendingUnsettledDeliveries",
    pendingEvidence: "mobile.pendingPendingEvidence",
  } as const satisfies Record<PendingKind, string>;
  return map[kind];
}

const styles = StyleSheet.create({
  content: { padding: theme.space.lg, gap: theme.space.md },
  chips: { flexDirection: "row", gap: theme.space.sm, flexWrap: "wrap" },
});
