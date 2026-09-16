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
 */
export const authClient = createAuthClient({
  baseURL: fieldConfig().apiBaseUrl,
  plugins: [
    expoClient({
      scheme: "eiafield",
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
