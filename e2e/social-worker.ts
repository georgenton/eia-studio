import { expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The worker, invoked by the end-to-end suite the way an operator would.
 *
 * The browser starts a classification run; a background process normally picks the work up. Rather
 * than run `apps/worker` beside the web server — a second lifecycle and a second source of
 * flakiness — the suite shells out to `pnpm social:drain`, which claims and processes the same
 * queue through the same use-cases. What is exercised is real: `claim_classification`, the RLS
 * context the worker builds as the initiating user, the output validation, the writes.
 *
 * It runs as a child process rather than an import because these specs are transpiled by
 * Playwright to CommonJS while the workspace packages are ESM; the boundary is a process, which is
 * also what it is in production.
 *
 * **No live model is ever called from a test.** `SOCIAL_CLASSIFIER=fake` is pinned here, and the
 * scenarios below make the fake deterministic — one confident multi-label proposal and one
 * low-confidence one, so the review screen's states are exercised without inventing a model
 * result on a real run (Slice 4 §39, §46).
 */
const SCENARIOS: Array<[string, Record<string, unknown>]> = [
  [
    "polvo",
    {
      categories: ["CONSTRUCTION_IMPACTS", "ACCESS_PROPERTY_FENCES"],
      confidence: 0.88,
      needsReview: false,
    },
  ],
  ["mercado", { categories: ["GENERAL_SUPPORT_BENEFITS"], confidence: 0.41, needsReview: true }],
];

/**
 * Ensure this environment has at least one proposal to look at.
 *
 * The accessibility and screenshot specs assert on states that only exist once a run has been
 * processed, and Playwright runs files alphabetically — so they cannot assume `social.spec.ts` went
 * first, and a freshly seeded CI database has no proposals at all. Each spec calls this and becomes
 * independent of the order and of whatever another spec happened to leave behind.
 */
export async function ensureProposals(page: Page): Promise<void> {
  await page.goto("/t/demo-consultancy/p/puente-del-amor/social?tab=abiertas");
  const main = page.getByRole("main");
  if ((await main.innerText()).includes("Propuesta de la IA")) return;

  const run = page.getByRole("button", { name: "Ejecutar codificación asistida" });
  if ((await run.count()) === 0) return; // this role cannot start one; nothing to prepare
  await run.click();
  await expect(main).toContainText(/Ejecución creada/);
  drainClassificationQueue();
  await page.reload();
}

export function drainClassificationQueue(): string {
  const dir = mkdtempSync(join(tmpdir(), "eia-e2e-social-"));
  const file = join(dir, "scenarios.json");
  writeFileSync(file, JSON.stringify(SCENARIOS), { mode: 0o600 });

  return execFileSync("pnpm", ["-s", "social:drain", "--fake-scenarios", file], {
    encoding: "utf8",
    env: { ...process.env, SOCIAL_CLASSIFIER: "fake" },
  });
}
