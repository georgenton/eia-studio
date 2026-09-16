import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { authClient } from "./src/auth/client";
import { AssignmentScreen } from "./src/screens/assignment";
import { MyWorkScreen } from "./src/screens/my-work";
import { SettingsScreen } from "./src/screens/settings";
import { SignInScreen } from "./src/screens/sign-in";
import { SurveyScreen } from "./src/screens/survey";
import { SyncCenterScreen } from "./src/screens/sync-center";
import { FieldProvider, useField } from "./src/store";
import { theme } from "./src/theme";
import { Body, Button, Notice, Screen, Title } from "./src/ui";

/**
 * Five screens and a stack of one.
 *
 * A router would be a dependency, a build step and a set of conventions in exchange for navigation
 * this application can express as a discriminated union. It is written out because it is small
 * enough to read in one sitting, which is worth more here than the generality.
 */
type Route =
  | { readonly name: "my-work" }
  | { readonly name: "assignment"; readonly assignmentId: string }
  | { readonly name: "survey"; readonly assignmentId: string }
  | { readonly name: "sync" }
  | { readonly name: "settings" };

export default function App() {
  return (
    <SafeAreaProvider>
      <FieldProvider>
        <Root />
      </FieldProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  const { data: session, isPending } = authClient.useSession();
  const [route, setRoute] = useState<Route>({ name: "my-work" });
  const { db, openError, sync, online, pending } = useField();

  /*
   * The guaranteed synchronisation pathways: opening the application, and connectivity returning
   * while it is open. Both are foreground and both are the technician's own action or an event
   * they can see the result of — which is the point. Background sync is an enhancement that has
   * not been built, and nothing about data safety is allowed to depend on one (Phase 18).
   */
  const attempt = useCallback(() => {
    if (online && pending > 0) void sync();
  }, [online, pending, sync]);

  useEffect(() => {
    attempt();
  }, [attempt]);

  if (isPending) {
    return (
      <SafeAreaView style={styles.centre}>
        <ActivityIndicator color={theme.accent} size="large" />
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.flex}>
        <StatusBar style="dark" />
        <SignInScreen onSignedIn={() => setRoute({ name: "my-work" })} />
      </SafeAreaView>
    );
  }

  if (openError) {
    return (
      <SafeAreaView style={styles.flex}>
        <Screen>
          <View style={styles.centreContent}>
            <Title>No se pudo abrir el almacenamiento local</Title>
            <Notice text={openError} tone="crit" />
            <Body muted>
              EIA Field guarda el trabajo de campo cifrado en el dispositivo. Si no puede cifrarlo,
              no lo guarda: pide una compilación de desarrollo (no Expo Go) o reinstala la
              aplicación.
            </Body>
          </View>
        </Screen>
      </SafeAreaView>
    );
  }

  if (!db) {
    return (
      <SafeAreaView style={styles.centre}>
        <ActivityIndicator color={theme.accent} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex}>
      <StatusBar style="dark" />
      {route.name === "my-work" ? (
        <MyWorkScreen onOpen={(assignmentId) => setRoute({ name: "assignment", assignmentId })} />
      ) : route.name === "assignment" ? (
        <AssignmentScreen
          assignmentId={route.assignmentId}
          onBack={() => setRoute({ name: "my-work" })}
          onOpenSurvey={(assignmentId) => setRoute({ name: "survey", assignmentId })}
        />
      ) : route.name === "survey" ? (
        <SurveyScreen
          assignmentId={route.assignmentId}
          onBack={() => setRoute({ name: "my-work" })}
        />
      ) : route.name === "sync" ? (
        <SyncCenterScreen onBack={() => setRoute({ name: "my-work" })} />
      ) : (
        <SettingsScreen
          onBack={() => setRoute({ name: "my-work" })}
          onSignedOut={() => setRoute({ name: "my-work" })}
        />
      )}
      <View style={styles.tabs}>
        <Button
          label="Mi trabajo"
          onPress={() => setRoute({ name: "my-work" })}
          tone={route.name === "my-work" ? "primary" : "secondary"}
        />
        <Button
          label={pending > 0 ? `Sincronizar (${pending})` : "Sincronizar"}
          onPress={() => setRoute({ name: "sync" })}
          tone={route.name === "sync" ? "primary" : "secondary"}
        />
        <Button
          label="Ajustes"
          onPress={() => setRoute({ name: "settings" })}
          tone={route.name === "settings" ? "primary" : "secondary"}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.canvas },
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.canvas,
  },
  centreContent: {
    padding: theme.space.lg,
    gap: theme.space.md,
    flex: 1,
    justifyContent: "center",
  },
  tabs: {
    flexDirection: "row",
    gap: theme.space.sm,
    padding: theme.space.sm,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: theme.surface,
  },
});
