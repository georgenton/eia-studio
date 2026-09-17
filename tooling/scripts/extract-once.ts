/**
 * One turn of the extraction worker's loop, as a process (ADR-034).
 *
 * This is what `ExtractionConsumer` does per claim, and it calls **the same two use-cases** with
 * no test-only path between them: `claimNextExtraction`, then `processDocumentExtraction`. The
 * consumer's loop, its backoff and its stale-release are covered by the integration suite; this
 * exists so the end-to-end spec can prove the thing only a real topology can show — that bytes a
 * browser sent through the web application are bytes a *separate process* can fetch and read.
 *
 * A process rather than an import, because the Playwright runner transpiles to CommonJS and
 * `@eia/db` is ESM. Running it the way the worker runs it is the honest arrangement anyway.
 *
 * Prints one line of JSON on stdout — the spec's only channel, so it is written there directly
 * rather than through a logger this repository forbids in source.
 *
 * Storage comes from the shared e2e configuration; the database from `DATABASE_URL`, as the
 * runtime role, exactly as the worker connects.
 */
import { readFileSync } from "node:fs";

import { claimNextExtraction, createS3Storage, processDocumentExtraction } from "@eia/application";
import { createDatabase, createPool } from "@eia/db";
import { config as loadDotenv } from "dotenv";

// The repository `.env`, as every other operator script here does: this runs from a Playwright
// process whose environment carries the suite's variables and not the database's.
loadDotenv({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });

function say(outcome: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
}

// Wrapped in a function rather than written at the top level: `tooling/` has no package manifest,
// so tsx compiles these scripts as CommonJS, where top-level `await` is not available.
async function main(): Promise<void> {
  const configPath = process.env.EIA_E2E_STORAGE_CONFIG ?? "/tmp/eia-e2e-storage.json";
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  };

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("extract-once: DATABASE_URL is not set");

  const pool = createPool(url, { max: 2, applicationName: "eia-e2e-extraction" });
  const db = createDatabase(pool);
  try {
    const storage = createS3Storage({
      bucket: config.bucket,
      region: config.region,
      endpoint: config.endpoint,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    });
    const claim = await claimNextExtraction(db);
    if (!claim) {
      say({ claimed: false });
    } else {
      const outcome = await processDocumentExtraction(db, claim, storage);
      say({
        claimed: true,
        state: outcome.state,
        chunks: outcome.chunkCount,
        pages: outcome.pageCount,
      });
    }
  } finally {
    await pool.end();
  }
}

void main();
