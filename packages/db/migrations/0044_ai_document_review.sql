CREATE TYPE "app"."document_review_candidate_decision" AS ENUM('ACCEPT', 'DISMISS', 'REOPEN');--> statement-breakpoint
CREATE TYPE "app"."document_review_candidate_state" AS ENUM('PROPOSED', 'ACCEPTED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "app"."document_review_evidence_role" AS ENUM('SOURCE_A', 'SOURCE_B', 'CONTEXT');--> statement-breakpoint
CREATE TYPE "app"."document_review_lens" AS ENUM('numerical_consistency', 'dates_chronology', 'project_identity', 'locations_institutions', 'social_conclusions_support', 'management_plan_application_area', 'general_cross_document');--> statement-breakpoint
CREATE TYPE "app"."document_review_run_status" AS ENUM('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "app"."document_review_support" AS ENUM('TWO_SIDED', 'SINGLE_SOURCE');--> statement-breakpoint
CREATE TABLE "app"."document_review_candidate" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"candidate_code" text NOT NULL,
	"lens" "app"."document_review_lens" NOT NULL,
	"support" "app"."document_review_support" NOT NULL,
	"state" "app"."document_review_candidate_state" DEFAULT 'PROPOSED' NOT NULL,
	"title" text NOT NULL,
	"observation" text NOT NULL,
	"suggested_check" text NOT NULL,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_review_candidate_code_key" UNIQUE("tenant_id","project_id","candidate_code"),
	CONSTRAINT "document_review_candidate_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."document_review_decision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"decision" "app"."document_review_candidate_decision" NOT NULL,
	"from_state" "app"."document_review_candidate_state" NOT NULL,
	"to_state" "app"."document_review_candidate_state" NOT NULL,
	"justification" text NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_review_decision_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."document_review_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"role" "app"."document_review_evidence_role" NOT NULL,
	"ordinal" integer NOT NULL,
	"chunk_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"label" text NOT NULL,
	"quote" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_review_evidence_ordinal_key" UNIQUE("tenant_id","candidate_id","ordinal"),
	CONSTRAINT "document_review_evidence_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."document_review_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"lens" "app"."document_review_lens" NOT NULL,
	"lens_ref" text NOT NULL,
	"status" "app"."document_review_run_status" DEFAULT 'QUEUED' NOT NULL,
	"adapter_kind" text NOT NULL,
	"requested_model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"passage_count" integer DEFAULT 0 NOT NULL,
	"candidates_created" integer DEFAULT 0 NOT NULL,
	"candidates_refused" integer DEFAULT 0 NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"initiated_by_user_id" uuid NOT NULL,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_review_run_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."document_review_source" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"privacy_classification_at_run" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_review_source_run_version_key" UNIQUE("tenant_id","run_id","document_version_id"),
	CONSTRAINT "document_review_source_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "app"."document_review_candidate" ADD CONSTRAINT "document_review_candidate_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "app"."document_review_run"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_review_candidate" ADD CONSTRAINT "document_review_candidate_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_review_candidate" ADD CONSTRAINT "document_review_candidate_provenance_fk" FOREIGN KEY ("tenant_id","provenance_id") REFERENCES "app"."provenance_record"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_review_decision" ADD CONSTRAINT "document_review_decision_candidate_fk" FOREIGN KEY ("tenant_id","candidate_id") REFERENCES "app"."document_review_candidate"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_review_decision" ADD CONSTRAINT "document_review_decision_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_review_decision" ADD CONSTRAINT "document_review_decision_user_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_review_evidence" ADD CONSTRAINT "document_review_evidence_candidate_fk" FOREIGN KEY ("tenant_id","candidate_id") REFERENCES "app"."document_review_candidate"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_review_evidence" ADD CONSTRAINT "document_review_evidence_chunk_fk" FOREIGN KEY ("tenant_id","chunk_id") REFERENCES "app"."document_chunk"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_review_evidence" ADD CONSTRAINT "document_review_evidence_version_fk" FOREIGN KEY ("tenant_id","document_version_id") REFERENCES "app"."document_version"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_review_evidence" ADD CONSTRAINT "document_review_evidence_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_review_run" ADD CONSTRAINT "document_review_run_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_review_run" ADD CONSTRAINT "document_review_run_provenance_fk" FOREIGN KEY ("tenant_id","provenance_id") REFERENCES "app"."provenance_record"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_review_run" ADD CONSTRAINT "document_review_run_user_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_review_source" ADD CONSTRAINT "document_review_source_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "app"."document_review_run"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_review_source" ADD CONSTRAINT "document_review_source_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "app"."source_document"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_review_source" ADD CONSTRAINT "document_review_source_version_fk" FOREIGN KEY ("tenant_id","document_version_id") REFERENCES "app"."document_version"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_review_source" ADD CONSTRAINT "document_review_source_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_review_candidate_state_idx" ON "app"."document_review_candidate" USING btree ("tenant_id","project_id","state");--> statement-breakpoint
CREATE INDEX "document_review_decision_candidate_idx" ON "app"."document_review_decision" USING btree ("tenant_id","candidate_id","decided_at");--> statement-breakpoint
CREATE INDEX "document_review_run_project_idx" ON "app"."document_review_run" USING btree ("tenant_id","project_id","created_at");--> statement-breakpoint
CREATE INDEX "document_review_run_queue_idx" ON "app"."document_review_run" USING btree ("status","claimed_at");