import { randomUUID } from "node:crypto";

import { fieldSchema, type Database, type DbTx } from "@eia/db";
import {
  deriveOfflineWindow,
  DomainError,
  NotFound,
  PermissionDenied,
  requireCapability,
  requirePermission,
  type RequestContext,
} from "@eia/domain";
import {
  commandResultSchema,
  FIELD_SYNC_PROTOCOL_VERSION,
  type CommandResult,
  type ConflictReason,
  type SyncCommand,
  type SyncPullResponse,
  type SyncPushResponse,
} from "@eia/field-sync-contract";
import { and, desc, eq, sql } from "drizzle-orm";

import { withFieldContext } from "./context";
import { encodeCursor, readAssignmentsForPull } from "./field-pack";
import { completeVisit, saveSurveyDraft, startVisit, submitSurveyInstance } from "./use-cases";

/**
 * Executing what a device captured offline.
 *
 * ## The one invariant
 *
 * **The same command, sent any number of times, produces one result and one set of rows.** It is
 * the property the whole mobile channel is judged on, and it is built from three things that have
 * to hold together:
 *
 * 1. the device names each intent once — `commandId`, generated when the technician acts;
 * 2. the use-cases underneath are the web app's own, and were already idempotent *by intent* — an
 *    open visit is returned rather than started twice, exactly one response exists per assignment
 *    and version by unique constraint, and a submitted response comes back as a result rather than
 *    as an error;
 * 3. `app.field_sync_receipt` remembers what each command id produced, so a retry replays an
 *    answer instead of re-deciding it.
 *
 * ## The receipt is written after the work, deliberately
 *
 * A use-case opens its own transaction — that is how every caller in this product reaches the
 * database — so the receipt cannot share it without rewriting four use-cases to take a handle.
 * That is a worse trade than it looks, because the failure the shared transaction would prevent is
 * already harmless: a crash between the work and its receipt leaves work applied and unrecorded,
 * the device retries, and the idempotent use-case returns *the same* visit or response. No
 * duplicate is possible; the cost is one wasted round trip in a rare case.
 *
 * The reverse order would not be harmless, so it is not used: a receipt written first could
 * acknowledge work that never happened.
 *
 * ## Why each command is its own transaction
 *
 * A batch of fifteen commands where the ninth conflicts must not discard the eight that worked:
 * the technician would sync again and again and lose the same eight every time. So the batch is a
 * transport convenience and the transaction boundary is one command — which is also what lets the
 * response tell the device, command by command, what it may stop retrying.
 */
export interface ProcessSyncOptions {
  readonly now?: Date;
}

export async function processSyncCommands(
  db: Database,
  ctx: RequestContext,
  commands: ReadonlyArray<SyncCommand>,
  options: ProcessSyncOptions = {},
): Promise<SyncPushResponse> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.capture");
  if (ctx.projectId === null) throw new Error("processSyncCommands requires a project context");
  const now = options.now ?? new Date();

  const results: CommandResult[] = [];
  for (const command of commands) {
    results.push(await processOne(db, ctx, command));
  }
  return {
    protocolVersion: FIELD_SYNC_PROTOCOL_VERSION,
    results,
    cursor: encodeCursor(now),
  };
}

const EMPTY: Omit<CommandResult, "commandId" | "outcome"> = {
  visitId: null,
  instanceId: null,
  instanceStatus: null,
  assignmentStatus: null,
  conflictReason: null,
  message: null,
};

function conflict(commandId: string, reason: ConflictReason, message: string): CommandResult {
  return { ...EMPTY, commandId, outcome: "conflict", conflictReason: reason, message };
}

function rejected(commandId: string, message: string): CommandResult {
  return { ...EMPTY, commandId, outcome: "rejected", message };
}

function superseded(commandId: string, message: string): CommandResult {
  return { ...EMPTY, commandId, outcome: "superseded", message };
}

async function processOne(
  db: Database,
  ctx: RequestContext,
  command: SyncCommand,
): Promise<CommandResult> {
  const projectId = ctx.projectId!;
  try {
    const replay = await withFieldContext(db, ctx, (tx) =>
      findReceipt(tx, ctx, projectId, command.commandId),
    );
    if (replay) {
      // The device did not hear us the first time. Say the same thing again, verbatim, relabelled
      // so it knows the work was not done twice.
      return { ...replay, outcome: "duplicate" as const };
    }

    const guard =
      command.type === "survey.upsert_draft" || command.type === "survey.submit"
        ? await withFieldContext(db, ctx, (tx) => guardSurveyCommand(tx, ctx, projectId, command))
        : null;

    const decided = guard ?? (await execute(db, ctx, command));
    await recordReceipt(db, ctx, projectId, command, decided);
    return decided;
  } catch (error) {
    // A refusal the domain expressed is an answer, not a crash: the device must be told to stop
    // retrying rather than left queueing something that can never succeed.
    const answer = answerForError(command, error);
    if (!answer) throw error;
    await recordReceipt(db, ctx, projectId, command, answer).catch(() => undefined);
    return answer;
  }
}

function answerForError(command: SyncCommand, error: unknown): CommandResult | null {
  if (error instanceof NotFound) {
    return conflict(
      command.commandId,
      "assignment_reassigned",
      "Esta asignación ya no está disponible para ti. Tu trabajo local se conservó.",
    );
  }
  if (error instanceof PermissionDenied) {
    return conflict(
      command.commandId,
      "campaign_closed",
      "La campaña ya no admite capturas. Tu trabajo local se conservó.",
    );
  }
  if (error instanceof DomainError) return rejected(command.commandId, error.message);
  return null;
}

/**
 * Run one command through the use-case the browser would have used.
 *
 * Note what this does **not** do: it writes no visit, no response and no answer of its own. A
 * device therefore cannot produce a row the web form could not have produced, and a rule added to
 * the domain tomorrow applies to the mobile channel without anybody remembering to copy it here.
 */
async function execute(
  db: Database,
  ctx: RequestContext,
  command: SyncCommand,
): Promise<CommandResult> {
  switch (command.type) {
    case "visit.start": {
      const result = await startVisit(db, ctx, {
        assignmentId: command.payload.assignmentId,
        location: command.payload.location
          ? {
              latitude: command.payload.location.latitude,
              longitude: command.payload.location.longitude,
              accuracyM: command.payload.location.accuracyM,
              capturedAt: new Date(command.payload.location.capturedAt),
            }
          : null,
        locationOutcome: command.payload.locationOutcome,
      });
      return {
        ...EMPTY,
        commandId: command.commandId,
        outcome: "applied",
        visitId: result.visitId,
      };
    }
    case "survey.upsert_draft": {
      const result = await saveSurveyDraft(db, ctx, {
        assignmentId: command.payload.assignmentId,
        visitId: command.payload.visitId,
        answers: command.payload.answers,
      });
      return {
        ...EMPTY,
        commandId: command.commandId,
        outcome: "applied",
        instanceId: result.instanceId,
        instanceStatus: result.status,
      };
    }
    case "survey.submit": {
      const result = await submitSurveyInstance(db, ctx, {
        assignmentId: command.payload.assignmentId,
        visitId: command.payload.visitId,
        answers: command.payload.answers,
      });
      return {
        ...EMPTY,
        commandId: command.commandId,
        outcome: "applied",
        instanceId: result.instanceId,
        instanceStatus: result.status,
        assignmentStatus: "COMPLETED",
        message: result.alreadySubmitted ? "El servidor ya tenía esta ficha enviada." : null,
      };
    }
    case "visit.finish": {
      const result = await completeVisit(db, ctx, command.payload.visitId);
      return {
        ...EMPTY,
        commandId: command.commandId,
        outcome: "applied",
        visitId: result.visitId,
      };
    }
  }
}

/**
 * The three conflicts a survey command can meet, checked before anything is written.
 *
 * **The questionnaire moved.** The device answers the version it downloaded; if the campaign now
 * names a different one, those answers are answers to different questions. The server refuses
 * rather than reinterpreting them, and the device keeps the draft for a person to look at.
 *
 * **The response is already submitted, and this is a draft.** Terminal, and *superseded* rather
 * than *conflict*: the work is accounted for, there is nothing for anybody to review, and the
 * queue must stop.
 *
 * **A stale revision.** A draft whose `deviceRevision` is not newer than the last one applied for
 * this entity arrived out of order behind a fresher one. Applying it would write older answers
 * over newer ones — the silent data loss that "last write wins" produces on a bad connection.
 */
async function guardSurveyCommand(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
  command: Extract<SyncCommand, { type: "survey.upsert_draft" | "survey.submit" }>,
): Promise<CommandResult | null> {
  const rows = await tx.execute(sql`
    select c.survey_version_id, c.status as campaign_status, fa.status as assignment_status,
           si.status as instance_status
      from app.field_assignment fa
      join app.survey_campaign c on c.tenant_id = fa.tenant_id and c.id = fa.campaign_id
      left join app.survey_instance si
        on si.tenant_id = fa.tenant_id and si.assignment_id = fa.id
       and si.survey_version_id = c.survey_version_id
     where fa.tenant_id = ${ctx.tenantId} and fa.project_id = ${projectId}
       and fa.id = ${command.payload.assignmentId}
       and fa.assignee_user_id = ${ctx.userId}
     limit 1
  `);
  const row = rows.rows[0] as
    | {
        survey_version_id: string;
        campaign_status: string;
        assignment_status: string;
        instance_status: string | null;
      }
    | undefined;
  if (!row) {
    return conflict(
      command.commandId,
      "assignment_reassigned",
      "Esta asignación ya no es tuya. Tu trabajo local se conservó para revisión.",
    );
  }
  if (row.assignment_status === "CANCELLED") {
    return conflict(
      command.commandId,
      "assignment_cancelled",
      "La asignación fue cancelada. Tu trabajo local se conservó para revisión.",
    );
  }
  if (row.campaign_status !== "ACTIVE") {
    return conflict(
      command.commandId,
      "campaign_closed",
      "La campaña fue cerrada. Tu trabajo local se conservó para revisión.",
    );
  }
  if (row.survey_version_id !== command.payload.surveyVersionId) {
    return conflict(
      command.commandId,
      "survey_version_changed",
      "El cuestionario cambió en el servidor después de tu descarga. Tus respuestas se " +
        "conservaron sin reinterpretarlas.",
    );
  }
  if (command.type === "survey.upsert_draft" && row.instance_status === "SUBMITTED") {
    return superseded(
      command.commandId,
      "La ficha ya estaba enviada; este borrador quedó sin efecto.",
    );
  }

  const lastRevision = await lastAppliedRevision(
    tx,
    ctx,
    projectId,
    command.payload.assignmentId,
    command.type,
  );
  if (lastRevision !== null && command.deviceRevision <= lastRevision) {
    return superseded(
      command.commandId,
      "Llegó una versión más reciente de esta ficha antes que esta.",
    );
  }
  return null;
}

async function lastAppliedRevision(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
  entityId: string,
  commandType: SyncCommand["type"],
): Promise<number | null> {
  const rows = await tx
    .select({ deviceRevision: fieldSchema.fieldSyncReceipt.deviceRevision })
    .from(fieldSchema.fieldSyncReceipt)
    .where(
      and(
        eq(fieldSchema.fieldSyncReceipt.tenantId, ctx.tenantId),
        eq(fieldSchema.fieldSyncReceipt.projectId, projectId),
        eq(fieldSchema.fieldSyncReceipt.userId, ctx.userId),
        eq(fieldSchema.fieldSyncReceipt.entityId, entityId),
        eq(fieldSchema.fieldSyncReceipt.commandType, commandType),
        eq(fieldSchema.fieldSyncReceipt.outcome, "applied"),
      ),
    )
    .orderBy(desc(fieldSchema.fieldSyncReceipt.deviceRevision))
    .limit(1);
  return rows[0]?.deviceRevision ?? null;
}

async function findReceipt(
  tx: DbTx,
  ctx: RequestContext,
  projectId: string,
  commandId: string,
): Promise<CommandResult | null> {
  const rows = await tx
    .select({ result: fieldSchema.fieldSyncReceipt.result })
    .from(fieldSchema.fieldSyncReceipt)
    .where(
      and(
        eq(fieldSchema.fieldSyncReceipt.tenantId, ctx.tenantId),
        eq(fieldSchema.fieldSyncReceipt.projectId, projectId),
        eq(fieldSchema.fieldSyncReceipt.commandId, commandId),
      ),
    )
    .limit(1);
  const stored = rows[0]?.result;
  if (!stored) return null;
  return commandResultSchema.parse(stored);
}

/**
 * Record what this command produced.
 *
 * `onConflictDoNothing` on the unique `(tenant, project, command_id)` key, because two retries can
 * legitimately be in flight at once: the loser of that race must not fail the command it just
 * completed successfully. The stored answer is the winner's, and both devices see the same one.
 */
async function recordReceipt(
  db: Database,
  ctx: RequestContext,
  projectId: string,
  command: SyncCommand,
  result: CommandResult,
): Promise<void> {
  await withFieldContext(db, ctx, async (tx) => {
    await tx
      .insert(fieldSchema.fieldSyncReceipt)
      .values({
        id: randomUUID(),
        tenantId: ctx.tenantId,
        projectId,
        // From the session, never from the payload: a device cannot say whose work this is.
        userId: ctx.userId,
        commandId: command.commandId,
        commandType: command.type,
        outcome: result.outcome,
        entityKind: command.type.startsWith("visit.") ? "visit" : "survey",
        entityId: command.payload.assignmentId,
        deviceRevision: command.deviceRevision,
        result,
      })
      .onConflictDoNothing();
  });
}

/* ---------------------------------------------------------------------------------------------
 * Pull
 * ------------------------------------------------------------------------------------------ */

/**
 * What changed for this technician.
 *
 * Returns the **current** set of their assignments plus the ids that are no longer theirs, rather
 * than a diff — see `field-pack.ts` for why a set this small is answered completely instead of
 * incrementally. The device reconciles: it upserts what it is given and marks anything revoked,
 * and it never deletes local work over it.
 */
export async function pullFieldChanges(
  db: Database,
  ctx: RequestContext,
  input: {
    readonly knownAssignmentIds: ReadonlyArray<string>;
    /** The session behind this pull; the renewed offline window can never outlive it. */
    readonly sessionExpiresAt: Date;
  },
  options: ProcessSyncOptions = {},
): Promise<SyncPullResponse | null> {
  requireCapability(ctx, "field.surveys");
  requirePermission(ctx, "field.assignments.read_own");
  if (ctx.projectId === null) throw new Error("pullFieldChanges requires a project context");
  const projectId = ctx.projectId;
  const now = options.now ?? new Date();

  return withFieldContext(db, ctx, async (tx) => {
    const campaignRows = await tx.execute(sql`
      select c.id, c.status, c.survey_version_id
        from app.survey_campaign c
       where c.tenant_id = ${ctx.tenantId} and c.project_id = ${projectId} and c.status = 'ACTIVE'
       order by c.activated_at desc nulls last
       limit 1
    `);
    const campaign = campaignRows.rows[0] as
      { id: string; status: "ACTIVE"; survey_version_id: string } | undefined;
    if (!campaign) return null;

    const assignments = await readAssignmentsForPull(
      tx,
      ctx,
      projectId,
      campaign.id,
      campaign.survey_version_id,
    );
    const currentIds = new Set(assignments.map((assignment) => assignment.id));
    const revoked = input.knownAssignmentIds.filter((id) => !currentIds.has(id));

    return {
      protocolVersion: FIELD_SYNC_PROTOCOL_VERSION,
      campaignStatus: campaign.status,
      surveyVersionId: campaign.survey_version_id,
      assignments: [...assignments],
      revokedAssignmentIds: revoked,
      // A successful pull is server contact, so it renews the offline window on the same terms
      // the pack was issued under — which is why syncing is what a technician does before driving
      // out, and why the app says so when the window is close.
      validity: (() => {
        const window = deriveOfflineWindow({ now, sessionExpiresAt: input.sessionExpiresAt });
        return {
          issuedAt: window.issuedAt.toISOString(),
          expiresAt: window.expiresAt.toISOString(),
          basis: window.basis,
        };
      })(),
      cursor: encodeCursor(now),
    };
  });
}
