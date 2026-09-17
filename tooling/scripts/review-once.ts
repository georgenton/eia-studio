/**
 * One turn of the AI review worker's loop, as a process (ADR-035).
 *
 * The same arrangement `extract-once.ts` uses, and for the same reason (ADR-034): the end-to-end
 * spec proves what only a real topology can show — that a review a browser asked for is processed
 * by a **separate process**, against the same database, and comes back as candidates a specialist
 * reads. It calls the same two use-cases `ReviewConsumer` calls, with no test-only path between
 * them.
 *
 * The reviewer is the deterministic one, selected explicitly. `DOCUMENT_REVIEWER=fake` is only
 * permitted in `local` and `test` (IG4-001), and this script is only ever run by the suite.
 *
 * Prints one line of JSON on stdout — the spec's only channel.
 */
import {
  claimNextDocumentReview,
  FakeDocumentReviewer,
  processDocumentReview,
} from "@eia/application";
import { createDatabase, createPool } from "@eia/db";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });

function say(outcome: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
}

// Wrapped in a function rather than written at the top level: `tooling/` has no package manifest,
// so tsx compiles these scripts as CommonJS, where top-level `await` is not available.
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("review-once: DATABASE_URL is not set");

  const pool = createPool(url, { max: 2, applicationName: "eia-e2e-review" });
  const db = createDatabase(pool);
  try {
    const claim = await claimNextDocumentReview(db);
    if (!claim) {
      say({ claimed: false });
    } else {
      const outcome = await processDocumentReview(
        db,
        claim,
        new FakeDocumentReviewer(),
        "fake/deterministic",
      );
      say({
        claimed: true,
        status: outcome.status,
        passages: outcome.passageCount,
        candidates: outcome.candidatesCreated,
        refused: outcome.candidatesRefused,
        empty: outcome.emptyReason,
      });
    }
  } finally {
    await pool.end();
  }
}

void main();
