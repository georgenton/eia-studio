CREATE TYPE "app"."generated_report_kind" AS ENUM('social_chapter');--> statement-breakpoint
CREATE TYPE "app"."report_source_kind" AS ENUM('metric', 'human_review', 'quality_finding', 'document_chunk', 'provenance');--> statement-breakpoint
CREATE TYPE "app"."report_version_status" AS ENUM('DRAFT');--> statement-breakpoint
CREATE TABLE "app"."generated_report" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "app"."generated_report_kind" NOT NULL,
	"title" text NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generated_report_project_kind_key" UNIQUE("tenant_id","project_id","kind"),
	CONSTRAINT "generated_report_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."report_section" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"ordinal" integer NOT NULL,
	"summary" text NOT NULL,
	"narrative" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_section_version_key" UNIQUE("tenant_id","version_id","key"),
	CONSTRAINT "report_section_version_ordinal_key" UNIQUE("tenant_id","version_id","ordinal"),
	CONSTRAINT "report_section_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."report_section_source" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"kind" "app"."report_source_kind" NOT NULL,
	"fact_key" text NOT NULL,
	"locator" jsonb NOT NULL,
	"ordinal" integer NOT NULL,
	CONSTRAINT "report_section_source_ordinal_key" UNIQUE("tenant_id","section_id","ordinal"),
	CONSTRAINT "report_section_source_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."report_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"version_label" text NOT NULL,
	"status" "app"."report_version_status" DEFAULT 'DRAFT' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_digest" text NOT NULL,
	"survey_version_label" text NOT NULL,
	"narrative_model" text,
	"narrative_prompt_version" text,
	"generated_by_user_id" uuid NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_version_label_key" UNIQUE("tenant_id","report_id","version_label"),
	CONSTRAINT "report_version_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "app"."generated_report" ADD CONSTRAINT "generated_report_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."report_section" ADD CONSTRAINT "report_section_version_fk" FOREIGN KEY ("tenant_id","version_id") REFERENCES "app"."report_version"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."report_section" ADD CONSTRAINT "report_section_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."report_section_source" ADD CONSTRAINT "report_section_source_section_fk" FOREIGN KEY ("tenant_id","section_id") REFERENCES "app"."report_section"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."report_section_source" ADD CONSTRAINT "report_section_source_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."report_version" ADD CONSTRAINT "report_version_report_fk" FOREIGN KEY ("tenant_id","report_id") REFERENCES "app"."generated_report"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."report_version" ADD CONSTRAINT "report_version_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."report_version" ADD CONSTRAINT "report_version_provenance_fk" FOREIGN KEY ("tenant_id","provenance_id") REFERENCES "app"."provenance_record"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."report_version" ADD CONSTRAINT "report_version_user_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_section_source_kind_idx" ON "app"."report_section_source" USING btree ("tenant_id","project_id","kind");--> statement-breakpoint
CREATE INDEX "report_version_report_idx" ON "app"."report_version" USING btree ("tenant_id","report_id","generated_at");