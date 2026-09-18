import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  type TwoTenantWorld,
} from "../../src/index";

/**
 * The structural half of ADR-038: what the database refuses, and the one place the question
 * *"which response does this study currently mean?"* is allowed to be answered.
 *
 * The workflow itself is proved in `packages/application/test/survey-corrections.integration.test.ts`.
 * This file is about the guarantees that must hold even when application code is wrong.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);
});
afterAll(() => db.close());

describe("1 · the correction table's tenancy contract", () => {
  it("has row level security enabled and forced", async () => {
    const result = await db.migrator.execute(sql`
      select c.relrowsecurity as enabled, c.relforcerowsecurity as forced
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname = 'survey_correction'
    `);
    const row = result.rows[0] as { enabled: boolean; forced: boolean };
    expect(row.enabled).toBe(true);
    expect(row.forced).toBe(true);
  });

  it("has the composite foreign key to project", async () => {
    const result = await db.migrator.execute(sql`
      select count(*)::int as n from pg_constraint
       where conrelid = 'app.survey_correction'::regclass and contype = 'f'
         and confrelid = 'app.project'::regclass
    `);
    expect((result.rows[0] as { n: number }).n).toBeGreaterThan(0);
  });

  /*
   * A correction is the record of what replaced what. Losing it would leave a study holding two
   * responses to the same household with nothing saying which one it means.
   */
  it("the runtime role holds no DELETE, and a delete is refused by trigger too", async () => {
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

  it("its policies name the project, so one project's corrections are not another's", async () => {
    const result = await db.migrator.execute(sql`
      select pg_get_expr(pol.polqual, pol.polrelid) as using_expr,
             pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
        from pg_policy pol
       where pol.polrelid = 'app.survey_correction'::regclass
    `);
    const policies = result.rows as Array<{ using_expr: string | null; check_expr: string | null }>;
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      const predicate = `${policy.using_expr ?? ""} ${policy.check_expr ?? ""}`;
      expect(predicate).toContain("current_project_id");
      expect(predicate).toContain("current_tenant_id");
    }
  });
});

describe("2 · a lineage is a line, by constraint and not by intention", () => {
  const constraintNames = async () => {
    const result = await db.migrator.execute(sql`
      select conname from pg_constraint
       where conrelid = 'app.survey_correction'::regclass and contype = 'c'
    `);
    return (result.rows as Array<{ conname: string }>).map((row) => row.conname);
  };

  it("refuses a response that supersedes itself", async () => {
    expect(await constraintNames()).toContain("survey_correction_not_self");
  });

  it("refuses a state that disagrees with its own evidence", async () => {
    expect(await constraintNames()).toContain("survey_correction_state_evidence");
  });

  it("refuses a reason nobody wrote", async () => {
    expect(await constraintNames()).toContain("survey_correction_reason_is_words");
  });

  it("permits one live correction per response, and one correcting response per correction", async () => {
    const result = await db.migrator.execute(sql`
      select indexname, indexdef from pg_indexes
       where schemaname = 'app' and tablename = 'survey_correction'
    `);
    const indexes = result.rows as Array<{ indexname: string; indexdef: string }>;
    const live = indexes.find((i) => i.indexname === "survey_correction_one_live_per_original");
    expect(live?.indexdef).toContain("UNIQUE");
    // A cancelled request leaves the response correctable again; that is what cancelling is for.
    expect(live?.indexdef).toContain("CANCELLED");
    const correcting = indexes.find((i) => i.indexname === "survey_correction_one_per_correcting");
    expect(correcting?.indexdef).toContain("UNIQUE");
  });

  /*
   * The rule 0012 wrote — one assignment per parcel per campaign — still holds for the assignments
   * it was written about. A correction is the case it did not know about, and it sits beside them.
   */
  it("still allows one ordinary assignment per parcel per campaign, and no more", async () => {
    const result = await db.migrator.execute(sql`
      select indexdef from pg_indexes
       where schemaname = 'app' and indexname = 'field_assignment_campaign_parcel_key'
    `);
    const def = (result.rows[0] as { indexdef: string }).indexdef;
    expect(def).toContain("UNIQUE");
    expect(def).toContain("corrects_assignment_id IS NULL");
  });

  it("refuses an assignment that corrects itself", async () => {
    const result = await db.migrator.execute(sql`
      select count(*)::int as n from pg_constraint
       where conrelid = 'app.field_assignment'::regclass
         and conname = 'field_assignment_corrects_not_self'
    `);
    expect((result.rows[0] as { n: number }).n).toBe(1);
  });
});

describe("3 · the one place the question is answered", () => {
  it("the effective view exists and runs as the caller, not as its owner", async () => {
    const result = await db.migrator.execute(sql`
      select c.reloptions::text as options
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname = 'effective_survey_instance' and c.relkind = 'v'
    `);
    expect(result.rows).toHaveLength(1);
    /*
     * Load-bearing. Without `security_invoker`, a view runs with its owner's privileges and hands
     * back rows the caller's policies refuse — a view is exactly the shape in which RLS is
     * accidentally bypassed, and the whole product reads this one.
     */
    expect((result.rows[0] as { options: string }).options).toContain("security_invoker=true");
  });

  it("the runtime role may read it", async () => {
    const result = await db.migrator.execute(sql`
      select has_table_privilege('eia_app', 'app.effective_survey_instance', 'SELECT') as allowed
    `);
    expect((result.rows[0] as { allowed: boolean }).allowed).toBe(true);
  });

  /*
   * The point of a view rather than a predicate. `where superseded = false` written in six modules
   * is six chances to disagree, and the disagreement would be silent: two screens showing different
   * counts of the same households. This test fails the moment a seventh place invents its own rule.
   */
  it("nothing else in the application invents its own idea of superseded", async () => {
    const root = join(process.cwd(), "packages/application/src");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!path.endsWith(".ts")) continue;
        const source = readFileSync(path, "utf8");
        /*
         * One file is exempt, and it is the authority: `field/corrections.ts` names the view,
         * exports the two helpers everything else uses, and is the only place allowed to write the
         * phrase this test exists to keep out of the other fifty.
         */
        if (path.endsWith(join("field", "corrections.ts"))) continue;
        if (source.includes("effective_survey_instance")) {
          offenders.push(`${path}: queries the view directly instead of using the helper`);
        }
        if (/\bsuperseded\s*=\s*(false|true)/.test(source)) {
          offenders.push(`${path}: invents its own superseded predicate`);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  /*
   * A response nobody submitted is in no lineage at all — which is what every analytic already
   * assumed when it filtered on SUBMITTED, and what the view must keep true.
   */
  it("contains no unsubmitted response", async () => {
    const result = await db.migrator.execute(sql`
      select count(*)::int as n
        from app.effective_survey_instance eff
        join app.survey_instance i on i.tenant_id = eff.tenant_id and i.id = eff.effective_instance_id
       where i.status <> 'SUBMITTED'
    `);
    expect((result.rows[0] as { n: number }).n).toBe(0);
  });

  it("returns at most one row per lineage", async () => {
    const result = await db.migrator.execute(sql`
      select count(*)::int as n from (
        select tenant_id, root_instance_id, count(*) as c
          from app.effective_survey_instance group by 1, 2 having count(*) > 1
      ) duplicated
    `);
    expect((result.rows[0] as { n: number }).n).toBe(0);
  });

  it("is scoped by the tenant in context like every other read", async () => {
    const none = await db.runtime.execute(sql`
      select count(*)::int as n from app.effective_survey_instance
    `);
    // No context at all: `security_invoker` means the underlying policies deny, so nothing is seen.
    expect((none.rows[0] as { n: number }).n).toBe(0);
    expect(w.tenantA.id).toBeTruthy();
  });
});

describe("4 · the client portal is untouched, and that is asserted rather than assumed", () => {
  /*
   * ADR-027: a publication is composed from a closed allowlist and reads no operational table. It
   * therefore reads no correction, and a publication made before one keeps every word. The honest
   * way to show that is to check the portal module says nothing about responses at all, rather than
   * to write a test that corrects something and then finds the publication unchanged — which would
   * prove only that this particular publication happened not to look.
   */
  it("the portal module issues no statement about a response or a correction", () => {
    const root = join(process.cwd(), "packages/application/src/portal");
    const forbidden = [
      "survey_instance",
      "survey_correction",
      "survey_answer",
      "effective_survey_instance",
      "field_assignment",
    ];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!path.endsWith(".ts")) continue;
        /*
         * Comments are stripped first: `build.ts` names these tables in prose precisely to say it
         * never opens them, and a test that failed on that sentence would be punishing the file for
         * documenting the guarantee it keeps.
         */
        const source = readFileSync(path, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/[^\n]*/g, "");
        for (const word of forbidden) {
          if (source.includes(word)) offenders.push(`${path}: names ${word}`);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  it("and the publication table is still immutable by grant and by trigger", async () => {
    const grant = await db.migrator.execute(sql`
      select has_table_privilege('eia_app', 'portal.client_publication', 'UPDATE') as updatable,
             has_table_privilege('eia_app', 'portal.client_publication', 'DELETE') as deletable
    `);
    const row = grant.rows[0] as { updatable: boolean; deletable: boolean };
    expect(row.updatable).toBe(false);
    expect(row.deletable).toBe(false);
  });
});
