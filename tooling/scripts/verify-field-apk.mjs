#!/usr/bin/env node
/**
 * What a published EIA Field APK must be, checked against the file a participant downloads.
 *
 * ## Why this is a script and not a paragraph in a document
 *
 * Three claims were made about these artefacts: that each build talks only to its own
 * environment, that updating staging preserves the technician's encrypted database, and that the
 * APK carries no credential. Each was true on the day it was checked by hand, and each had
 * already been false once before anybody looked:
 *
 *   * two different staging builds shipped with `versionCode` 9, because `EIA_FIELD_VERSION_CODE`
 *     does not reach an EAS cloud build — only `eas.json`'s own `env` block travels;
 *   * all three builds declared the deep-link scheme `eiafield`, so a sign-in callback minted by
 *     the demo build would have been delivered to the staging application.
 *
 * Both were found by reading the artefact rather than the branch. So the reading is a command.
 *
 * ## What it checks, and what it cannot
 *
 * It reads the **file**: the package name, the version code, the declared URL schemes, the
 * environment and application id the manifest carries, the signing certificate, and the Hermes
 * bundle's string table. It does not install anything and it does not prove the application runs
 * — that is the handset drill, and this script's output is what makes that drill's subject
 * identifiable afterwards.
 *
 * The secret scan is a **tripwire, not a scanner**. It looks for the specific mistake of a
 * credential compiled into a client, and it distinguishes a *name* in a library's error message
 * from a *value*: `BETTER_AUTH_SECRET` appears in every bundle because Better Auth's own
 * validation message names it, and reporting that as a leaked secret would train a reader to
 * ignore the check.
 *
 * Usage:
 *   node tooling/scripts/verify-field-apk.mjs <file.apk> [--expect-environment staging]
 *                                                        [--expect-version-code 10]
 *                                                        [--expect-certificate <sha256>]
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

const BUILD_TOOLS = `${process.env["HOME"]}/Library/Android/sdk/build-tools`;

/** The environments a published artefact may declare, and the identity each must carry. */
const EXPECTED = {
  staging: {
    applicationId: "ec.eiastudio.field",
    scheme: "eiafield",
    origin: "https://eia-staging.syntavera.dev",
  },
  demo: {
    applicationId: "ec.eiastudio.field.demo",
    scheme: "eiafielddemo",
    origin: "https://eia-demo.syntavera.dev",
  },
  production: {
    applicationId: "ec.eiastudio.field.prod",
    scheme: "eiafieldprod",
    origin: "https://eia.syntavera.dev",
  },
};

/*
 * Patterns that would mean a credential is in the artefact. Each is paired with the shape a
 * *value* takes, because the bare name is ordinary: a library that validates `BETTER_AUTH_SECRET`
 * says so in its error message, and a check that cannot tell the two apart gets switched off.
 */
const SECRET_PATTERNS = [
  { label: "a PostgreSQL connection string", re: /postgres(?:ql)?:\/\/[^\s"']*:[^\s"'@]+@/ },
  {
    label: "a database role password",
    re: /eia_(?:app|migrator|policy)[^\s"']{0,4}:[^\s"'@]{8,}@/,
  },
  { label: "a GitHub token", re: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { label: "an AWS access key id", re: /AKIA[0-9A-Z]{16}/ },
  { label: "a private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    label: "an assigned secret or token value",
    re: /(?:secret|api[_-]?key|service[_-]?token|bypass[_-]?token)["']?\s*[:=]\s*["'][A-Za-z0-9_\-/+]{20,}["']/i,
  },
  {
    label: "a Vercel protection bypass token",
    re: /VERCEL_AUTOMATION_BYPASS_SECRET["']?\s*[:=]\s*["'][A-Za-z0-9]{16,}/,
  },
];

function tool(name) {
  if (!existsSync(BUILD_TOOLS)) return null;
  const versions = execFileSync("ls", [BUILD_TOOLS], { encoding: "utf8" })
    .trim()
    .split("\n")
    .sort();
  for (const v of versions.reverse()) {
    const candidate = join(BUILD_TOOLS, v, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function javaHome() {
  for (const home of [
    process.env["JAVA_HOME"],
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
  ]) {
    if (home && existsSync(join(home, "bin", "java"))) return home;
  }
  return null;
}

const results = [];
function record(ok, what, detail) {
  results.push({ ok, what, detail });
  const mark = ok === null ? "  ?" : ok ? "  ✓" : "  ✗";
  console.log(`${mark} ${what}${detail ? ` — ${detail}` : ""}`);
}

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error(
    "usage: verify-field-apk.mjs <file.apk> [--expect-environment <env>] [--expect-version-code <n>] [--expect-certificate <sha256>]",
  );
  process.exit(2);
}
const flags = {};
for (let i = 0; i < rest.length; i += 2) flags[rest[i]] = rest[i + 1];

if (!existsSync(file)) {
  console.error(`no such file: ${file}`);
  process.exit(2);
}

console.log(`\n${basename(file)}`);
const bytes = readFileSync(file);
const sha256 = createHash("sha256").update(bytes).digest("hex");
record(true, "SHA-256", sha256);
record(true, "size", `${bytes.length} bytes`);

const aapt = tool("aapt2");
if (!aapt) {
  record(null, "package identity", "aapt2 not found; install Android build-tools to check it");
} else {
  const badging = execFileSync(aapt, ["dump", "badging", file], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const pkg = /package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/.exec(badging);
  const label = /application-label:'([^']*)'/.exec(badging);
  record(
    pkg !== null,
    "package",
    pkg ? `${pkg[1]} · versionCode ${pkg[2]} · versionName ${pkg[3]}` : "unreadable",
  );
  if (label) record(true, "label", label[1]);

  const tree = execFileSync(aapt, ["dump", "xmltree", file, "--file", "AndroidManifest.xml"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const schemes = [
    ...new Set([...tree.matchAll(/android:scheme[^\n]*="([^"]+)"/g)].map((m) => m[1])),
  ].filter((s) => s.startsWith("eiafield"));
  record(
    schemes.length === 1,
    "declares exactly one eiafield scheme",
    schemes.join(", ") || "none",
  );

  const env = flags["--expect-environment"];
  if (env) {
    const want = EXPECTED[env];
    if (!want) {
      record(false, "expected environment is one this product publishes", env);
    } else {
      record(
        pkg?.[1] === want.applicationId,
        `package is ${env}'s`,
        `expected ${want.applicationId}`,
      );
      record(schemes[0] === want.scheme, `scheme is ${env}'s`, `expected ${want.scheme}`);
      /*
       * Three distinct packages is what actually keeps the environments apart on a handset: two
       * builds with the same application id are one installation, and the second replaces the
       * first along with its database.
       */
      for (const [other, spec] of Object.entries(EXPECTED)) {
        if (other === env) continue;
        record(
          pkg?.[1] !== spec.applicationId && schemes[0] !== spec.scheme,
          `is not the ${other} build`,
        );
      }
    }
  }
  const wantCode = flags["--expect-version-code"];
  if (wantCode)
    record(pkg?.[2] === wantCode, "version code", `expected ${wantCode}, found ${pkg?.[2]}`);
}

// The environment the manifest carries. `readBuildInputs()` cross-checks this against the origin
// compiled into the bundle and refuses to start when they disagree, so both must be right.
const work = mkdtempSync(join(tmpdir(), "eia-apk-"));
try {
  execFileSync("unzip", [
    "-oq",
    file,
    "assets/app.config",
    "assets/index.android.bundle",
    "-d",
    work,
  ]);
  const config = JSON.parse(readFileSync(join(work, "assets/app.config"), "utf8"));
  const extra = config.extra ?? {};
  record(
    typeof extra.eiaEnvironment === "string" && typeof extra.eiaApplicationId === "string",
    "manifest declares its environment",
    `${extra.eiaEnvironment} · ${extra.eiaApplicationId}`,
  );
  const env = flags["--expect-environment"];
  if (env) {
    record(extra.eiaEnvironment === env, `manifest environment is ${env}`);
    record(
      extra.eiaApplicationId === EXPECTED[env]?.applicationId,
      `manifest application id is ${env}'s`,
    );
  }

  const bundle = readFileSync(join(work, "assets/index.android.bundle"), "utf8");
  if (env && EXPECTED[env]) {
    /*
     * The origin must be *in* the bundle. It is not enough on its own — every build carries the
     * whole `ENVIRONMENT_ORIGINS` table, so finding a host proves nothing about which one is
     * selected; that is what the manifest and the startup cross-check are for.
     */
    record(
      bundle.includes(EXPECTED[env].origin),
      `bundle contains ${env}'s origin`,
      EXPECTED[env].origin,
    );
  }
  const leaks = SECRET_PATTERNS.filter((p) => p.re.test(bundle)).map((p) => p.label);
  record(
    leaks.length === 0,
    "bundle carries no credential",
    leaks.length ? leaks.join("; ") : "no connection string, token, key or assigned secret value",
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

const apksigner = tool("apksigner");
const home = javaHome();
if (!apksigner || !home) {
  record(
    null,
    "signing certificate",
    "apksigner or a JDK not found; install Android build-tools and a JDK to check it",
  );
} else {
  const out = execFileSync(apksigner, ["verify", "--print-certs", file], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, JAVA_HOME: home, PATH: `${join(home, "bin")}:${process.env["PATH"]}` },
  });
  const digest = /certificate SHA-256 digest: ([0-9a-f]{64})/.exec(out);
  record(digest !== null, "signing certificate SHA-256", digest?.[1] ?? "unreadable");
  const want = flags["--expect-certificate"];
  if (want) {
    /*
     * The certificate is what decides whether installing this file over the one on a phone is an
     * *update* — keeping the SQLCipher database and the session — or a refusal. A staging build
     * signed by a new key would ask the technician to uninstall first, and uninstalling discards
     * work that has not synchronised.
     */
    record(
      digest?.[1] === want,
      "signed by the expected key",
      `an update over an installed build keeps its data only if this matches`,
    );
  }
}

const failed = results.filter((r) => r.ok === false);
const unknown = results.filter((r) => r.ok === null);
console.log(
  `\n${failed.length === 0 ? "OK" : "FAILED"} · ${results.filter((r) => r.ok === true).length} checked` +
    `${failed.length ? `, ${failed.length} failed` : ""}${unknown.length ? `, ${unknown.length} not checked` : ""}`,
);
process.exit(failed.length === 0 ? 0 : 1);
