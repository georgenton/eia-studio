CREATE TYPE "app"."field_assignment_status" AS ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "app"."survey_campaign_status" AS ENUM('DRAFT', 'ACTIVE', 'CLOSED');--> statement-breakpoint
CREATE TYPE "app"."field_capture_channel" AS ENUM('NATIVE_WEB');--> statement-breakpoint
CREATE TYPE "app"."survey_instance_status" AS ENUM('IN_PROGRESS', 'SUBMITTED');--> statement-breakpoint
CREATE TYPE "app"."field_location_outcome" AS ENUM('captured', 'denied', 'unavailable', 'not_attempted');--> statement-breakpoint
CREATE TYPE "app"."survey_question_sensitivity" AS ENUM('NON_PERSONAL', 'PERSONAL', 'SENSITIVE');--> statement-breakpoint
CREATE TYPE "app"."survey_question_type" AS ENUM('SHORT_TEXT', 'LONG_TEXT', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'DATE');--> statement-breakpoint
CREATE TYPE "app"."survey_version_status" AS ENUM('DRAFT', 'PUBLISHED', 'RETIRED');--> statement-breakpoint
CREATE TYPE "app"."field_visit_status" AS ENUM('IN_PROGRESS', 'COMPLETED');--> statement-breakpoint
CREATE TABLE "app"."field_assignment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"parcel_id" uuid NOT NULL,
	"assignee_membership_id" uuid NOT NULL,
	"assignee_user_id" uuid NOT NULL,
	"status" "app"."field_assignment_status" DEFAULT 'PENDING' NOT NULL,
	"note" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_assignment_campaign_parcel_key" UNIQUE("tenant_id","campaign_id","parcel_id"),
	CONSTRAINT "field_assignment_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."field_visit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"technician_user_id" uuid NOT NULL,
	"status" "app"."field_visit_status" DEFAULT 'IN_PROGRESS' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"location" geometry(Point,4326),
	"location_accuracy_m" numeric(10, 1),
	"location_captured_at" timestamp with time zone,
	"location_outcome" "app"."field_location_outcome" DEFAULT 'not_attempted' NOT NULL,
	"note" text,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_visit_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."project_configuration" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_configuration_project_key_key" UNIQUE("tenant_id","project_id","key")
);
--> statement-breakpoint
CREATE TABLE "app"."survey_answer" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"text_value" text,
	"number_value" numeric(18, 6),
	"boolean_value" boolean,
	"date_value" date,
	"option_id" uuid,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_answer_instance_question_key" UNIQUE("tenant_id","instance_id","question_id"),
	CONSTRAINT "survey_answer_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."survey_answer_option" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"answer_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	CONSTRAINT "survey_answer_option_answer_option_key" UNIQUE("tenant_id","answer_id","option_id")
);
--> statement-breakpoint
CREATE TABLE "app"."survey_campaign" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"survey_version_id" uuid NOT NULL,
	"status" "app"."survey_campaign_status" DEFAULT 'DRAFT' NOT NULL,
	"capture_channel" "app"."field_capture_channel" DEFAULT 'NATIVE_WEB' NOT NULL,
	"offline_mode_at_activation" text,
	"starts_on" date,
	"target_on" date,
	"activated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by" uuid,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_campaign_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."survey_instance" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"visit_id" uuid,
	"survey_version_id" uuid NOT NULL,
	"respondent_user_id" uuid NOT NULL,
	"status" "app"."survey_instance_status" DEFAULT 'IN_PROGRESS' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_instance_assignment_version_key" UNIQUE("tenant_id","assignment_id","survey_version_id"),
	CONSTRAINT "survey_instance_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."survey_option" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"ordinal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_option_question_code_key" UNIQUE("tenant_id","question_id","code"),
	CONSTRAINT "survey_option_question_ordinal_key" UNIQUE("tenant_id","question_id","ordinal"),
	CONSTRAINT "survey_option_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."survey_question" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"code" text NOT NULL,
	"ordinal" integer NOT NULL,
	"type" "app"."survey_question_type" NOT NULL,
	"prompt" text NOT NULL,
	"help_text" text,
	"required" boolean DEFAULT false NOT NULL,
	"sensitivity" "app"."survey_question_sensitivity" DEFAULT 'NON_PERSONAL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_question_version_code_key" UNIQUE("tenant_id","version_id","code"),
	CONSTRAINT "survey_question_version_ordinal_key" UNIQUE("tenant_id","version_id","ordinal"),
	CONSTRAINT "survey_question_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."survey_template" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_template_project_key_key" UNIQUE("tenant_id","project_id","key"),
	CONSTRAINT "survey_template_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."survey_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version_label" text NOT NULL,
	"status" "app"."survey_version_status" DEFAULT 'DRAFT' NOT NULL,
	"definition_hash" text,
	"published_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_version_template_label_key" UNIQUE("tenant_id","template_id","version_label"),
	CONSTRAINT "survey_version_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "app"."field_assignment" ADD CONSTRAINT "field_assignment_campaign_fk" FOREIGN KEY ("tenant_id","campaign_id") REFERENCES "app"."survey_campaign"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."field_assignment" ADD CONSTRAINT "field_assignment_parcel_fk" FOREIGN KEY ("tenant_id","parcel_id") REFERENCES "app"."parcel"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Moved ahead of the foreign keys that reference it: drizzle emitted this unique key after
-- them, and a composite FK cannot be created before the key it points at exists.
ALTER TABLE "app"."project_membership" ADD CONSTRAINT "project_membership_tenant_id_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "app"."field_assignment" ADD CONSTRAINT "field_assignment_assignee_fk" FOREIGN KEY ("tenant_id","assignee_membership_id") REFERENCES "app"."project_membership"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."field_assignment" ADD CONSTRAINT "field_assignment_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."field_visit" ADD CONSTRAINT "field_visit_assignment_fk" FOREIGN KEY ("tenant_id","assignment_id") REFERENCES "app"."field_assignment"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."field_visit" ADD CONSTRAINT "field_visit_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."project_configuration" ADD CONSTRAINT "project_configuration_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_answer" ADD CONSTRAINT "survey_answer_instance_fk" FOREIGN KEY ("tenant_id","instance_id") REFERENCES "app"."survey_instance"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_answer" ADD CONSTRAINT "survey_answer_question_fk" FOREIGN KEY ("tenant_id","question_id") REFERENCES "app"."survey_question"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_answer" ADD CONSTRAINT "survey_answer_option_fk" FOREIGN KEY ("tenant_id","option_id") REFERENCES "app"."survey_option"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_answer" ADD CONSTRAINT "survey_answer_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_answer_option" ADD CONSTRAINT "survey_answer_option_answer_fk" FOREIGN KEY ("tenant_id","answer_id") REFERENCES "app"."survey_answer"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_answer_option" ADD CONSTRAINT "survey_answer_option_option_fk" FOREIGN KEY ("tenant_id","option_id") REFERENCES "app"."survey_option"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_answer_option" ADD CONSTRAINT "survey_answer_option_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_campaign" ADD CONSTRAINT "survey_campaign_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_campaign" ADD CONSTRAINT "survey_campaign_version_fk" FOREIGN KEY ("tenant_id","survey_version_id") REFERENCES "app"."survey_version"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_instance" ADD CONSTRAINT "survey_instance_assignment_fk" FOREIGN KEY ("tenant_id","assignment_id") REFERENCES "app"."field_assignment"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_instance" ADD CONSTRAINT "survey_instance_visit_fk" FOREIGN KEY ("tenant_id","visit_id") REFERENCES "app"."field_visit"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_instance" ADD CONSTRAINT "survey_instance_version_fk" FOREIGN KEY ("tenant_id","survey_version_id") REFERENCES "app"."survey_version"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_instance" ADD CONSTRAINT "survey_instance_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_option" ADD CONSTRAINT "survey_option_question_fk" FOREIGN KEY ("tenant_id","question_id") REFERENCES "app"."survey_question"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_option" ADD CONSTRAINT "survey_option_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_question" ADD CONSTRAINT "survey_question_version_fk" FOREIGN KEY ("tenant_id","version_id") REFERENCES "app"."survey_version"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_question" ADD CONSTRAINT "survey_question_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_template" ADD CONSTRAINT "survey_template_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_version" ADD CONSTRAINT "survey_version_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "app"."survey_template"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_version" ADD CONSTRAINT "survey_version_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "field_assignment_assignee_idx" ON "app"."field_assignment" USING btree ("tenant_id","project_id","assignee_user_id");--> statement-breakpoint
CREATE INDEX "field_assignment_campaign_status_idx" ON "app"."field_assignment" USING btree ("tenant_id","campaign_id","status");--> statement-breakpoint
CREATE INDEX "field_visit_assignment_idx" ON "app"."field_visit" USING btree ("tenant_id","assignment_id");--> statement-breakpoint
CREATE INDEX "field_visit_technician_idx" ON "app"."field_visit" USING btree ("tenant_id","project_id","technician_user_id");--> statement-breakpoint
CREATE INDEX "survey_answer_question_idx" ON "app"."survey_answer" USING btree ("tenant_id","question_id");--> statement-breakpoint
CREATE INDEX "survey_answer_option_option_idx" ON "app"."survey_answer_option" USING btree ("tenant_id","option_id");--> statement-breakpoint
CREATE INDEX "survey_campaign_project_status_idx" ON "app"."survey_campaign" USING btree ("tenant_id","project_id","status");--> statement-breakpoint
CREATE INDEX "survey_instance_respondent_idx" ON "app"."survey_instance" USING btree ("tenant_id","project_id","respondent_user_id");--> statement-breakpoint
CREATE INDEX "survey_instance_version_status_idx" ON "app"."survey_instance" USING btree ("tenant_id","survey_version_id","status");--> statement-breakpoint
CREATE INDEX "survey_version_template_status_idx" ON "app"."survey_version" USING btree ("tenant_id","template_id","status");--> statement-breakpoint
