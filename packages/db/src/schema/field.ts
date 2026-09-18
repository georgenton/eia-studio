import {
  boolean,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { app, project, projectMembership, provenanceRecord, user } from "./app";
import { parcel } from "./gis";
import { storedObject } from "./storage";

/**
 * FieldFlow tables (DATA_MODEL.md §3.4, design v0.2 §04–05).
 *
 * The shape of this module is decided by two things it must survive.
 *
 * **A questionnaire changes while fieldwork is running.** So a response points at a
 * `survey_version`, never at a template, and a published version is immutable — enforced by
 * triggers in migration 0014, not only by a use-case. Answers therefore keep the exact questions
 * they were given, for ever, including after the version is retired.
 *
 * **A technician must not be able to read the project's other responses.** So `survey_instance`
 * and its answers are reachable at the row level only by their own technician, or by a role
 * holding `field.responses.read` — a separate permission from "can open the project". The policies
 * in 0014 say this again in SQL, because a permission check that lives only in a use-case is one
 * repository call away from being bypassed.
 *
 * Answers are typed columns, not a JSONB blob: a blob cannot be constrained, cannot be indexed
 * usefully, and cannot guarantee a choice still exists as an option of that version — three costs
 * paid entirely by the Social slice that reads them next.
 *
 * Vocabularies are duplicated from @eia/domain on purpose (db must not depend on domain); a test
 * asserts both lists stay identical.
 */

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

/**
 * A visit's captured point. Canonical `EPSG:4326`, like every other geometry (ADR-017); a visit
 * point needs no analysis CRS, because nothing measures a distance from it.
 */
const pointColumn = customType<{ data: string; driverData: string }>({
  dataType: () => "geometry(Point,4326)",
});

export const surveyVersionStatus = app.enum("survey_version_status", [
  "DRAFT",
  "PUBLISHED",
  "RETIRED",
]);

export const questionType = app.enum("survey_question_type", [
  "SHORT_TEXT",
  "LONG_TEXT",
  "INTEGER",
  "DECIMAL",
  "BOOLEAN",
  "SINGLE_CHOICE",
  "MULTI_CHOICE",
  "DATE",
]);

export const questionSensitivity = app.enum("survey_question_sensitivity", [
  "NON_PERSONAL",
  "PERSONAL",
  "SENSITIVE",
]);

export const campaignStatus = app.enum("survey_campaign_status", ["DRAFT", "ACTIVE", "CLOSED"]);

/**
 * Vocabularies are duplicated from @eia/domain on purpose (db must not depend on domain); a test
 * asserts the lists stay identical. `EIA_FIELD_MOBILE` arrives with the first-party application
 * in Production V1 Wave 1 and is the first channel that declares offline support.
 */
export const captureChannel = app.enum("field_capture_channel", ["NATIVE_WEB", "EIA_FIELD_MOBILE"]);

export const assignmentStatus = app.enum("field_assignment_status", [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]);

export const visitStatus = app.enum("field_visit_status", ["IN_PROGRESS", "COMPLETED"]);

export const locationOutcome = app.enum("field_location_outcome", [
  "captured",
  "denied",
  "unavailable",
  "not_attempted",
]);

export const instanceStatus = app.enum("survey_instance_status", ["IN_PROGRESS", "SUBMITTED"]);

/** A correction settles once: requested, then applied or cancelled (ADR-038). */
export const correctionState = app.enum("survey_correction_state", [
  "REQUESTED",
  "APPLIED",
  "CANCELLED",
]);

/* ---------------------------------------------------------------------------------------------
 * Project configuration (FEATURES.md §4)
 * ------------------------------------------------------------------------------------------ */

/**
 * Typed project settings, validated against `CONFIGURATION_REGISTRY` before they are written.
 *
 * Only the project layer exists. FEATURES.md also describes tenant defaults; that layer arrives
 * with a setting that needs one, because an unread table is a switch that appears to do something
 * and does not.
 */
export const projectConfiguration = app.table(
  "project_configuration",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    key: text("key").notNull(),
    /** Stored as text and parsed by the registry's zod schema; the registry owns the type. */
    value: text("value").notNull(),
    changedBy: uuid("changed_by"),
    changedAt: timestamp("changed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("project_configuration_project_key_key").on(t.tenantId, t.projectId, t.key),
    foreignKey({
      name: "project_configuration_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
  ],
);

/* ---------------------------------------------------------------------------------------------
 * Questionnaire definition
 * ------------------------------------------------------------------------------------------ */

/** The questionnaire as a concept. Holds a name and an owner; never a question. */
export const surveyTemplate = app.table(
  "survey_template",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("survey_template_project_key_key").on(t.tenantId, t.projectId, t.key),
    unique("survey_template_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "survey_template_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
  ],
);

/**
 * One immutable questionnaire definition. Answers reference this, so once it is `PUBLISHED`
 * nothing about it or its questions may change: migration 0014 refuses the UPDATE and the DELETE.
 */
export const surveyVersion = app.table(
  "survey_version",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    templateId: uuid("template_id").notNull(),
    versionLabel: text("version_label").notNull(),
    status: surveyVersionStatus("status").notNull().default("DRAFT"),
    /** Deterministic fingerprint of the definition; lets a mismatch be detected, not identity. */
    definitionHash: text("definition_hash"),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    /** Who decided people may be asked this. Null while it is a draft (ADR-037). */
    publishedByUserId: uuid("published_by_user_id"),
    retiredAt: timestamp("retired_at", { withTimezone: true, mode: "date" }),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("survey_version_template_label_key").on(t.tenantId, t.templateId, t.versionLabel),
    unique("survey_version_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "survey_version_template_fk",
      columns: [t.tenantId, t.templateId],
      foreignColumns: [surveyTemplate.tenantId, surveyTemplate.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "survey_version_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "survey_version_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }),
    foreignKey({
      name: "survey_version_published_by_fk",
      columns: [t.publishedByUserId],
      foreignColumns: [user.id],
    }),
    index("survey_version_template_status_idx").on(t.tenantId, t.templateId, t.status),
  ],
);

export const surveyQuestion = app.table(
  "survey_question",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    versionId: uuid("version_id").notNull(),
    code: text("code").notNull(),
    ordinal: integer("ordinal").notNull(),
    type: questionType("type").notNull(),
    prompt: text("prompt").notNull(),
    helpText: text("help_text"),
    /**
     * A heading this question is read under, and nothing else (ADR-037).
     *
     * Not an entity: no id, no order of its own, no rule. Nothing about an answer depends on it,
     * which is why it is a label on the question rather than a table beside it — a section table
     * would be a second thing a tabulation could be grouped by, and there is only one.
     */
    section: text("section"),
    required: boolean("required").notNull().default(false),
    /** Classification for a future retention/export policy; it authorizes nothing today. */
    sensitivity: questionSensitivity("sensitivity").notNull().default("NON_PERSONAL"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("survey_question_version_code_key").on(t.tenantId, t.versionId, t.code),
    unique("survey_question_version_ordinal_key").on(t.tenantId, t.versionId, t.ordinal),
    unique("survey_question_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "survey_question_version_fk",
      columns: [t.tenantId, t.versionId],
      foreignColumns: [surveyVersion.tenantId, surveyVersion.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "survey_question_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
  ],
);

/** Choices belong to a question of a specific version, which is what scopes an answer's meaning. */
export const surveyOption = app.table(
  "survey_option",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    questionId: uuid("question_id").notNull(),
    code: text("code").notNull(),
    label: text("label").notNull(),
    ordinal: integer("ordinal").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("survey_option_question_code_key").on(t.tenantId, t.questionId, t.code),
    unique("survey_option_question_ordinal_key").on(t.tenantId, t.questionId, t.ordinal),
    unique("survey_option_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "survey_option_question_fk",
      columns: [t.tenantId, t.questionId],
      foreignColumns: [surveyQuestion.tenantId, surveyQuestion.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "survey_option_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
  ],
);

/* ---------------------------------------------------------------------------------------------
 * Operational field work
 * ------------------------------------------------------------------------------------------ */

/** The operational container: project → published survey version → assignments → progress. */
export const surveyCampaign = app.table(
  "survey_campaign",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    name: text("name").notNull(),
    surveyVersionId: uuid("survey_version_id").notNull(),
    status: campaignStatus("status").notNull().default("DRAFT"),
    captureChannel: captureChannel("capture_channel").notNull().default("NATIVE_WEB"),
    /**
     * The project's `field.surveys.offline_mode` as it stood when the campaign was activated.
     * Snapshotted so a later settings change cannot retroactively invalidate work already done,
     * and so the record says what rule the activation was judged against.
     */
    offlineModeAtActivation: text("offline_mode_at_activation"),
    startsOn: date("starts_on"),
    targetOn: date("target_on"),
    activatedAt: timestamp("activated_at", { withTimezone: true, mode: "date" }),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    createdBy: uuid("created_by"),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("survey_campaign_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "survey_campaign_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "survey_campaign_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }),
    foreignKey({
      name: "survey_campaign_version_fk",
      columns: [t.tenantId, t.surveyVersionId],
      foreignColumns: [surveyVersion.tenantId, surveyVersion.id],
    }),
    index("survey_campaign_project_status_idx").on(t.tenantId, t.projectId, t.status),
  ],
);

/**
 * One technician asked to survey one parcel for one campaign.
 *
 * `assignee_membership_id` is a **project membership**, not a raw user: an assignment cannot
 * outlive the membership that justifies it, and suspending the membership suspends the work.
 */
export const fieldAssignment = app.table(
  "field_assignment",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    campaignId: uuid("campaign_id").notNull(),
    parcelId: uuid("parcel_id").notNull(),
    assigneeMembershipId: uuid("assignee_membership_id").notNull(),
    /** Denormalised from the membership so RLS can compare without a recursive policy. */
    assigneeUserId: uuid("assignee_user_id").notNull(),
    status: assignmentStatus("status").notNull().default("PENDING"),
    /**
     * Set when this assignment exists only to capture a correction of another one (ADR-038).
     *
     * A correction is a **new** assignment rather than a reopening of the original, so *who was
     * originally assigned* and *who performed the correction* are two rows rather than one
     * overwritten column, and `survey_instance`'s `(assignment, version)` uniqueness — what makes
     * a retried offline submit a no-op — is untouched. It stays in the same campaign and on the
     * same parcel, because tabulation is scoped by campaign.
     */
    correctsAssignmentId: uuid("corrects_assignment_id"),
    note: text("note"),
    assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    /*
     * One live *ordinary* assignment per parcel per campaign; re-assignment moves the row, not a
     * new one. Migration 0051 replaces the plain unique constraint this used to be with a partial
     * unique index excluding correction assignments (ADR-038), so the rule is unchanged for the
     * assignments it was written about and a correction can sit beside the work it corrects.
     */
    unique("field_assignment_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "field_assignment_campaign_fk",
      columns: [t.tenantId, t.campaignId],
      foreignColumns: [surveyCampaign.tenantId, surveyCampaign.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "field_assignment_parcel_fk",
      columns: [t.tenantId, t.parcelId],
      foreignColumns: [parcel.tenantId, parcel.id],
    }),
    foreignKey({
      name: "field_assignment_assignee_fk",
      columns: [t.tenantId, t.assigneeMembershipId],
      foreignColumns: [projectMembership.tenantId, projectMembership.id],
    }),
    foreignKey({
      name: "field_assignment_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "field_assignment_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }),
    foreignKey({
      name: "field_assignment_corrects_fk",
      columns: [t.tenantId, t.correctsAssignmentId],
      foreignColumns: [t.tenantId, t.id],
    }),
    index("field_assignment_assignee_idx").on(t.tenantId, t.projectId, t.assigneeUserId),
    index("field_assignment_campaign_status_idx").on(t.tenantId, t.campaignId, t.status),
  ],
);

/** The field event itself. Lifecycle timestamps are server time; the location's is the device's. */
export const fieldVisit = app.table(
  "field_visit",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    assignmentId: uuid("assignment_id").notNull(),
    technicianUserId: uuid("technician_user_id").notNull(),
    status: visitStatus("status").notNull().default("IN_PROGRESS"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    location: pointColumn("location"),
    locationAccuracyM: numeric("location_accuracy_m", { precision: 10, scale: 1 }),
    /** The browser's own reading time — a different fact from `started_at`. */
    locationCapturedAt: timestamp("location_captured_at", { withTimezone: true, mode: "date" }),
    /** Why there is no point, when there is none. Recorded truthfully; never fabricated. */
    locationOutcome: locationOutcome("location_outcome").notNull().default("not_attempted"),
    note: text("note"),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("field_visit_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "field_visit_assignment_fk",
      columns: [t.tenantId, t.assignmentId],
      foreignColumns: [fieldAssignment.tenantId, fieldAssignment.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "field_visit_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "field_visit_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }),
    index("field_visit_assignment_idx").on(t.tenantId, t.assignmentId),
    index("field_visit_technician_idx").on(t.tenantId, t.projectId, t.technicianUserId),
  ],
);

/* ---------------------------------------------------------------------------------------------
 * Responses
 * ------------------------------------------------------------------------------------------ */

export const surveyInstance = app.table(
  "survey_instance",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    assignmentId: uuid("assignment_id").notNull(),
    visitId: uuid("visit_id"),
    surveyVersionId: uuid("survey_version_id").notNull(),
    respondentUserId: uuid("respondent_user_id").notNull(),
    status: instanceStatus("status").notNull().default("IN_PROGRESS"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "date" }),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    /**
     * One response per assignment per version. The invariant that makes a double-submit a no-op
     * rather than a second household: a retried request finds the row it already wrote.
     */
    unique("survey_instance_assignment_version_key").on(
      t.tenantId,
      t.assignmentId,
      t.surveyVersionId,
    ),
    unique("survey_instance_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "survey_instance_assignment_fk",
      columns: [t.tenantId, t.assignmentId],
      foreignColumns: [fieldAssignment.tenantId, fieldAssignment.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "survey_instance_visit_fk",
      columns: [t.tenantId, t.visitId],
      foreignColumns: [fieldVisit.tenantId, fieldVisit.id],
    }),
    foreignKey({
      name: "survey_instance_version_fk",
      columns: [t.tenantId, t.surveyVersionId],
      foreignColumns: [surveyVersion.tenantId, surveyVersion.id],
    }),
    foreignKey({
      name: "survey_instance_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "survey_instance_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }),
    index("survey_instance_respondent_idx").on(t.tenantId, t.projectId, t.respondentUserId),
    index("survey_instance_version_status_idx").on(t.tenantId, t.surveyVersionId, t.status),
  ],
);

/**
 * One answer to one question: mutually exclusive typed columns, never a blob.
 *
 * A CHECK in 0014 enforces that the filled column matches the question's type, so a number cannot
 * land where a date belongs and the Social slice can read a column instead of casting a string.
 */
export const surveyAnswer = app.table(
  "survey_answer",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    instanceId: uuid("instance_id").notNull(),
    questionId: uuid("question_id").notNull(),
    textValue: text("text_value"),
    numberValue: numeric("number_value", { precision: 18, scale: 6 }),
    booleanValue: boolean("boolean_value"),
    dateValue: date("date_value"),
    /** `SINGLE_CHOICE` only; `MULTI_CHOICE` uses `survey_answer_option`. */
    optionId: uuid("option_id"),
    answeredAt: timestamp("answered_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("survey_answer_instance_question_key").on(t.tenantId, t.instanceId, t.questionId),
    unique("survey_answer_tenant_id_id_key").on(t.tenantId, t.id),
    foreignKey({
      name: "survey_answer_instance_fk",
      columns: [t.tenantId, t.instanceId],
      foreignColumns: [surveyInstance.tenantId, surveyInstance.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "survey_answer_question_fk",
      columns: [t.tenantId, t.questionId],
      foreignColumns: [surveyQuestion.tenantId, surveyQuestion.id],
    }),
    foreignKey({
      name: "survey_answer_option_fk",
      columns: [t.tenantId, t.optionId],
      foreignColumns: [surveyOption.tenantId, surveyOption.id],
    }),
    foreignKey({
      name: "survey_answer_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    index("survey_answer_question_idx").on(t.tenantId, t.questionId),
  ],
);

/** Multi-choice selections, normalised so a tabulation is a GROUP BY rather than a string parse. */
export const surveyAnswerOption = app.table(
  "survey_answer_option",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    answerId: uuid("answer_id").notNull(),
    optionId: uuid("option_id").notNull(),
  },
  (t) => [
    unique("survey_answer_option_answer_option_key").on(t.tenantId, t.answerId, t.optionId),
    foreignKey({
      name: "survey_answer_option_answer_fk",
      columns: [t.tenantId, t.answerId],
      foreignColumns: [surveyAnswer.tenantId, surveyAnswer.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "survey_answer_option_option_fk",
      columns: [t.tenantId, t.optionId],
      foreignColumns: [surveyOption.tenantId, surveyOption.id],
    }),
    foreignKey({
      name: "survey_answer_option_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    index("survey_answer_option_option_idx").on(t.tenantId, t.optionId),
  ],
);

/**
 * Which response replaces which, and why (ADR-038).
 *
 * The row *is* the supersession: there is no `superseded` flag on `survey_instance`, because a
 * boolean on the thing being replaced is a fact two writers can disagree about, and because
 * "replaced by what?" is the question every reader actually has.
 *
 * `correcting_instance_id` is null while the correction is `REQUESTED` — nobody has captured
 * anything yet — and is set in the same transaction that submits the correcting response. Until
 * then the original stays effective, which is what makes an unfinished correction harmless.
 *
 * `reason` is a person's operational words and is shown beside the lineage. It never reaches the
 * audit log, because a reason can quote an answer (SECURITY.md §9).
 */
export const surveyCorrection = app.table(
  "survey_correction",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    /** The submitted response being replaced. Effective at the moment of the request. */
    originalInstanceId: uuid("original_instance_id").notNull(),
    /** The assignment created to carry the correction capture. */
    correctionAssignmentId: uuid("correction_assignment_id").notNull(),
    /** The response that replaced it, once one has been submitted. */
    correctingInstanceId: uuid("correcting_instance_id"),
    state: correctionState("state").notNull().default("REQUESTED"),
    reason: text("reason").notNull(),
    requestedByUserId: uuid("requested_by_user_id").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    appliedAt: timestamp("applied_at", { withTimezone: true, mode: "date" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
    cancelledByUserId: uuid("cancelled_by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("survey_correction_tenant_id_id_key").on(t.tenantId, t.id),
    /** One assignment carries one correction, so a work item is never ambiguous. */
    unique("survey_correction_assignment_key").on(t.tenantId, t.correctionAssignmentId),
    foreignKey({
      name: "survey_correction_original_fk",
      columns: [t.tenantId, t.originalInstanceId],
      foreignColumns: [surveyInstance.tenantId, surveyInstance.id],
    }),
    foreignKey({
      name: "survey_correction_correcting_fk",
      columns: [t.tenantId, t.correctingInstanceId],
      foreignColumns: [surveyInstance.tenantId, surveyInstance.id],
    }),
    foreignKey({
      name: "survey_correction_assignment_fk",
      columns: [t.tenantId, t.correctionAssignmentId],
      foreignColumns: [fieldAssignment.tenantId, fieldAssignment.id],
    }),
    foreignKey({
      name: "survey_correction_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    index("survey_correction_original_idx").on(t.tenantId, t.originalInstanceId),
    index("survey_correction_state_idx").on(t.tenantId, t.projectId, t.state),
  ],
);

/**
 * A questionnaire in more than one language, without becoming more than one questionnaire.
 *
 * ## The identity rule
 *
 * A question is its `code`. Its `type`, its options' codes, its ordinal and its required-ness are
 * language-neutral, and an answer points at the **option code**, never at a label. So a bilingual
 * form is one `survey_version` with one set of questions, plus a row here per language — not
 * `pregunta_es` and `question_en`, which would double every tabulation, split every coding and make
 * "the same question" a judgement call.
 *
 * ## The canonical text stays where it is
 *
 * `survey_question.prompt` remains the `es-EC` wording: the language the questionnaires were
 * written in, and the one every existing version already holds. A translation row is an *addition*
 * for another locale, so nothing had to be migrated and a version with no translations behaves
 * exactly as it did before.
 *
 * ## A translation is part of the definition (ADR-029)
 *
 * Which means it is frozen when the version is published, by the same trigger that freezes the
 * questions themselves. Adding a translation to a questionnaire technicians are already answering
 * would change what a respondent was asked *after* they answered it — the precise failure
 * ADR-006's immutability exists to prevent, and it does not become acceptable because the change is
 * "only a translation".
 */
export const surveyQuestionTranslation = app.table(
  "survey_question_translation",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    questionId: uuid("question_id").notNull(),
    /** A BCP-47 tag from `@eia/i18n`'s closed list; text, so a new locale needs no migration. */
    locale: text("locale").notNull(),
    prompt: text("prompt").notNull(),
    helpText: text("help_text"),
    /**
     * The heading, in this language (ADR-037).
     *
     * It lives here rather than in a table of its own because a section *is* part of the
     * questionnaire's words, and these rows are already frozen with the definition by the same
     * trigger. A second table would have been a second thing to freeze.
     */
    section: text("section"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("survey_question_translation_key").on(t.tenantId, t.questionId, t.locale),
    foreignKey({
      name: "survey_question_translation_question_fk",
      columns: [t.tenantId, t.questionId],
      foreignColumns: [surveyQuestion.tenantId, surveyQuestion.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "survey_question_translation_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
  ],
);

export const surveyOptionTranslation = app.table(
  "survey_option_translation",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    optionId: uuid("option_id").notNull(),
    locale: text("locale").notNull(),
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("survey_option_translation_key").on(t.tenantId, t.optionId, t.locale),
    foreignKey({
      name: "survey_option_translation_option_fk",
      columns: [t.tenantId, t.optionId],
      foreignColumns: [surveyOption.tenantId, surveyOption.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "survey_option_translation_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
  ],
);

/**
 * What the server has already done for a device, so that doing it again changes nothing.
 *
 * ## Why a table and not "make the use-cases idempotent"
 *
 * Most of them already are. `startVisit` returns the open visit rather than starting a second;
 * `submitSurveyInstance` returns an already-submitted response as a result rather than an error;
 * one `survey_instance` exists per assignment and version by unique constraint. What none of them
 * can do is tell a *retry* from a *new intent* — and the difference matters in one direction that
 * a phone in a valley produces constantly: a draft command retried after its own submit succeeded
 * would otherwise raise `InstanceAlreadySubmitted` for ever, and a queue that can never drain is
 * how a technician's later work stops arriving.
 *
 * So the device names each intent once (`command_id`, generated when the technician acts and never
 * regenerated), and this table remembers what that intent produced. The second arrival replays the
 * stored answer. The uniqueness constraint is the guarantee; the rest of the row is what makes an
 * incident readable afterwards.
 *
 * `device_revision` is the other half: it orders one device's edits to one entity, so a draft that
 * overtook a newer one is recognised as stale and acknowledged as superseded rather than applied
 * backwards over fresher answers.
 */
export const syncCommandType = app.enum("field_sync_command_type", [
  "visit.start",
  "survey.upsert_draft",
  "survey.submit",
  "visit.finish",
  "media.declare",
]);

export const syncCommandOutcome = app.enum("field_sync_outcome", [
  "applied",
  "duplicate",
  "superseded",
  "conflict",
  "rejected",
]);

export const fieldSyncReceipt = app.table(
  "field_sync_receipt",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    /** The technician the session resolved to. Never a value the device sent. */
    userId: uuid("user_id").notNull(),
    /** Generated on the device at the moment of intent; the whole mechanism rests on it. */
    commandId: uuid("command_id").notNull(),
    commandType: syncCommandType("command_type").notNull(),
    outcome: syncCommandOutcome("outcome").notNull(),
    /** Which local entity the command was about, so a stale revision can be recognised. */
    entityKind: text("entity_kind").notNull(),
    entityId: uuid("entity_id"),
    deviceRevision: integer("device_revision").notNull().default(0),
    /** The `CommandResult` that was returned, replayed verbatim on a retry. */
    result: jsonb("result").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The guarantee. One command id, one outcome, per project.
    unique("field_sync_receipt_command_key").on(t.tenantId, t.projectId, t.commandId),
    index("field_sync_receipt_entity_idx").on(t.tenantId, t.projectId, t.userId, t.entityId),
    foreignKey({
      name: "field_sync_receipt_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
  ],
);

/* ---------------------------------------------------------------------------------------------
 * Field media (ADR-032)
 * ------------------------------------------------------------------------------------------ */

export const fieldMediaKind = app.enum("field_media_kind", [
  "parcel",
  "affectation",
  "access",
  "other",
]);

/**
 * A photograph a technician took on a visit.
 *
 * **It is not a file.** The bytes are a `stored_object`, verified by this product before this row
 * exists (ADR-031); this row is the statement that the photograph belongs to this visit, was taken
 * at this moment, and means this. Deleting the row would orphan an object; there is no path that
 * deletes either.
 *
 * **`local_id` is the idempotency, and it comes from the device.** Minted once when the shutter
 * closes, never regenerated. A unique index on `(tenant_id, visit_id, local_id)` means a retry —
 * after a lost response, a crashed application, a reinstalled outbox — cannot produce a second row
 * for one photograph. The sync receipt would also catch the ordinary retry; this catches the one
 * where the receipt is gone and the gallery is not.
 *
 * **Row ownership, not project access.** A photograph of a parcel can hold a person, a house
 * number or a number plate, so the policy is the one `survey_instance` uses: your own, or
 * `field.responses.read`. A GIS specialist may know a parcel was visited without seeing the
 * photographs taken there (SECURITY.md §10b).
 *
 * `location` is where the **technician** stood, like a visit's — never a household's address, and
 * never fabricated when the device had no fix.
 */
export const fieldMedia = app.table(
  "field_media",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    visitId: uuid("visit_id").notNull(),
    assignmentId: uuid("assignment_id").notNull(),
    /** The technician whose device captured it. The session's user, never a value it sent. */
    capturedByUserId: uuid("captured_by_user_id").notNull(),
    /** Minted on the device at capture; the unique index below is the no-duplicate guarantee. */
    localId: uuid("local_id").notNull(),
    storedObjectId: uuid("stored_object_id").notNull(),
    kind: fieldMediaKind("kind").notNull(),
    /** The device's clock at the shutter. A different fact from `created_at`. */
    capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" }).notNull(),
    note: text("note"),
    location: pointColumn("location"),
    locationAccuracyM: numeric("location_accuracy_m", { precision: 10, scale: 1 }),
    provenanceId: uuid("provenance_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("field_media_tenant_id_id_key").on(t.tenantId, t.id),
    // One photograph, however many times its device says so.
    unique("field_media_local_key").on(t.tenantId, t.visitId, t.localId),
    // One stored object backs exactly one media row: a second row over the same bytes would be
    // the duplicate `local_id` prevents, arriving by another door.
    unique("field_media_object_key").on(t.tenantId, t.storedObjectId),
    foreignKey({
      name: "field_media_visit_fk",
      columns: [t.tenantId, t.visitId],
      foreignColumns: [fieldVisit.tenantId, fieldVisit.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "field_media_assignment_fk",
      columns: [t.tenantId, t.assignmentId],
      foreignColumns: [fieldAssignment.tenantId, fieldAssignment.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "field_media_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [project.tenantId, project.id],
    }).onDelete("cascade"),
    // The bytes must exist and belong to this tenant. A media row pointing at nothing is the
    // orphan this table's docblock says there is no path to.
    foreignKey({
      name: "field_media_object_fk",
      columns: [t.tenantId, t.storedObjectId],
      foreignColumns: [storedObject.tenantId, storedObject.id],
    }),
    foreignKey({
      name: "field_media_provenance_fk",
      columns: [t.tenantId, t.provenanceId],
      foreignColumns: [provenanceRecord.tenantId, provenanceRecord.id],
    }),
    index("field_media_visit_idx").on(t.tenantId, t.visitId),
    index("field_media_technician_idx").on(t.tenantId, t.projectId, t.capturedByUserId),
  ],
);
