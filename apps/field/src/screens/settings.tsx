import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { authClient } from "../auth/client";
import { fieldConfig } from "../config";
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
  const { db, pack, pending, lastSyncAt, offlineState } = useField();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const config = fieldConfig();

  const signOut = async () => {
    if (pending > 0) {
      setError(
        `Hay ${pending} elemento(s) sin sincronizar. Sincroniza antes de cerrar sesión: al cerrarla se borra el trabajo guardado en este dispositivo.`,
      );
      return;
    }
    setBusy(true);
    try {
      await authClient.signOut();
      if (db) await wipeLocalData(db);
      onSignedOut();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cerrar la sesión.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Label>Ajustes</Label>
          <Title>EIA Field</Title>
        </View>

        <Card>
          <Heading>Idioma</Heading>
          <Body muted>Español (Ecuador). Otros idiomas llegan en una entrega posterior.</Body>
        </Card>

        <Card>
          <Heading>Diagnóstico</Heading>
          <Body muted>Versión de la aplicación: {config.appVersion}</Body>
          <Body muted>Entorno: {config.environmentLabel}</Body>
          <Body muted>Esquema local: v{LOCAL_SCHEMA_VERSION}</Body>
          <Body muted>Pendientes de sincronizar: {pending}</Body>
          <Body muted>
            Última sincronización:{" "}
            {lastSyncAt ? new Date(lastSyncAt).toLocaleString("es-EC") : "nunca"}
          </Body>
          <Body muted>
            Trabajo descargado:{" "}
            {pack
              ? `vence ${new Date(pack.validity.expiresAt).toLocaleString("es-EC")} · ${offlineState ?? ""}`
              : "sin descargar"}
          </Body>
          <Body muted>
            Este diagnóstico no incluye respuestas, identificadores de personas ni credenciales.
          </Body>
        </Card>

        {error ? <Notice text={error} tone="crit" /> : null}

        <Button
          disabled={busy}
          hint="Borra la sesión y los datos guardados en este dispositivo."
          label={busy ? "Cerrando…" : "Cerrar sesión"}
          onPress={() => void signOut()}
        />
        <Button label="Volver" onPress={onBack} tone="secondary" />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: theme.space.lg, gap: theme.space.md },
  header: { gap: theme.space.xs },
});
