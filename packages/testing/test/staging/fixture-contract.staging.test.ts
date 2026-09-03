import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getStagingDatabase, rollbackProbe } from "../../src/staging-fixture";
import { DEMO_BASELINE, loadStagingFixture, type StagingFixtureIds } from "./fixture";

/**
 * The persistent demo fixture, and the contracts that are installed around it.
 *
 * Two kinds of check. Most are plain reads of the fixture a reviewer logs in to see — the
 * campaign, its assignments, its submitted responses, their provenance and their regime. The rest
 * are **rollback probes**: a single statement that the database is expected to refuse, run inside
 * a transaction that is undone either way (`rollbackProbe`). That is how the immutability and
 * typed-answer contracts get verified on the real provider without leaving a test questionnaire,
 * a test answer or a new published version behind.
 *
 * The exhaustive v1→v2 versioning regression stays in Testcontainers, where creating and
 * destroying questionnaires costs nothing. Here the question is narrower and different: is the
 * contract *installed and effective* on this environment.
 */
const db = getStagingDatabase();
let f: StagingFixtureIds;

beforeAll(async () => {
  f = await loadStagingFixture(db.migrator);
});
afterAll(() => db.close());

const scope = () => sql`tenant_id = ${f.tenantId} and project_id = ${f.projectId}`;

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const result = await db.migrator.execute(query);
  return (result.rows[0] as { n: number }).n;
}

describe("staging · the demo field baseline", () => {
  it("holds one campaign on one published survey version", async () => {
    expect(
      await count(sql`select count(*)::int as n from app.survey_campaign where ${scope()}`),
    ).toBe(DEMO_BASELINE.campaigns);
    expect(
      await count(sql`select count(*)::int as n from app.survey_version where ${scope()}`),
    ).toBe(DEMO_BASELINE.surveyVersions);

    const version = await db.migrator.execute(sql`
      select status, version_label from app.survey_version where id = ${f.surveyVersionId}
    `);
    expect(version.rows[0]).toMatchObject({ status: "PUBLISHED" });
  });

  it("has both synthetic technicians, as project members", async () => {
    const members = await db.migrator.execute(sql`
      select u.email, pm.role
      from app.project_membership pm
      join app.tenant_membership tm on tm.id = pm.tenant_membership_id
      join app."user" u on u.id = tm.user_id
      where pm.tenant_id = ${f.tenantId} and pm.project_id = ${f.projectId}
        and pm.role = 'FIELD_TECHNICIAN'
      order by u.email
    `);
    expect(members.rows.map((r) => (r as { email: string }).email)).toEqual([
      DEMO_BASELINE.technicianEmail,
      DEMO_BASELINE.secondTechnicianEmail,
    ]);
  });

  it("holds the documented number of assignments and submitted responses", async () => {
    expect(
      await count(sql`select count(*)::int as n from app.field_assignment where ${scope()}`),
    ).toBe(DEMO_BASELINE.assignments);
    expect(
      await count(sql`
        select count(*)::int as n from app.survey_instance
        where ${scope()} and status = 'SUBMITTED'
      `),
    ).toBe(DEMO_BASELINE.submittedResponses);
    expect(
      await count(sql`select count(*)::int as n from app.survey_answer where ${scope()}`),
    ).toBeGreaterThan(0);
  });

  it("every assignment belongs to a technician who is a member of this project", async () => {
    const orphans = await count(sql`
      select count(*)::int as n from app.field_assignment a
      where a.tenant_id = ${f.tenantId} and a.project_id = ${f.projectId}
        and not exists (
          select 1 from app.project_membership pm
          join app.tenant_membership tm on tm.id = pm.tenant_membership_id
          where pm.tenant_id = a.tenant_id and pm.project_id = a.project_id
            and pm.id = a.assignee_membership_id and tm.user_id = a.assignee_user_id)
    `);
    expect(orphans).toBe(0);
  });

  it("every response was captured by the technician the assignment belongs to", async () => {
    const mismatched = await count(sql`
      select count(*)::int as n from app.survey_instance i
      join app.field_assignment a on a.tenant_id = i.tenant_id and a.id = i.assignment_id
      where i.tenant_id = ${f.tenantId} and i.project_id = ${f.projectId}
        and i.respondent_user_id <> a.assignee_user_id
    `);
    expect(mismatched).toBe(0);
  });

  it("no field row points at a provenance record that is not there", async () => {
    for (const table of [
      "survey_version",
      "survey_campaign",
      "field_assignment",
      "field_visit",
      "survey_instance",
    ] as const) {
      const dangling = await count(sql`
        select count(*)::int as n from app.${sql.raw(table)} t
        where t.tenant_id = ${f.tenantId}
          and not exists (select 1 from app.provenance_record p
                          where p.tenant_id = t.tenant_id and p.id = t.provenance_id)
      `);
      expect(dangling, table).toBe(0);
    }
  });
});

describe("staging · demo simulation stays separate from the concluded study", () => {
  it("every captured response is labelled DEMO_SIMULATION", async () => {
    const notDemo = await count(sql`
      select count(*)::int as n from app.survey_instance i
      join app.provenance_record p on p.tenant_id = i.tenant_id and p.id = i.provenance_id
      where i.tenant_id = ${f.tenantId} and p.regime <> 'DEMO_SIMULATION'
    `);
    expect(notDemo).toBe(0);
  });

  it("the historical socioeconomic aggregate is still HISTORICAL_OBSERVED and separate", async () => {
    const historical = await db.migrator.execute(sql`
      select m.key, p.regime
      from app.metric_snapshot m
      join app.provenance_record p on p.tenant_id = m.tenant_id and p.id = m.provenance_id
      where m.tenant_id = ${f.tenantId} and m.key = 'surveys_complete'
    `);
    const row = historical.rows[0] as { regime: string } | undefined;
    expect(row?.regime).toBe("HISTORICAL_OBSERVED");
  });

  it("no demo answer was merged into the historical aggregate", async () => {
    // The two live in different tables and different regimes; the assertion that matters is that
    // the historical figure is not derived from the captured responses.
    const derived = await count(sql`
      select count(*)::int as n
      from app.provenance_input pi
      join app.provenance_record source on source.tenant_id = pi.tenant_id
                                       and source.id = pi.input_provenance_id
      join app.provenance_record target on target.tenant_id = pi.tenant_id
                                       and target.id = pi.provenance_id
      where pi.tenant_id = ${f.tenantId}
        and source.regime = 'DEMO_SIMULATION' and target.regime = 'HISTORICAL_OBSERVED'
    `);
    expect(derived).toBe(0);
  });
});

describe("staging · the questionnaire collects no personal data", () => {
  it("no question on the published version is marked as personal", async () => {
    const personal = await db.migrator.execute(sql`
      select code, sensitivity from app.survey_question
      where version_id = ${f.surveyVersionId} and sensitivity <> 'NON_PERSONAL'
    `);
    expect(personal.rows).toEqual([]);
  });

  it("no answer text looks like an identifier, a phone number or an email address", async () => {
    const suspicious = await count(sql`
      select count(*)::int as n from app.survey_answer
      where tenant_id = ${f.tenantId} and text_value is not null
        and (text_value ~ '[0-9]{9,}' or text_value ~ '@' or text_value ~* '(cedula|c[ée]dula|tel[ée]fono)')
    `);
    expect(suspicious).toBe(0);
  });
});

describe("staging · the installed contracts, probed and rolled back", () => {
  it("a published survey version refuses an edit", async () => {
    const probe = await rollbackProbe(db.migrator, (tx) =>
      tx.execute(sql`
        update app.survey_version set version_label = version_label || '-probe'
        where id = ${f.surveyVersionId}
      `),
    );
    expect(probe.error).toMatch(/survey_version_immutable/i);
  });

  it("a published version refuses a deletion", async () => {
    const probe = await rollbackProbe(db.migrator, (tx) =>
      tx.execute(sql`delete from app.survey_version where id = ${f.surveyVersionId}`),
    );
    expect(probe.error).toMatch(/survey_version_immutable/i);
  });

  it("a published version's questions refuse a change", async () => {
    const probe = await rollbackProbe(db.migrator, (tx) =>
      tx.execute(sql`
        update app.survey_question set prompt = prompt || ' (probe)'
        where version_id = ${f.surveyVersionId}
      `),
    );
    expect(probe.error).toMatch(/survey_definition_frozen/i);
  });

  it("a submitted response refuses a new answer", async () => {
    const probe = await rollbackProbe(db.migrator, (tx) =>
      tx.execute(sql`
        insert into app.survey_answer (id, tenant_id, project_id, instance_id, question_id, text_value)
        select gen_random_uuid(), ${f.tenantId}, ${f.projectId}, ${f.technicianInstanceId}, q.id, 'probe'
        from app.survey_question q where q.version_id = ${f.surveyVersionId} limit 1
      `),
    );
    expect(probe.error).toMatch(/survey_answer_frozen/i);
  });

  it("a submitted response refuses being moved to another survey version", async () => {
    const probe = await rollbackProbe(db.migrator, (tx) =>
      tx.execute(sql`
        update app.survey_instance set survey_version_id = ${f.surveyVersionId}, status = 'IN_PROGRESS'
        where id = ${f.technicianInstanceId}
      `),
    );
    expect(probe.error).toMatch(/survey_instance_submitted/i);
  });

  it("the fixture's own answers each fill exactly one typed column", async () => {
    const malformed = await count(sql`
      select count(*)::int as n from app.survey_answer
      where tenant_id = ${f.tenantId}
        and num_nonnulls(text_value, number_value, boolean_value, date_value, option_id) <> 1
    `);
    expect(malformed).toBe(0);
  });

  it("every chosen option belongs to the question it answers", async () => {
    const foreign = await count(sql`
      select count(*)::int as n from app.survey_answer a
      where a.tenant_id = ${f.tenantId} and a.option_id is not null
        and not exists (select 1 from app.survey_option o
                        where o.tenant_id = a.tenant_id and o.id = a.option_id
                          and o.question_id = a.question_id)
    `);
    expect(foreign).toBe(0);
  });

  it("leaves the baseline exactly as it found it", async () => {
    // The probes above each ran inside a transaction that was rolled back; this re-reads the
    // counts the suite opened with, so a probe that somehow committed would fail here rather than
    // in a reviewer's browser tomorrow.
    expect(
      await count(sql`select count(*)::int as n from app.field_assignment where ${scope()}`),
    ).toBe(DEMO_BASELINE.assignments);
    expect(
      await count(sql`
        select count(*)::int as n from app.survey_instance where ${scope()} and status = 'SUBMITTED'
      `),
    ).toBe(DEMO_BASELINE.submittedResponses);
    expect(
      await count(sql`select count(*)::int as n from app.survey_version where ${scope()}`),
    ).toBe(DEMO_BASELINE.surveyVersions);
    const version = await db.migrator.execute(sql`
      select version_label from app.survey_version where id = ${f.surveyVersionId}
    `);
    expect((version.rows[0] as { version_label: string }).version_label).not.toContain("probe");
  });
});
