import type { ExpoConfig } from "expo/config";

/**
 * EIA Field's Expo configuration, which is now three applications rather than one.
 *
 * ## Why this file replaced `app.json`
 *
 * A static manifest can describe exactly one Android package, and the pilot needs three
 * installable builds — demo, staging and production — that can sit on the same handset without
 * one replacing another. Android identifies an application by its `package`, and an install of
 * the same package is an *update*: it inherits the previous app's data directory, which here means
 * its SQLCipher database, its session and any capture that has not been delivered. Two
 * environments sharing a package is therefore not a naming problem; it is a route by which
 * installing production would silently adopt staging's unsynchronised field work and point it at
 * a different server.
 *
 * ## Which environment keeps the original identity, and why it is staging
 *
 * `ec.eiastudio.field` is already installed and signed, and it is the build that has been used:
 * it keeps the identity so that it can go on being *updated* rather than reinstalled, which is
 * what protects whatever it is holding. Demo and production are new applications with their own
 * ids, their own data directories and their own signing keys.
 *
 * The cost is stated rather than hidden: production carries a `.prod` suffix for the life of the
 * installation. The alternative — giving production the clean id and renaming staging — costs a
 * reinstall of the one device that currently holds field work, and a reinstall is the operation
 * that discards it. An installed technician's pending capture outranks the tidiness of an
 * identifier (ADR-042).
 *
 * ## What else has to differ, and what must not
 *
 * - **`scheme`** is per environment, because a deep link is resolved by the operating system
 *   against whatever claims the scheme. Two apps claiming `eiafield://` makes which one receives a
 *   sign-in callback an arbitrary choice of the installer.
 * - **`name`** carries the environment, because a technician with two icons must be able to see
 *   which is which before opening either. The production build is named plainly; the other two say
 *   what they are.
 * - **`versionCode`** is per package and starts again for the new ones. The committed value is the
 *   authority: `EIA_FIELD_VERSION_CODE` overrides it for a **local** build and does *not* reach an
 *   EAS build, because the cloud receives only `eas.json`'s own `env` block — a code passed on the
 *   command line there is silently ignored. Found by building with it and reading the resulting
 *   manifest, which came back carrying the committed number.
 * - **The plugins, the permissions and the SQLCipher flag are identical** in all three. A build
 *   that differed there would not be the same application pointed at another server, which is the
 *   only difference these three are allowed to have.
 */

type FieldEnvironment = "local" | "demo" | "staging" | "production";

const FALLBACK_ENVIRONMENT: FieldEnvironment = "staging";

function readEnvironment(): FieldEnvironment {
  const value = process.env.EXPO_PUBLIC_APP_ENV;
  if (value === "local" || value === "demo" || value === "staging" || value === "production") {
    return value;
  }
  // An unrecognised value is not silently promoted to production: the safest build to produce by
  // accident is the one that talks to the test environment.
  return FALLBACK_ENVIRONMENT;
}

interface EnvironmentIdentity {
  /** Android `package` and iOS `bundleIdentifier`. Changing it makes a *different* application. */
  readonly applicationId: string;
  /** Launcher label. */
  readonly name: string;
  /** Deep-link scheme; one per installable application. */
  readonly scheme: string;
  /** Android version code, per package. */
  readonly versionCode: number;
}

const IDENTITIES: Record<FieldEnvironment, EnvironmentIdentity> = {
  // The development client, which is never distributed.
  local: {
    applicationId: "ec.eiastudio.field.dev",
    name: "EIA Field Dev",
    scheme: "eiafielddev",
    versionCode: 1,
  },
  demo: {
    applicationId: "ec.eiastudio.field.demo",
    name: "EIA Field Demo",
    scheme: "eiafielddemo",
    versionCode: 3,
  },
  // The installed application. Its identity does not change (see above).
  staging: {
    applicationId: "ec.eiastudio.field",
    name: "EIA Field Pruebas",
    scheme: "eiafield",
    versionCode: 11,
  },
  production: {
    applicationId: "ec.eiastudio.field.prod",
    name: "EIA Field",
    scheme: "eiafieldprod",
    versionCode: 3,
  },
};

const LOCATION_WHEN_IN_USE =
  "EIA Field registra la ubicación del técnico al iniciar una visita y al tomar una fotografía, " +
  "cuando el técnico lo autoriza. Nunca se infiere la ubicación de una vivienda.";

const CAMERA_USAGE =
  "EIA Field usa la cámara para registrar fotografías de la visita: el predio, la afectación y el " +
  "acceso. Las fotografías se guardan en el dispositivo y se envían al estudio; no se publican al " +
  "cliente ni se envían a ningún proveedor de modelos.";

/**
 * `newArchEnabled` is a real Expo option that the installed `ExpoConfig` type does not declare, so
 * the return type names it rather than casting the whole object and losing every other check.
 */
type FieldExpoConfig = ExpoConfig & { newArchEnabled?: boolean };

export default (): FieldExpoConfig => {
  const environment = readEnvironment();
  const identity = IDENTITIES[environment];
  const versionCode = Number(process.env.EIA_FIELD_VERSION_CODE ?? identity.versionCode);

  return {
    name: identity.name,
    slug: "eia-field",
    scheme: identity.scheme,
    version: "1.1.0",
    orientation: "portrait",
    userInterfaceStyle: "light",
    newArchEnabled: true,
    assetBundlePatterns: ["**/*"],
    ios: {
      bundleIdentifier: identity.applicationId,
      supportsTablet: false,
      infoPlist: {
        NSLocationWhenInUseUsageDescription: LOCATION_WHEN_IN_USE,
        NSCameraUsageDescription: CAMERA_USAGE,
        ITSAppUsesNonExemptEncryption: false,
      },
      buildNumber: String(versionCode),
    },
    android: {
      package: identity.applicationId,
      permissions: ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "CAMERA"],
      versionCode,
    },
    plugins: [
      ["expo-sqlite", { useSQLCipher: true }],
      ["expo-location", { locationWhenInUsePermission: LOCATION_WHEN_IN_USE }],
      [
        "expo-image-picker",
        {
          cameraPermission: CAMERA_USAGE,
          photosPermission: false,
          microphonePermission: false,
        },
      ],
      "expo-secure-store",
      "./plugins/with-default-locale-permission-copy",
    ],
    experiments: { typedRoutes: false },
    locales: { en: "./locales/en.json" },
    extra: {
      eas: { projectId: "08dc4e60-d223-43aa-a5f3-19b72442cfd0" },
      /**
       * Read by the diagnostics screen so a support photograph of it says which build it is.
       * Non-secret by construction: an environment name and an identifier already visible in the
       * installed package.
       */
      eiaEnvironment: environment,
      eiaApplicationId: identity.applicationId,
    },
    owner: "georgenton0316",
  };
};
