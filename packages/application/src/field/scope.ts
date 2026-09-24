import { withDbContext, type Database } from "@eia/db";
import type { FieldScopeResponse } from "@eia/field-sync-contract";
import { sql } from "drizzle-orm";

import { listUserTenants } from "../tenancy/request-context";

/**
 * Which project a device with **no pack yet** should ask for.
 *
 * ## The gap this closes
 *
 * A Field Pack is requested by tenant and project slug, and EIA Field derived both from the pack
 * it already held (`my-work.tsx`: `tenantSlug: pack.project.tenantSlug`). A fresh installation
 * therefore had nowhere to get the *first* one: signing in succeeded, *Mi trabajo* was empty, and
 * both buttons returned before doing anything — `if (!db || !pack) return` and, in the sync
 * engine, `const pack = await readPack(db); if (!pack) …`. This answers the question that comes
 * before the pack.
 *
 * ## Eligibility is an assignment, not a membership
 *
 * A person can be a member of a project for many reasons. Being **given field work** in it is a
 * different fact, and it is the only one that makes a project somebody's *mobile* project. So the
 * query asks for an assignment that is the caller's own, not finished, in a campaign that is
 * active — never `project_membership`. A specialist added to six projects and assigned work in one
 * has one mobile project; a data manager assigned nothing has none, and learns nothing about the
 * projects they are a member of.
 *
 * ## Why there is no privileged read here
 *
 * The user's tenants come from `listUserTenants`, which runs with `app.user_id` set and
 * `app.tenant_id` **unset**, so the membership join is what proves each tenant — the same ordering
 * `resolveAccessContext` uses. Each tenant is then adopted in turn and the assignments are read
 * under it with `app.project_id` left unset, which `field_assignment_select` already allows
 * (migration 0014): *tenant matches, the caller has project access, and the row is the caller's
 * own or they hold `field.responses.read`*. A technician holds neither the permission nor another
 * person's rows, so the database returns exactly their own work, in one query, across the
 * projects they were given it in. No `SECURITY DEFINER` helper, no widened grant, no new policy.
 *
 * ## Three outcomes, and two of them are refusals
 *
 * **One** eligible project yields a scope. **None** and **several** are named states, because a
 * device that silently picked the first of several would be deciding, on a technician's behalf,
 * which study their morning belongs to — and this application holds exactly one pack by database
 * constraint (`field_pack … check (id = 1)`), so there is no honest second answer available to it.
 */
export async function resolveFieldScope(db: Database, userId: string): Promise<FieldScopeResponse> {
  const tenants = await listUserTenants(db, userId);

  const eligible: Array<{ tenantSlug: string; projectSlug: string; projectName: string }> = [];

  for (const tenant of tenants) {
    const found = await withDbContext(
      db,
      { userId, tenantId: tenant.id, projectId: null },
      async (tx) => {
        /*
         * `distinct` over the projects, not the assignments: a technician with eleven parcels in
         * one road has one mobile project, and the count that decides `multiple_field_projects`
         * must be a count of projects.
         *
         * `CANCELLED` and `COMPLETED` are excluded because neither is work to go and do. A device
         * bootstrapped into a project whose last assignment closed a month ago would download a
         * pack with nothing in it and no way to ask for a different one.
         */
        const rows = await tx.execute(sql`
          select distinct p.slug as project_slug, p.name as project_name
            from app.field_assignment a
            join app.project p
              on p.tenant_id = a.tenant_id and p.id = a.project_id
            join app.survey_campaign c
              on c.tenant_id = a.tenant_id and c.id = a.campaign_id
           where a.assignee_user_id = ${userId}
             and a.status in ('PENDING', 'IN_PROGRESS')
             and c.status = 'ACTIVE'
           order by p.slug
        `);
        return rows.rows as Array<{ project_slug: string; project_name: string }>;
      },
    );

    for (const row of found) {
      eligible.push({
        tenantSlug: tenant.slug,
        projectSlug: row.project_slug,
        projectName: row.project_name,
      });
    }
  }

  if (eligible.length === 0) return { kind: "no_field_project" };
  if (eligible.length > 1) {
    return { kind: "multiple_field_projects", count: eligible.length };
  }

  const only = eligible[0];
  if (!only) return { kind: "no_field_project" };
  return {
    kind: "scope",
    tenantSlug: only.tenantSlug,
    projectSlug: only.projectSlug,
    projectName: only.projectName,
  };
}
