CREATE TYPE "app"."report_template_kind" AS ENUM('cover', 'chapter', 'annex');--> statement-breakpoint
CREATE TYPE "app"."report_template_locale" AS ENUM('es-EC', 'en');--> statement-breakpoint
CREATE TYPE "app"."report_template_version_state" AS ENUM('UPLOADED', 'VALIDATED', 'ACTIVE', 'SUPERSEDED');--> statement-breakpoint
ALTER TYPE "app"."storage_namespace" ADD VALUE 'templates';--> statement-breakpoint
ALTER TYPE "app"."storage_namespace" ADD VALUE 'generated';--> statement-breakpoint
CREATE TABLE "app"."generated_document" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"template_version_id" uuid NOT NULL,
	"report_version_id" uuid,
	"snapshot_digest" text,
	"locale" "app"."report_template_locale" NOT NULL,
	"stored_object_id" uuid NOT NULL,
	"file_sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"declared_absent" text[] DEFAULT '{}' NOT NULL,
	"narrative_model" text,
	"narrative_prompt_version" text,
	"generated_by_user_id" uuid NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generated_document_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "generated_document_object_key" UNIQUE("tenant_id","stored_object_id")
);
--> statement-breakpoint
CREATE TABLE "app"."report_template" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "app"."report_template_kind" NOT NULL,
	"purpose" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_template_project_code_key" UNIQUE("tenant_id","project_id","code"),
	CONSTRAINT "report_template_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."report_template_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version_label" text NOT NULL,
	"locale" "app"."report_template_locale" NOT NULL,
	"state" "app"."report_template_version_state" DEFAULT 'UPLOADED' NOT NULL,
	"stored_object_id" uuid NOT NULL,
	"file_sha256" text NOT NULL,
	"original_filename" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"manifest" jsonb,
	"validated_at" timestamp with time zone,
	"validation_error" text,
	"activated_at" timestamp with time zone,
	"activated_by_user_id" uuid,
	"uploaded_by_user_id" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_template_version_label_key" UNIQUE("tenant_id","template_id","locale","version_label"),
	CONSTRAINT "report_template_version_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "report_template_version_object_key" UNIQUE("tenant_id","stored_object_id")
);
--> statement-breakpoint
ALTER TABLE "app"."generated_document" ADD CONSTRAINT "generated_document_template_version_fk" FOREIGN KEY ("tenant_id","template_version_id") REFERENCES "app"."report_template_version"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."generated_document" ADD CONSTRAINT "generated_document_report_version_fk" FOREIGN KEY ("tenant_id","report_version_id") REFERENCES "app"."report_version"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."generated_document" ADD CONSTRAINT "generated_document_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."generated_document" ADD CONSTRAINT "generated_document_object_fk" FOREIGN KEY ("tenant_id","stored_object_id") REFERENCES "app"."stored_object"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."generated_document" ADD CONSTRAINT "generated_document_provenance_fk" FOREIGN KEY ("tenant_id","provenance_id") REFERENCES "app"."provenance_record"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."generated_document" ADD CONSTRAINT "generated_document_user_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."report_template" ADD CONSTRAINT "report_template_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."report_template" ADD CONSTRAINT "report_template_user_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."report_template_version" ADD CONSTRAINT "report_template_version_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "app"."report_template"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."report_template_version" ADD CONSTRAINT "report_template_version_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."report_template_version" ADD CONSTRAINT "report_template_version_object_fk" FOREIGN KEY ("tenant_id","stored_object_id") REFERENCES "app"."stored_object"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."report_template_version" ADD CONSTRAINT "report_template_version_provenance_fk" FOREIGN KEY ("tenant_id","provenance_id") REFERENCES "app"."provenance_record"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."report_template_version" ADD CONSTRAINT "report_template_version_uploaded_by_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."report_template_version" ADD CONSTRAINT "report_template_version_activated_by_fk" FOREIGN KEY ("activated_by_user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generated_document_project_idx" ON "app"."generated_document" USING btree ("tenant_id","project_id","generated_at");--> statement-breakpoint
CREATE INDEX "report_template_version_hash_idx" ON "app"."report_template_version" USING btree ("tenant_id","template_id","file_sha256");--> statement-breakpoint
CREATE INDEX "report_template_version_state_idx" ON "app"."report_template_version" USING btree ("tenant_id","project_id","state");