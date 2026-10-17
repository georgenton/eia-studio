import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  CLEARED_BEFORE_SWEEP_TABLES,
  PROVENANCE_BEARING_TABLES,
  SWEEP_PROTECTED_TABLES,
  orphanProvenanceSweep,
} from "../src/projects/provenance-sweep";

/**
 * The shape of the demo seeder's orphan-provenance sweep (TD-125), without a database.
 *
 * The companion `provenance-sweep-registry.integration.test.ts` asks the question that matters —
 * *is any provenance-bearing table missing?* — against `pg_catalog`. This one holds the two
 * properties that make that answer trustworthy: a table appears in exactly one of the two lists,
 * and the SQL the database executes is generated from the list the registry test checks.
 */
const sqlTextOf = (projectId: string): string =>
  new PgDialect().sqlToQuery(orphanProvenanceSweep(projectId)).sql;

describe("the demo seeder's provenance sweep", () => {
  it("names each table exactly once, in exactly one of the two lists", () => {
    const names = PROVENANCE_BEARING_TABLES.map((entry) => entry.table);
    expect(new Set(names).size, "a table is named twice").toBe(names.length);

    const cleared = CLEARED_BEFORE_SWEEP_TABLES.map((entry) => entry.table);
    expect(
      SWEEP_PROTECTED_TABLES.filter((entry) => cleared.includes(entry.table)).map((e) => e.table),
      "a table is both protected and cleared",
    ).toEqual([]);
  });

  it("gives every entry a reason", () => {
    for (const entry of PROVENANCE_BEARING_TABLES) {
      expect(entry.note.length, `${entry.table} has no note`).toBeGreaterThan(12);
    }
  });

  it("generates one subquery per protected table and nothing for the cleared ones", () => {
    const text = sqlTextOf("11111111-1111-1111-1111-111111111111");

    for (const { table } of SWEEP_PROTECTED_TABLES) {
      expect(text, `${table} is enumerated but absent from the generated sweep`).toContain(
        `from app."${table}" r`,
      );
    }
    for (const { table } of CLEARED_BEFORE_SWEEP_TABLES) {
      // Listing one would state a protection that does not exist — its rows are already gone — and
      // would be the wrong direction to be wrong in. The module's own comment says why.
      expect(text, `${table} is cleared before the sweep and needs no clause`).not.toContain(
        `from app."${table}" r`,
      );
    }
    expect(text.match(/not exists/g)).toHaveLength(SWEEP_PROTECTED_TABLES.length);
  });

  it("scopes the delete to one project, by parameter", () => {
    const text = sqlTextOf("22222222-2222-2222-2222-222222222222");
    expect(text).toContain("delete from app.provenance_record pr where pr.project_id = $1");
    // A sweep that interpolated the id would be a fixture script building SQL from a string; it is
    // a parameter here for the same reason every other query in this repository uses one.
    expect(text).not.toContain("22222222-2222-2222-2222-222222222222");
  });
});
