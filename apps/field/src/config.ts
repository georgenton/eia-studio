import Constants from "expo-constants";

/**
 * Where this build talks to, and the one rule about it: **there is no secret here.**
 *
 * A mobile bundle is readable by whoever holds the device, so everything in it is public by
 * construction. The API base URL is public information; a signing key or a service token would
 * not be, which is why neither exists in this application and why authentication is a session the
 * technician creates by signing in.
 *
 * Staging and production are separated by build-time configuration (`EXPO_PUBLIC_API_URL`), not by
 * a runtime switch a technician could flip: a field application that can be pointed at another
 * environment from its own settings screen is one tap away from writing demo answers into a real
 * study.
 */
const FALLBACK = "http://localhost:3000";

export interface FieldConfig {
  readonly apiBaseUrl: string;
  readonly appVersion: string;
  readonly environmentLabel: string;
}

export function fieldConfig(): FieldConfig {
  const url = process.env["EXPO_PUBLIC_API_URL"]?.trim();
  const apiBaseUrl = (url && url.length > 0 ? url : FALLBACK).replace(/\/+$/, "");
  return {
    apiBaseUrl,
    appVersion: Constants.expoConfig?.version ?? "0.0.0",
    environmentLabel: apiBaseUrl.includes("localhost")
      ? "Desarrollo local"
      : apiBaseUrl.includes("vercel.app")
        ? "Entorno de pruebas"
        : "Producción",
  };
}
