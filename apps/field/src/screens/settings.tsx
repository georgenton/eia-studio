import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import type { OfflineAccessState } from "@eia/domain/mobile";

import { authClient } from "../auth/client";
import { fieldConfig } from "../config";
import { useT } from "../i18n";
import { LanguageToggle } from "../language-toggle";
import { countPendingWork } from "../core/project-switch";
import { decideSignOut } from "../core/sign-out";

/**
 * The words for the offline window, keyed by the state the domain computes.
 *
 * `OfflineAccessState` is an enum — `valid`, `expiring`, `expired` — and this screen printed it
 * raw, so a Spanish diagnostics screen read "· valid". ADR-025's rule is one sentence: **a stored
 * value is never rendered; a label for it is.** The mapping is exhaustive by type, so adding a
 * fourth state stops compiling here rather than leaking a fourth English word onto the screen.
 */
const OFFLINE_WINDOW_LABEL = {
  valid: "mobile.offlineWindowValid",
  expiring: "mobile.offlineWindowExpiring",
  expired: "mobile.offlineWindowExpired",
} as const satisfies Record<OfflineAccessState, string>;
import { LOCAL_SCHEMA_VERSION, wipeLocalData } from "../db/open";
import { summarisePendingWork } from "../db/repo-v4";
import { useField } from "../store";
import { theme } from "../theme";
import { Body, Button, Card, Heading, Label, Notice, Screen, Title } from "../ui";

/**
 * Settings, and the one destructive action in the application.
 *
 * Signing out discards the session **and the local database**, because what is left behind
 * otherwise is a technician's captured field work on a device that can no longer sync it. It
 * refuses while anything is still pending — asked of the database at the moment of the tap, and
 * about every kind of unsynced work, not just the command queue. Losing a day's work to a stray
 * tap is not a trade this application makes on somebody's behalf.
 *
 * The diagnostic block is counts and versions. No answers, no tokens, no identifiers of people —
 * a diagnostics screen that can be photographed and sent to support must be safe to photograph.
 */
export function SettingsScreen({
  onSignedOut,
  onBack,
}: {
  onSignedOut: () => void;
  onBack: () => void;
}) {
  const t = useT();
  const { db, pack, pendingWork, lastSyncAt, offlineState } = useField();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const config = fieldConfig();

  const signOut = async () => {
    /*
     * Asked of the database, now, and about **every** kind of unsynced work.
     *
     * The guard used to be `pending > 0`, and `pending` is the count of `sync_outbox` rows in
     * state `PENDING` held in the store. Two gaps, and both end with `wipeLocalData` deleting a
     * technician's day:
     *
     *   - a command that failed is not `PENDING`, a draft that never produced a command is not in
     *     the outbox at all, and a photograph waiting to upload lives in `local_media` — none of
     *     them counted, all of them lost;
     *   - the store's number is a snapshot. Between the last refresh and the tap, a capture or a
     *     photograph can arrive, and the screen would still be holding zero.
     *
     * `summarisePendingWork` already answers this properly — six kinds, counted per kind — and
     * `decideProjectSwitch` has been using it to guard *changing project*, which destroys far
     * less than this does. The more destructive action was behind the weaker check.
     */
    if (db) {
      const decision = decideSignOut(await summarisePendingWork(db));
      if (decision.kind === "blocked") {
        setError(t("mobile.signOutBlocked", { count: decision.total }));
        return;
      }
    }
    setBusy(true);
    try {
      await authClient.signOut();
      if (db) await wipeLocalData(db);
      onSignedOut();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("auth.signOutFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Label>{t("mobile.settings")}</Label>
          <Title>{t("mobile.appName")}</Title>
        </View>

        <Card>
          <Heading>{t("locale.label")}</Heading>
          <Body muted>{t("locale.hint")}</Body>
          <LanguageToggle />
        </Card>

        <Card>
          <Heading>{t("mobile.diagnostics")}</Heading>
          <Body muted>{t("mobile.appVersion", { version: config.appVersion })}</Body>
          <Body muted>{t("mobile.environment", { environment: config.environmentLabel })}</Body>
          <Body muted>{t("mobile.localSchema", { version: LOCAL_SCHEMA_VERSION })}</Body>
          {/*
            The same number the chip shows and the same number the sign-out refusal quotes.

            It used to read the command queue, so this screen could say "Pendientes de
            sincronizar: 0" two lines above "Hay 2 elemento(s) sin sincronizar" — one screen
            contradicting itself about the one thing a technician needs to trust.
          */}
          <Body muted>{t("mobile.pendingToSync", { count: countPendingWork(pendingWork) })}</Body>
          <Body muted>
            {lastSyncAt
              ? t("mobile.lastSync", { when: new Date(lastSyncAt).toLocaleString(t.locale) })
              : t("mobile.neverSynced")}
          </Body>
          <Body muted>
            {t("mobile.downloadedWork")}:{" "}
            {pack
              ? `${new Date(pack.validity.expiresAt).toLocaleString(t.locale)}${
                  offlineState ? ` · ${t(OFFLINE_WINDOW_LABEL[offlineState])}` : ""
                }`
              : t("common.missing")}
          </Body>
          <Body muted>{t("mobile.diagnosticsPrivacy")}</Body>
        </Card>

        {error ? <Notice text={error} tone="crit" /> : null}

        <Button
          disabled={busy}
          hint={t("mobile.signOutHint")}
          label={busy ? t("auth.signingOut") : t("auth.signOut")}
          onPress={() => void signOut()}
        />
        <Button label={t("common.back")} onPress={onBack} tone="secondary" />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: theme.space.lg, gap: theme.space.md },
  header: { gap: theme.space.xs },
});
