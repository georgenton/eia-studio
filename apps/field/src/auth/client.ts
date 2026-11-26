import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";

import { fieldConfig } from "../config";

/**
 * The same Better Auth instance the web app uses — one identity system, not two (ADR-010).
 *
 * The Expo plugin's job is storage: it keeps the session cookie in `expo-secure-store` (Keychain /
 * Android Keystore) instead of a browser cookie jar, and attaches it to every request this client
 * makes. Nothing about authorization moves onto the device: the server still resolves memberships,
 * roles and capabilities for every call, and a technician's `RequestContext` is built there.
 *
 * The configuration is resolved **once**, at module load, so this client and the diagnostics screen
 * cannot disagree about which build they are in — and so a misconfigured build fails here, loudly,
 * rather than making requests to a host nobody chose.
 */
const config = fieldConfig();

export const authClient = createAuthClient({
  baseURL: config.apiBaseUrl,
  plugins: [
    expoClient({
      /*
       * The scheme this build claims, not a constant.
       *
       * It was `"eiafield"` for all three builds, which was wrong the moment there were three:
       * Android resolves a deep link against whatever claims the scheme, so a sign-in callback
       * minted by the demo or production build would have been handed to the **staging**
       * application if that one happened to be installed — a callback for one environment
       * delivered into another's session store.
       */
      scheme: config.scheme,
      /*
       * Unchanged on purpose. The prefix is a key namespace inside this application's own
       * SecureStore, and the three builds are three Android packages with separate application
       * spaces; renaming it would gain nothing and would orphan the session of the installed
       * staging build.
       */
      storagePrefix: "eia-field",
      storage: SecureStore,
    }),
  ],
});

/**
 * The headers that carry the session to our own API routes.
 *
 * Better Auth's fetch client adds them to *its* requests; the Field Pack and sync routes are
 * ordinary `fetch` calls, so they ask the plugin for the same cookie rather than reimplementing
 * session handling.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const cookie = await authClient.getCookie();
  return cookie ? { Cookie: cookie } : {};
}
