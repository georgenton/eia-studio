import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getStagingDatabase } from "../../src/staging-fixture";

/**
 * What Go-Live Wave A left on staging (ADR-037, ADR-038).
 *
 * Read-only, like every staging suite: no truncate, no seed, no repair (SECURITY.md §12a). It
 * asserts the half of a migration a local run cannot vouch for — that the grants, policies,
 * constraints and the **view's own options** are on the database an operator is actually looking
 * at, rather than on a throwaway container that agreed with them.
 */
const db = getStagingDatabase();
afterAll(() => db.close());

describe("the correction table, on the real database", () => {
  it("carries FORCE row level security and the composite project foreign key", async () => {
    const rls = await db.migrator.execute(sql`
      select c.relrowsecurity as enabled, c.relforcerowsecurity as forced
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname = 'survey_correction'
    `);
    const row = rls.rows[0] as { enabled: boolean; forced: boolean } | undefined;
    expect(row, "app.survey_correction exists").toBeDefined();
    expect(row!.enabled).toBe(true);
    expect(row!.forced).toBe(true);

    const fk = await db.migrator.execute(sql`
      select count(*)::int as n from pg_constraint
       where conrelid = 'app.survey_correction'::regclass and contype = 'f'
         and confrelid = 'app.project'::regclass
    `);
    expect((fk.rows[0] as { n: number }).n).toBeGreaterThan(0);
  });

  /*
   * The REVOKE is the load-bearing half (migration 0019's reasoning): 0002's default privileges
   * hand every new table in `app` full DML, so a narrower GRANT beside it changes nothing. A
   * correction is the record of what replaced what, and a study cannot lose it.
   */
  it("the runtime role holds no DELETE, and a trigger refuses one anyway", async () => {
    const grant = await db.migrator.execute(sql`
      select has_table_privilege('eia_app', 'app.survey_correction', 'DELETE') as allowed
    `);
    expect((grant.rows[0] as { allowed: boolean }).allowed).toBe(false);

    const trigger = await db.migrator.execute(sql`
      select count(*)::int as n from pg_trigger
       where tgrelid = 'app.survey_correction'::regclass
         and tgname = 'survey_correction_no_delete' and not tgisinternal
    `);
    expect((trigger.rows[0] as { n: number }).n).toBe(1);
  });

  it("a lineage is a line: the indexes and checks are here, not only in the migration", async () => {
    const indexes = await db.migrator.execute(sql`
      select indexname, indexdef from pg_indexes
       where schemaname = 'app' and tablename = 'survey_correction'
    `);
    const byName = new Map(
      (indexes.rows as Array<{ indexname: string; indexdef: string }>).map((row) => [
        row.indexname,
        row.indexdef,
      ]),
    );
    expect(byName.get("survey_correction_one_live_per_original")).toContain("UNIQUE");
    expect(byName.get("survey_correction_one_per_correcting")).toContain("UNIQUE");

    const checks = await db.migrator.execute(sql`
      select conname from pg_constraint
       where conrelid = 'app.survey_correction'::regclass and contype = 'c'
    `);
    const names = (checks.rows as Array<{ conname: string }>).map((row) => row.conname);
    for (const expected of [
      "survey_correction_not_self",
      "survey_correction_state_evidence",
      "survey_correction_reason_is_words",
    ]) {
      expect(names, expected).toContain(expected);
    }
  });

  /*
   * 0012's rule — one assignment per parcel per campaign — still holds for the assignments it was
   * written about. A correction is the case it did not know about, and it sits beside them.
   */
  it("still allows exactly one ordinary assignment per parcel per campaign", async () => {
    const result = await db.migrator.execute(sql`
      select indexdef from pg_indexes
       where schemaname = 'app' and indexname = 'field_assignment_campaign_parcel_key'
    `);
    const def = (result.rows[0] as { indexdef: string } | undefined)?.indexdef;
    expect(def, "the partial unique index exists").toBeDefined();
    expect(def).toContain("UNIQUE");
    expect(def).toContain("corrects_assignment_id IS NULL");
  });
});

describe("the one place the question is answered, on the real database", () => {
  /*
   * The assertion worth running here more than anywhere. Without `security_invoker`, a view runs
   * with its owner's privileges and hands back rows the caller's policies refuse — and every
   * analytic in this product reads this one. A local container agreeing is not the same as the
   * database an operator is looking at agreeing.
   */
  it("the effective view exists and runs as the caller", async () => {
    const result = await db.migrator.execute(sql`
      select c.reloptions::text as options
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname = 'effective_survey_instance' and c.relkind = 'v'
    `);
    expect(result.rows).toHaveLength(1);
    expect((result.rows[0] as { options: string }).options).toContain("security_invoker=true");
  });

  it("the runtime role may read it", async () => {
    const result = await db.migrator.execute(sql`
      select has_table_privilege('eia_app', 'app.effective_survey_instance', 'SELECT') as allowed
    `);
    expect((result.rows[0] as { allowed: boolean }).allowed).toBe(true);
  });

  it("returns at most one row per lineage, over whatever staging actually holds", async () => {
    const result = await db.migrator.execute(sql`
      select count(*)::int as n from (
        select tenant_id, root_instance_id
          from app.effective_survey_instance group by 1, 2 having count(*) > 1
      ) duplicated
    `);
    expect((result.rows[0] as { n: number }).n).toBe(0);
  });

  it("names no response that was never submitted", async () => {
    const result = await db.migrator.execute(sql`
      select count(*)::int as n
        from app.effective_survey_instance eff
        join app.survey_instance i
          on i.tenant_id = eff.tenant_id and i.id = eff.effective_instance_id
       where i.status <> 'SUBMITTED'
    `);
    expect((result.rows[0] as { n: number }).n).toBe(0);
  });
});

describe("the questionnaire authoring columns (ADR-037) are here too", () => {
  it("a heading is bounded on the question and on its translation", async () => {
    const result = await db.migrator.execute(sql`
      select conname from pg_constraint
       where conname in ('survey_question_section_is_words',
                         'survey_question_translation_section_is_words')
    `);
    expect((result.rows as Array<{ conname: string }>).map((row) => row.conname).sort()).toEqual([
      "survey_question_section_is_words",
      "survey_question_translation_section_is_words",
    ]);
  });

  /*
   * `published_by_user_id` joins the columns a published version may no longer change. Asserted by
   * reading the trigger's source on the real database, because the column being *present* says
   * nothing about whether the rule that freezes it was re-created here.
   */
  it("who published a version is frozen with the rest of it", async () => {
    const result = await db.migrator.execute(sql`
      select pg_get_functiondef('app.assert_survey_version_immutable()'::regprocedure) as body
    `);
    expect((result.rows[0] as { body: string }).body).toContain("published_by_user_id");
  });
});
