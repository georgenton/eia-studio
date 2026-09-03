import { appEnvSchema, loadEnv, runtimeDatabaseEnvSchema, socialEnvSchema } from "@eia/contracts";
import { resolveClassifierAvailability } from "@eia/domain";
import { config as loadDotenv } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createDatabase, createPool } from "@eia/db";

import { createClassifier, FakeClassifier, type FakeScenario } from "../src/social/classifier";
import { claimNextClassification, processClassification } from "../src/social/worker";

/**
 * Process the classification queue once and stop.
 *
 * The persistent worker (`apps/worker`) polls this same queue continuously; this is the operator
 * and test-suite equivalent — "drain what is pending, tell me what happened, exit". It runs the
 * identical use-cases, so what it exercises is the real claim, the real RLS context and the real
 * validation, not a simulation of them.
 *
 * The classifier is whatever `SOCIAL_CLASSIFIER` says, resolved through the same availability rule
 * the worker and the web app use (IG4-001): unset, or the fake in a persistent environment, and
 * this script refuses rather than draining the queue with something it should not.
 *
 * `--fake-scenarios <file>` supplies deterministic answers keyed by a substring of the response
 * text. It exists so an end-to-end suite can drive a specific state — a low-confidence proposal,
 * a provider failure — without a live model, and it is refused unless the configured classifier is
 * already the fake: it can make the fake predictable, never make a real run fake.
 */
loadDotenv({ path: resolve(process.cwd(), "../../.env"), quiet: true });
loadDotenv({ path: resolve(process.cwd(), ".env"), quiet: true });

const app = loadEnv("app", appEnvSchema);
const social = loadEnv("social", socialEnvSchema);
const database = loadEnv("database", runtimeDatabaseEnvSchema);

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const availability = resolveClassifierAvailability({
  appEnv: app.APP_ENV,
  classifier: social.SOCIAL_CLASSIFIER,
  model: social.SOCIAL_CLASSIFIER_MODEL,
  gatewayApiKeyPresent: social.AI_GATEWAY_API_KEY !== undefined,
});
if (availability.state !== "AVAILABLE") {
  console.error(`drain-classifications: ${availability.reason} — ${availability.detail}`);
  process.exit(1);
}

const scenarioFile = arg("fake-scenarios");
if (scenarioFile && availability.kind !== "fake") {
  console.error(
    "drain-classifications: --fake-scenarios requires SOCIAL_CLASSIFIER=fake. A configured " +
      "provider is never replaced by scripted answers.",
  );
  process.exit(1);
}

const scenarios: ReadonlyArray<[string, FakeScenario]> = scenarioFile
  ? (JSON.parse(readFileSync(resolve(scenarioFile), "utf8")) as Array<[string, FakeScenario]>)
  : [];

const classifier =
  availability.kind === "fake" ? new FakeClassifier(scenarios) : createClassifier(availability);

const pool = createPool(database.DATABASE_URL, { max: 2, applicationName: "eia-drain" });
const db = createDatabase(pool);
const limit = Number(arg("max") ?? 25);

try {
  let handled = 0;
  const outcomes: Record<string, number> = {};
  while (handled < limit) {
    const claim = await claimNextClassification(db);
    if (!claim) break;
    const outcome = await processClassification(db, claim, classifier);
    outcomes[outcome.status] = (outcomes[outcome.status] ?? 0) + 1;
    // Identifiers and status only: an answer's words never reach a log line.
    if (outcome.reason) {
      console.log(
        `${outcome.classificationId}: ${outcome.status} — ${outcome.reason.slice(0, 160)}`,
      );
    }
    handled += 1;
  }
  console.log(
    `drain-classifications: ${handled} processed with the ${classifier.kind} classifier` +
      (Object.keys(outcomes).length > 0
        ? ` (${Object.entries(outcomes)
            .map(([status, count]) => `${status} ${count}`)
            .join(", ")})`
        : ""),
  );
} finally {
  await pool.end();
}
