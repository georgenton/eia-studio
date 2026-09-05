import { type DbTx } from "@eia/db";
import { assertCampaignClosable, type CampaignStatus } from "@eia/domain";
import { sql } from "drizzle-orm";

/**
 * Making one campaign the current operation without rewriting the ones that came before (ADR-026).
 *
 * A campaign is an operational snapshot. When the parcels it should cover change after technicians
 * have been out, there are two things you can do and only one of them is honest: add the new
 * parcels to the campaign that already ran — which quietly turns a twelve-parcel operation into a
 * twenty-two-parcel one that never happened — or close what happened and open what is intended.
 *
 * This does the second. It **deletes nothing**: every assignment, visit, response and answer of the
 * superseded campaign stays exactly where it is, and the campaign stays queryable as the history of
 * an operation that ran. What changes is three columns on the campaign row itself.
 */
export interface CampaignSupersession {
  /** Campaigns that were closed by this call, with what they carried when they closed. */
  readonly closed: ReadonlyArray<{
    readonly id: string;
    readonly previousName: string;
    readonly assignments: number;
    readonly submitted: number;
  }>;
}

export async function supersedeOtherCampaigns(
  tx: DbTx,
  input: {
    readonly tenantId: string;
    readonly projectId: string;
    /** The campaign that is (or is about to become) the current operation. */
    readonly currentCampaignId: string;
    /** What a superseded campaign is called from now on, for a reader looking at history. */
    readonly supersededName: string;
    readonly closedAt: Date;
  },
): Promise<CampaignSupersession> {
  const candidates = await tx.execute(sql`
    select c.id, c.name, c.status,
           (select count(*)::int from app.field_assignment fa
             where fa.tenant_id = c.tenant_id and fa.campaign_id = c.id) as assignments,
           (select count(*)::int from app.survey_instance si
              join app.field_assignment fa2
                on fa2.tenant_id = si.tenant_id and fa2.id = si.assignment_id
             where si.tenant_id = c.tenant_id and fa2.campaign_id = c.id
               and si.status = 'SUBMITTED') as submitted
      from app.survey_campaign c
     where c.tenant_id = ${input.tenantId} and c.project_id = ${input.projectId}
       and c.id <> ${input.currentCampaignId}
       and c.status <> 'CLOSED'
     order by c.created_at
  `);

  const closed: Array<{
    id: string;
    previousName: string;
    assignments: number;
    submitted: number;
  }> = [];

  for (const row of candidates.rows as unknown as ReadonlyArray<{
    id: string;
    name: string;
    status: CampaignStatus;
    assignments: number;
    submitted: number;
  }>) {
    // A draft never went to the field, so there is no operation to preserve and nothing to close;
    // closing one would record something that did not happen. It is left as it is.
    if (row.status === "DRAFT") continue;

    // The lifecycle rule lives in the domain, and this path asks it rather than assuming.
    assertCampaignClosable({ status: row.status });

    await tx.execute(sql`
      update app.survey_campaign
         set status = 'CLOSED',
             closed_at = coalesce(closed_at, ${input.closedAt}),
             name = ${input.supersededName}
       where tenant_id = ${input.tenantId} and id = ${row.id}
    `);

    closed.push({
      id: row.id,
      previousName: row.name,
      assignments: Number(row.assignments),
      submitted: Number(row.submitted),
    });
  }

  return { closed };
}
