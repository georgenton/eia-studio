import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asContext,
  attempt,
  countVisible,
  createCampaign,
  createParcelWithGeometry,
  createProjectMembership,
  createProvenanceRecord,
  createPublishedSurvey,
  createSpatialDatasetVersion,
  createTenantMembership,
  createUser,
  getTestDatabase,
  resetDatabase,
  seedTwoTenantWorld,
  type TwoTenantWorld,
} from "../../src/index";

/**
 * Socializations at the row level (block 3, ADR-041).
 *
 * The question this file answers is the one SECURITY.md §10b asks of every field table: *is
 * being on the project enough?* For an **event** — a title, a time and a place — it is: a
 * technician must be able to read the convocation their invitation belongs to. For an
 * **invitation** and an **attempt** it is not, because one names a household's gate and may
 * carry a label somebody wrote, and the other is what a named person reported at it.
 *
 * And one thing the public surface must never reach. `app.surface = 'public'` is the
 * session-less read path the editorial portal opened; nothing in this module is served through
 * it, and a policy that admitted it would make a delivery photograph a public object.
 */
const db = getTestDatabase();
let w: TwoTenantWorld;
let techA: { id: string; membershipId: string };
let techB: { id: string; membershipId: string };
let coordinator: { id: string; membershipId: string };
let eventId: string;
let invitationA: string;
let invitationB: string;
let prov: string;
let parcelA: string;
let parcelB: string;

const ctxFor = (userId: string, over: Partial<Record<string, unknown>> = {}) => ({
  userId,
  tenantId: w.tenantA.id,
  projectId: w.projectX.id,
  ...over,
});

/** The door of SECURITY.md §10b, which COORDINATOR holds and FIELD_TECHNICIAN does not. */
const reader = (userId: string) => ({ ...ctxFor(userId), fieldResponsesAccess: true });

async function insertInvitation(parcelId: string, assignee: { id: string; membershipId: string }) {
  const id = randomUUID();
  await db.migrator.execute(sql`
    insert into app.socialization_invitation
      (id, tenant_id, project_id, event_id, parcel_id, assignee_membership_id, assignee_user_id,
       status, provenance_id)
    values (${id}, ${w.tenantA.id}, ${w.projectX.id}, ${eventId}, ${parcelId},
            ${assignee.membershipId}, ${assignee.id}, 'PENDING', ${prov})
  `);
  return id;
}

beforeAll(async () => {
  await resetDatabase(db.migrator);
  w = await seedTwoTenantWorld(db.migrator);

  const make = async (label: string, role: string) => {
    const user = await createUser(db.migrator, label);
    const tenantMembership = await createTenantMembership(db.migrator, {
      tenantId: w.tenantA.id,
      userId: user.id,
      role: "MEMBER",
    });
    const membership = await createProjectMembership(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      tenantMembershipId: tenantMembership.id,
      role: role as never,
    });
    return { id: user.id, membershipId: membership.id };
  };
  techA = await make("rls-soc-tech-a", "FIELD_TECHNICIAN");
  techB = await make("rls-soc-tech-b", "FIELD_TECHNICIAN");
  coordinator = await make("rls-soc-coordinator", "COORDINATOR");

  prov = (
    await createProvenanceRecord(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      regime: "DEMO_SIMULATION",
    })
  ).id;
  const survey = await createPublishedSurvey(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    openTextCode: "concern_text",
    numericCode: "household_size",
  });
  await createCampaign(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
    surveyVersionId: survey.versionId,
    captureChannel: "EIA_FIELD_MOBILE",
  });
  const dataset = await createSpatialDatasetVersion(db.migrator, {
    tenantId: w.tenantA.id,
    projectId: w.projectX.id,
    provenanceId: prov,
  });
  parcelA = (
    await createParcelWithGeometry(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      datasetVersionId: dataset.id,
      provenanceId: prov,
      parcelCode: "001",
    })
  ).parcelId;
  parcelB = (
    await createParcelWithGeometry(db.migrator, {
      tenantId: w.tenantA.id,
      projectId: w.projectX.id,
      datasetVersionId: dataset.id,
      provenanceId: prov,
      parcelCode: "002",
    })
  ).parcelId;

  eventId = randomUUID();
  await db.migrator.execute(sql`
    insert into app.socialization_event
      (id, tenant_id, project_id, title, starts_at, timezone, location_label, status,
       created_by_user_id, provenance_id)
    values (${eventId}, ${w.tenantA.id}, ${w.projectX.id}, 'Convocatoria sintética',
            now() + interval '30 days', 'America/Guayaquil', 'Casa comunal', 'SCHEDULED',
            ${coordinator.id}, ${prov})
  `);
  invitationA = await insertInvitation(parcelA, techA);
  invitationB = await insertInvitation(parcelB, techB);
}, 300_000);

afterAll(() => db.close());

describe("the event is project reference data", () => {
  it("a technician reads the convocation their invitation belongs to", async () => {
    expect(await countVisible(db.runtime, ctxFor(techA.id), "app.socialization_event")).toBe(1);
  });

  it("and another tenant's owner reads none of it", async () => {
    const count = await countVisible(
      db.runtime,
      { userId: w.ownerB.id, tenantId: w.tenantB.id, projectId: w.projectZ.id },
      "app.socialization_event",
    );
    expect(count).toBe(0);
  });
});

describe("an invitation is not", () => {
  it("a technician sees their own and not the other's", async () => {
    const visible = await asContext(db.runtime, ctxFor(techA.id), async (tx) => {
      const rows = await tx.execute<{ id: string }>(
        sql`select id from app.socialization_invitation`,
      );
      return rows.rows.map((r) => r.id);
    });
    expect(visible).toEqual([invitationA]);
    expect(visible).not.toContain(invitationB);
  });

  it("and somebody holding field.responses.read sees both", async () => {
    expect(
      await countVisible(db.runtime, reader(coordinator.id), "app.socialization_invitation"),
    ).toBe(2);
  });

  it("a caller that forgets the flag sees only its own, which is the safe direction", async () => {
    // No `fieldResponsesAccess`: the predicate falls back to row ownership.
    expect(
      await countVisible(db.runtime, ctxFor(coordinator.id), "app.socialization_invitation"),
    ).toBe(0);
  });
});

describe("an attempt is filed in your own name", () => {
  it("and the insert policy has no read-everything escape", async () => {
    // The coordinator may *read* every invitation, and still cannot record a delivery as the
    // technician who went. That asymmetry is the whole point of the second policy.
    const refused = await attempt(
      asContext(db.runtime, reader(coordinator.id), (tx) =>
        tx.execute(sql`
          insert into app.socialization_delivery_attempt
            (id, tenant_id, project_id, invitation_id, local_id, technician_user_id, outcome,
             occurred_at_device)
          values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, ${invitationA},
                  ${randomUUID()}, ${techA.id}, 'ABSENT', now())
        `),
      ),
    );
    expect(refused).toMatch(/row-level security policy/i);
  });

  it("and what a technician filed cannot be edited or removed by anybody", async () => {
    await asContext(db.runtime, ctxFor(techA.id), (tx) =>
      tx.execute(sql`
        insert into app.socialization_delivery_attempt
          (id, tenant_id, project_id, invitation_id, local_id, technician_user_id, outcome,
           occurred_at_device)
        values (${randomUUID()}, ${w.tenantA.id}, ${w.projectX.id}, ${invitationA},
                ${randomUUID()}, ${techA.id}, 'ABSENT', now())
      `),
    );

    const updated = await attempt(
      db.migrator.execute(
        sql`update app.socialization_delivery_attempt set outcome = 'DELIVERED'
             where invitation_id = ${invitationA}`,
      ),
    );
    expect(updated).toContain("written once");

    const deleted = await attempt(
      db.migrator.execute(
        sql`delete from app.socialization_delivery_attempt where invitation_id = ${invitationA}`,
      ),
    );
    expect(deleted).toContain("written once");
  });
});

describe("the public surface reaches none of it", () => {
  /*
   * `app.surface = 'public'` is the session-less path the editorial portal opened (migration
   * 0052). It has no user, no membership and no project context, and every policy in this module
   * requires all three. The assertion is here rather than implied because the failure would be
   * silent and severe: a delivery photograph is evidence about a household's gate.
   */
  const publicCtx = {
    userId: "00000000-0000-7000-8000-000000000000",
    tenantId: w?.tenantA.id ?? "00000000-0000-7000-8000-000000000001",
    projectId: null,
    surface: "public" as const,
  };

  it("sees no event, no invitation and no attempt", async () => {
    for (const table of [
      "app.socialization_event",
      "app.socialization_invitation",
      "app.socialization_delivery_attempt",
    ]) {
      const count = await countVisible(db.runtime, { ...publicCtx, tenantId: w.tenantA.id }, table);
      expect(count, table).toBe(0);
    }
  });
});

describe("the grants say what the triggers say", () => {
  it("an attempt has no UPDATE or DELETE for the runtime role, and an event has no DELETE", async () => {
    const rows = await db.migrator.execute<{ table_name: string; privilege_type: string }>(sql`
      select table_name, privilege_type
        from information_schema.role_table_grants
       where grantee = 'eia_app' and table_schema = 'app'
         and table_name in ('socialization_event', 'socialization_invitation',
                            'socialization_delivery_attempt')
       order by table_name, privilege_type
    `);
    const held = new Map<string, Set<string>>();
    for (const row of rows.rows) {
      const set = held.get(row.table_name) ?? new Set<string>();
      set.add(row.privilege_type);
      held.set(row.table_name, set);
    }
    expect([...(held.get("socialization_delivery_attempt") ?? [])].sort()).toEqual([
      "INSERT",
      "SELECT",
    ]);
    expect(held.get("socialization_event")?.has("DELETE")).toBe(false);
    expect(held.get("socialization_invitation")?.has("DELETE")).toBe(false);
  });

  it("and every one of the three forces row level security", async () => {
    const rows = await db.migrator.execute<{ relname: string; rls: boolean; forced: boolean }>(sql`
      select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relkind = 'r' and c.relname like 'socialization%'
    `);
    expect(rows.rows).toHaveLength(3);
    for (const row of rows.rows) {
      expect(row.rls, row.relname).toBe(true);
      expect(row.forced, row.relname).toBe(true);
    }
  });
});
