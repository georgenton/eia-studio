import {
  boolean,
  customType,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { app, project, projectMembership, provenanceRecord } from "./app";
import { parcel } from "./gis";

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

export const captureChannel = app.enum("field_capture_channel", ["NATIVE_WEB"]);

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
    /** One live assignment per parcel per campaign; re-assignment moves the row, not a new one. */
    unique("field_assignment_campaign_parcel_key").on(t.tenantId, t.campaignId, t.parcelId),
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
