import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { authClient } from "../auth/client";
import { fieldConfig } from "../config";
import { theme } from "../theme";
import { Body, Button, Label, Notice, Screen, Title } from "../ui";

/**
 * Signing in, which must happen **with a connection**, at least once.
 *
 * The screen says so before the technician is standing somewhere it cannot happen. That is the
 * whole of the offline access policy in one sentence: authenticate here, download your work, and
 * the device will keep working without a signal until the downloaded window lapses.
 */
export function SignInScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const config = fieldConfig();

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (result.error) {
      setError("No pudimos iniciar sesión. Revisa el correo y la contraseña.");
      return;
    }
    onSignedIn();
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Label>EIA Studio</Label>
            <Title>EIA Field</Title>
            <Body muted>
              Inicia sesión con conexión una vez. Después podrás trabajar sin señal hasta que venza
              el trabajo descargado.
            </Body>
          </View>

          <View style={styles.field}>
            <Label>Correo institucional</Label>
            <TextInput
              accessibilityLabel="Correo institucional"
              autoCapitalize="none"
              autoComplete="email"
              inputMode="email"
              onChangeText={setEmail}
              style={styles.input}
              value={email}
            />
          </View>
          <View style={styles.field}>
            <Label>Contraseña</Label>
            <TextInput
              accessibilityLabel="Contraseña"
              autoCapitalize="none"
              onChangeText={setPassword}
              secureTextEntry
              style={styles.input}
              value={password}
            />
          </View>

          {error ? <Notice text={error} tone="crit" /> : null}

          <Button
            disabled={busy || email.trim() === "" || password === ""}
            label={busy ? "Entrando…" : "Entrar"}
            onPress={() => void submit()}
          />
          <Body muted>{config.environmentLabel}</Body>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: theme.space.lg, gap: theme.space.lg, flexGrow: 1, justifyContent: "center" },
  header: { gap: theme.space.xs },
  field: { gap: theme.space.xs },
  input: {
    minHeight: theme.touch,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius,
    backgroundColor: theme.surface,
    paddingHorizontal: theme.space.md,
    fontSize: theme.font.body,
    color: theme.ink,
  },
});
