CREATE TYPE "app"."document_assertion_source_kind" AS ENUM('RECONSTRUCTED_CORPUS', 'DOCUMENT_VERSION');--> statement-breakpoint
CREATE TYPE "app"."quality_evidence_role" AS ENUM('SOURCE_A', 'SOURCE_B', 'CONTEXT');--> statement-breakpoint
CREATE TYPE "app"."quality_finding_decision" AS ENUM('START_REVIEW', 'ACCEPT', 'DISMISS', 'RESOLVE', 'REQUEST_INTERDISCIPLINARY', 'REOPEN');--> statement-breakpoint
CREATE TYPE "app"."quality_finding_severity" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "app"."quality_finding_state" AS ENUM('OPEN', 'UNDER_REVIEW', 'ACCEPTED', 'DISMISSED', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "app"."quality_finding_type" AS ENUM('NUMERICAL_MISMATCH', 'GEOGRAPHICAL_MISMATCH', 'TEMPORAL_MISMATCH', 'DOCUMENT_COMPLETENESS', 'CROSS_DOCUMENT_INCONSISTENCY', 'MISSING_EVIDENCE');--> statement-breakpoint
CREATE TYPE "app"."quality_run_status" AS ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "app"."quality_run_trigger" AS ENUM('MANUAL', 'SCHEDULED', 'EVENT');--> statement-breakpoint
CREATE TABLE "app"."document_assertion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"source_kind" "app"."document_assertion_source_kind" NOT NULL,
	"source_ref" text NOT NULL,
	"value_text" text,
	"value_number" numeric(18, 4),
	"value_date" text,
	"value_boolean" boolean,
	"quote" text,
	"qualifier" text,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_assertion_project_key_ref_key" UNIQUE("tenant_id","project_id","key","source_ref"),
	CONSTRAINT "document_assertion_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."finding_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"finding_id" uuid NOT NULL,
	"role" "app"."quality_evidence_role" NOT NULL,
	"locator" jsonb NOT NULL,
	"label" text NOT NULL,
	"quote" text NOT NULL,
	"ordinal" integer NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finding_evidence_ordinal_key" UNIQUE("tenant_id","finding_id","ordinal"),
	CONSTRAINT "finding_evidence_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."quality_finding" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"finding_code" text NOT NULL,
	"fingerprint" text NOT NULL,
	"first_run_id" uuid NOT NULL,
	"last_run_id" uuid NOT NULL,
	"requirement_key" text NOT NULL,
	"requirement_version" text NOT NULL,
	"type" "app"."quality_finding_type" NOT NULL,
	"severity" "app"."quality_finding_severity" NOT NULL,
	"state" "app"."quality_finding_state" DEFAULT 'OPEN' NOT NULL,
	"title" text NOT NULL,
	"explanation" text NOT NULL,
	"why_flagged" text NOT NULL,
	"suggested_action" text NOT NULL,
	"interdisciplinary_review_required" boolean DEFAULT false NOT NULL,
	"parcel_id" uuid,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quality_finding_fingerprint_key" UNIQUE("tenant_id","project_id","fingerprint"),
	CONSTRAINT "quality_finding_code_key" UNIQUE("tenant_id","project_id","finding_code"),
	CONSTRAINT "quality_finding_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."quality_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"trigger" "app"."quality_run_trigger" DEFAULT 'MANUAL' NOT NULL,
	"requirements" text[] NOT NULL,
	"status" "app"."quality_run_status" DEFAULT 'PENDING' NOT NULL,
	"findings_created" integer DEFAULT 0 NOT NULL,
	"findings_updated" integer DEFAULT 0 NOT NULL,
	"findings_reopened" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"initiated_by_user_id" uuid NOT NULL,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quality_run_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."specialist_review" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"finding_id" uuid NOT NULL,
	"decision" "app"."quality_finding_decision" NOT NULL,
	"from_state" "app"."quality_finding_state" NOT NULL,
	"to_state" "app"."quality_finding_state" NOT NULL,
	"justification" text NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "specialist_review_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "app"."document_assertion" ADD CONSTRAINT "document_assertion_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_assertion" ADD CONSTRAINT "document_assertion_provenance_fk" FOREIGN KEY ("tenant_id","provenance_id") REFERENCES "app"."provenance_record"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."finding_evidence" ADD CONSTRAINT "finding_evidence_finding_fk" FOREIGN KEY ("tenant_id","finding_id") REFERENCES "app"."quality_finding"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."finding_evidence" ADD CONSTRAINT "finding_evidence_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quality_finding" ADD CONSTRAINT "quality_finding_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quality_finding" ADD CONSTRAINT "quality_finding_first_run_fk" FOREIGN KEY ("tenant_id","first_run_id") REFERENCES "app"."quality_run"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quality_finding" ADD CONSTRAINT "quality_finding_last_run_fk" FOREIGN KEY ("tenant_id","last_run_id") REFERENCES "app"."quality_run"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quality_finding" ADD CONSTRAINT "quality_finding_parcel_fk" FOREIGN KEY ("tenant_id","parcel_id") REFERENCES "app"."parcel"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quality_finding" ADD CONSTRAINT "quality_finding_provenance_fk" FOREIGN KEY ("tenant_id","provenance_id") REFERENCES "app"."provenance_record"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quality_run" ADD CONSTRAINT "quality_run_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quality_run" ADD CONSTRAINT "quality_run_provenance_fk" FOREIGN KEY ("tenant_id","provenance_id") REFERENCES "app"."provenance_record"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quality_run" ADD CONSTRAINT "quality_run_user_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."specialist_review" ADD CONSTRAINT "specialist_review_finding_fk" FOREIGN KEY ("tenant_id","finding_id") REFERENCES "app"."quality_finding"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."specialist_review" ADD CONSTRAINT "specialist_review_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."specialist_review" ADD CONSTRAINT "specialist_review_user_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_assertion_key_idx" ON "app"."document_assertion" USING btree ("tenant_id","project_id","key");--> statement-breakpoint
CREATE INDEX "quality_finding_state_idx" ON "app"."quality_finding" USING btree ("tenant_id","project_id","state","severity");--> statement-breakpoint
CREATE INDEX "quality_finding_parcel_idx" ON "app"."quality_finding" USING btree ("tenant_id","project_id","parcel_id");--> statement-breakpoint
CREATE INDEX "quality_run_project_idx" ON "app"."quality_run" USING btree ("tenant_id","project_id","created_at");--> statement-breakpoint
CREATE INDEX "specialist_review_finding_idx" ON "app"."specialist_review" USING btree ("tenant_id","finding_id","reviewed_at");