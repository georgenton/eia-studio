import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { authClient } from "../auth/client";
import { fieldConfig } from "../config";
import { useT } from "../i18n";
import { LanguageToggle } from "../language-toggle";
import { LOCAL_SCHEMA_VERSION, wipeLocalData } from "../db/open";
import { useField } from "../store";
import { theme } from "../theme";
import { Body, Button, Card, Heading, Label, Notice, Screen, Title } from "../ui";

/**
 * Settings, and the one destructive action in the application.
 *
 * Signing out discards the session **and the local database**, because what is left behind
 * otherwise is a technician's captured field work on a device that can no longer sync it. It
 * refuses while anything is still pending: losing a day's work to a stray tap is not a trade this
 * application makes on somebody's behalf.
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
  const { db, pack, pending, lastSyncAt, offlineState } = useField();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const config = fieldConfig();

  const signOut = async () => {
    if (pending > 0) {
      setError(t("mobile.signOutBlocked", { count: pending }));
      return;
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
          <Body muted>{t("mobile.pendingToSync", { count: pending })}</Body>
          <Body muted>
            {lastSyncAt
              ? t("mobile.lastSync", { when: new Date(lastSyncAt).toLocaleString(t.locale) })
              : t("mobile.neverSynced")}
          </Body>
          <Body muted>
            {t("mobile.downloadedWork")}:{" "}
            {pack
              ? `${new Date(pack.validity.expiresAt).toLocaleString(t.locale)}${
                  offlineState ? ` · ${offlineState}` : ""
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
