CREATE TYPE "app"."classification_run_status" AS ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "app"."ai_classification_status" AS ENUM('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "app"."human_review_decision" AS ENUM('ACCEPTED', 'CORRECTED');--> statement-breakpoint
CREATE TYPE "app"."taxonomy_version_status" AS ENUM('DRAFT', 'PUBLISHED', 'RETIRED');--> statement-breakpoint
CREATE TABLE "app"."ai_classification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"answer_id" uuid NOT NULL,
	"status" "app"."ai_classification_status" DEFAULT 'PENDING' NOT NULL,
	"confidence" numeric(4, 3),
	"needs_review" boolean DEFAULT false NOT NULL,
	"model_id" text,
	"provider" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"latency_ms" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"error" text,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_classification_run_answer_key" UNIQUE("tenant_id","run_id","answer_id"),
	CONSTRAINT "ai_classification_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."ai_classification_category" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"classification_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "ai_classification_category_key" UNIQUE("tenant_id","classification_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "app"."classification_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"taxonomy_version_id" uuid NOT NULL,
	"source_survey_version_id" uuid NOT NULL,
	"source_question_id" uuid NOT NULL,
	"requested_model" text NOT NULL,
	"resolved_model" text,
	"provider" text,
	"classifier_kind" text NOT NULL,
	"prompt_version" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"status" "app"."classification_run_status" DEFAULT 'PENDING' NOT NULL,
	"initiated_by_user_id" uuid NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error" text,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classification_run_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."human_review" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"classification_id" uuid NOT NULL,
	"answer_id" uuid NOT NULL,
	"taxonomy_version_id" uuid NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"reviewer_membership_id" uuid NOT NULL,
	"decision" "app"."human_review_decision" NOT NULL,
	"review_started_at" timestamp with time zone,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "human_review_classification_key" UNIQUE("tenant_id","classification_id"),
	CONSTRAINT "human_review_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."human_review_category" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "human_review_category_key" UNIQUE("tenant_id","review_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "app"."taxonomy" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "taxonomy_project_key_key" UNIQUE("tenant_id","project_id","key"),
	CONSTRAINT "taxonomy_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."taxonomy_category" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"ordinal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "taxonomy_category_version_code_key" UNIQUE("tenant_id","version_id","code"),
	CONSTRAINT "taxonomy_category_version_ordinal_key" UNIQUE("tenant_id","version_id","ordinal"),
	CONSTRAINT "taxonomy_category_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."taxonomy_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"taxonomy_id" uuid NOT NULL,
	"version_label" text NOT NULL,
	"status" "app"."taxonomy_version_status" DEFAULT 'DRAFT' NOT NULL,
	"definition_hash" text,
	"source_note" text,
	"published_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "taxonomy_version_label_key" UNIQUE("tenant_id","taxonomy_id","version_label"),
	CONSTRAINT "taxonomy_version_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "app"."ai_classification" ADD CONSTRAINT "ai_classification_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "app"."classification_run"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_classification" ADD CONSTRAINT "ai_classification_answer_fk" FOREIGN KEY ("tenant_id","answer_id") REFERENCES "app"."survey_answer"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_classification" ADD CONSTRAINT "ai_classification_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_classification" ADD CONSTRAINT "ai_classification_provenance_fk" FOREIGN KEY ("tenant_id","provenance_id") REFERENCES "app"."provenance_record"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_classification_category" ADD CONSTRAINT "ai_classification_category_classification_fk" FOREIGN KEY ("tenant_id","classification_id") REFERENCES "app"."ai_classification"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_classification_category" ADD CONSTRAINT "ai_classification_category_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "app"."taxonomy_category"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."ai_classification_category" ADD CONSTRAINT "ai_classification_category_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."classification_run" ADD CONSTRAINT "classification_run_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."classification_run" ADD CONSTRAINT "classification_run_taxonomy_version_fk" FOREIGN KEY ("tenant_id","taxonomy_version_id") REFERENCES "app"."taxonomy_version"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."classification_run" ADD CONSTRAINT "classification_run_survey_version_fk" FOREIGN KEY ("tenant_id","source_survey_version_id") REFERENCES "app"."survey_version"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."classification_run" ADD CONSTRAINT "classification_run_question_fk" FOREIGN KEY ("tenant_id","source_question_id") REFERENCES "app"."survey_question"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."classification_run" ADD CONSTRAINT "classification_run_initiator_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."classification_run" ADD CONSTRAINT "classification_run_provenance_fk" FOREIGN KEY ("tenant_id","provenance_id") REFERENCES "app"."provenance_record"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."human_review" ADD CONSTRAINT "human_review_classification_fk" FOREIGN KEY ("tenant_id","classification_id") REFERENCES "app"."ai_classification"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."human_review" ADD CONSTRAINT "human_review_answer_fk" FOREIGN KEY ("tenant_id","answer_id") REFERENCES "app"."survey_answer"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."human_review" ADD CONSTRAINT "human_review_taxonomy_version_fk" FOREIGN KEY ("tenant_id","taxonomy_version_id") REFERENCES "app"."taxonomy_version"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."human_review" ADD CONSTRAINT "human_review_reviewer_fk" FOREIGN KEY ("tenant_id","reviewer_membership_id") REFERENCES "app"."project_membership"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."human_review" ADD CONSTRAINT "human_review_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."human_review" ADD CONSTRAINT "human_review_provenance_fk" FOREIGN KEY ("tenant_id","provenance_id") REFERENCES "app"."provenance_record"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."human_review_category" ADD CONSTRAINT "human_review_category_review_fk" FOREIGN KEY ("tenant_id","review_id") REFERENCES "app"."human_review"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."human_review_category" ADD CONSTRAINT "human_review_category_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "app"."taxonomy_category"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."human_review_category" ADD CONSTRAINT "human_review_category_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."taxonomy" ADD CONSTRAINT "taxonomy_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."taxonomy_category" ADD CONSTRAINT "taxonomy_category_version_fk" FOREIGN KEY ("tenant_id","version_id") REFERENCES "app"."taxonomy_version"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."taxonomy_category" ADD CONSTRAINT "taxonomy_category_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."taxonomy_version" ADD CONSTRAINT "taxonomy_version_taxonomy_fk" FOREIGN KEY ("tenant_id","taxonomy_id") REFERENCES "app"."taxonomy"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."taxonomy_version" ADD CONSTRAINT "taxonomy_version_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."taxonomy_version" ADD CONSTRAINT "taxonomy_version_provenance_fk" FOREIGN KEY ("tenant_id","provenance_id") REFERENCES "app"."provenance_record"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_classification_run_status_idx" ON "app"."ai_classification" USING btree ("tenant_id","run_id","status");--> statement-breakpoint
CREATE INDEX "ai_classification_answer_idx" ON "app"."ai_classification" USING btree ("tenant_id","answer_id");--> statement-breakpoint
CREATE INDEX "ai_classification_category_category_idx" ON "app"."ai_classification_category" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE INDEX "classification_run_project_status_idx" ON "app"."classification_run" USING btree ("tenant_id","project_id","status");--> statement-breakpoint
CREATE INDEX "human_review_project_idx" ON "app"."human_review" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "human_review_category_category_idx" ON "app"."human_review_category" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE INDEX "taxonomy_version_status_idx" ON "app"."taxonomy_version" USING btree ("tenant_id","taxonomy_id","status");