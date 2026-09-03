import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asContext, countVisible } from "../../src/attack-harness";
import { getStagingDatabase } from "../../src/staging-fixture";
import { FIELD_TABLES, loadStagingFixture, type StagingFixtureIds } from "./fixture";

/**
 * Isolation, on the real provider, through the runtime role, with the synthetic identities that
 * are actually provisioned there — and without changing a single row.
 *
 * Every case below is a SELECT under an explicit transaction context. No truncation, no seeding,
 * no fixture repair: the demo campaign that a reviewer logs in to see is the same before and after
 * this file runs, which is the condition IG3-001 asks for.
 *
 * The cases are the ones that matter for Slice 3: a request with no context sees nothing; a forged
 * tenant, project or user id widens nothing; one technician cannot reach another's work; a
 * technician can reach their own; and a caller holding `field.responses.read` can read the
 * project's responses.
 */
const db = getStagingDatabase();
let f: StagingFixtureIds;

beforeAll(async () => {
  f = await loadStagingFixture(db.migrator);
});
afterAll(() => db.close());

const technician = () => ({
  userId: f.technicianUserId,
  tenantId: f.tenantId,
  projectId: f.projectId,
  fieldResponsesAccess: false,
});
const coordinator = () => ({
  userId: f.coordinatorUserId,
  tenantId: f.tenantId,
  projectId: f.projectId,
  fieldResponsesAccess: true,
});

describe("staging · a request without context reads nothing", () => {
  it("every field table is empty with no tenant, project or user set", async () => {
    for (const table of FIELD_TABLES) {
      expect(
        await countVisible(
          db.runtime,
          { userId: null, tenantId: null, projectId: null },
          `app.${table}`,
        ),
        table,
      ).toBe(0);
    }
  });

  it("a tenant without a user is not enough", async () => {
    for (const table of ["field_assignment", "survey_instance", "survey_answer"] as const) {
      expect(
        await countVisible(
          db.runtime,
          { userId: null, tenantId: f.tenantId, projectId: f.projectId },
          `app.${table}`,
        ),
        table,
      ).toBe(0);
    }
  });
});

describe("staging · forged identifiers widen nothing", () => {
  const FORGED = "00000000-0000-4000-8000-0000000000ff";

  it("a forged tenant id sees no row", async () => {
    expect(
      await countVisible(
        db.runtime,
        { ...coordinator(), tenantId: FORGED, projectId: f.projectId },
        "app.field_assignment",
      ),
    ).toBe(0);
  });

  it("a forged project id inside the real tenant sees no row", async () => {
    expect(
      await countVisible(
        db.runtime,
        { ...coordinator(), projectId: FORGED },
        "app.field_assignment",
      ),
    ).toBe(0);
    expect(
      await countVisible(db.runtime, { ...coordinator(), projectId: FORGED }, "app.survey_answer"),
    ).toBe(0);
  });

  it("a user id with no membership sees no row, whatever it claims about permissions", async () => {
    const outsider = {
      userId: FORGED,
      tenantId: f.tenantId,
      projectId: f.projectId,
      fieldResponsesAccess: true,
    };
    for (const table of FIELD_TABLES) {
      expect(await countVisible(db.runtime, outsider, `app.${table}`), table).toBe(0);
    }
  });
});

describe("staging · technician ownership", () => {
  it("a technician sees their own assignment", async () => {
    const rows = await asContext(db.runtime, technician(), (tx) =>
      tx.execute(sql`select id from app.field_assignment where id = ${f.technicianAssignmentId}`),
    );
    expect(rows.rows).toHaveLength(1);
  });

  it("a technician cannot see the other technician's assignment", async () => {
    const rows = await asContext(db.runtime, technician(), (tx) =>
      tx.execute(
        sql`select id from app.field_assignment where id = ${f.secondTechnicianAssignmentId}`,
      ),
    );
    expect(rows.rows).toHaveLength(0);
  });

  it("a technician's assignment list contains only their own work", async () => {
    const rows = await asContext(db.runtime, technician(), (tx) =>
      tx.execute(sql`select distinct assignee_user_id from app.field_assignment`),
    );
    expect(rows.rows.map((r) => (r as { assignee_user_id: string }).assignee_user_id)).toEqual([
      f.technicianUserId,
    ]);
  });

  it("a technician cannot read another technician's visits, responses or answers", async () => {
    const foreign = await asContext(db.runtime, technician(), (tx) =>
      tx.execute(sql`
        select count(*)::int as n from app.survey_instance
        where respondent_user_id = ${f.secondTechnicianUserId}
      `),
    );
    expect((foreign.rows[0] as { n: number }).n).toBe(0);

    const visits = await asContext(db.runtime, technician(), (tx) =>
      tx.execute(sql`
        select count(*)::int as n from app.field_visit
        where technician_user_id <> ${f.technicianUserId}
      `),
    );
    expect((visits.rows[0] as { n: number }).n).toBe(0);
  });

  it("a technician can read their own submitted response and its answers", async () => {
    const instance = await asContext(db.runtime, technician(), (tx) =>
      tx.execute(sql`select status from app.survey_instance where id = ${f.technicianInstanceId}`),
    );
    expect((instance.rows[0] as { status: string }).status).toBe("SUBMITTED");

    const answers = await asContext(db.runtime, technician(), (tx) =>
      tx.execute(sql`
        select count(*)::int as n from app.survey_answer where instance_id = ${f.technicianInstanceId}
      `),
    );
    expect((answers.rows[0] as { n: number }).n).toBeGreaterThan(0);
  });

  it("the questionnaire itself stays readable to the technician who must fill it in", async () => {
    const questions = await asContext(db.runtime, technician(), (tx) =>
      tx.execute(sql`
        select count(*)::int as n from app.survey_question where version_id = ${f.surveyVersionId}
      `),
    );
    expect((questions.rows[0] as { n: number }).n).toBeGreaterThan(0);
  });
});

describe("staging · field.responses.read is what separates the two", () => {
  it("a caller holding it reads the project's responses", async () => {
    expect(await countVisible(db.runtime, coordinator(), "app.survey_instance")).toBeGreaterThan(0);
    expect(await countVisible(db.runtime, coordinator(), "app.survey_answer")).toBeGreaterThan(0);
    const assignees = await asContext(db.runtime, coordinator(), (tx) =>
      tx.execute(sql`select count(distinct assignee_user_id)::int as n from app.field_assignment`),
    );
    expect((assignees.rows[0] as { n: number }).n).toBe(2);
  });

  it("the same caller without it reads none of them", async () => {
    const withoutPermission = { ...coordinator(), fieldResponsesAccess: false };
    expect(await countVisible(db.runtime, withoutPermission, "app.survey_instance")).toBe(0);
    expect(await countVisible(db.runtime, withoutPermission, "app.survey_answer")).toBe(0);
    expect(await countVisible(db.runtime, withoutPermission, "app.field_visit")).toBe(0);
    // …while the operational workflow stays visible: a campaign is not an individual's data.
    expect(await countVisible(db.runtime, withoutPermission, "app.survey_campaign")).toBe(1);
  });
});

describe("staging · cross-project access", () => {
  it("a project id the caller is not a member of yields nothing", async () => {
    const otherProjects = await db.migrator.execute(sql`
      select id from app.project where tenant_id = ${f.tenantId} and id <> ${f.projectId} limit 1
    `);
    const other = otherProjects.rows[0] as { id: string } | undefined;
    if (!other) {
      // Staging holds one demo project; the forged-project case above covers the same predicate.
      expect(otherProjects.rows).toHaveLength(0);
      return;
    }
    expect(
      await countVisible(
        db.runtime,
        { ...technician(), projectId: other.id },
        "app.field_assignment",
      ),
    ).toBe(0);
  });
});
