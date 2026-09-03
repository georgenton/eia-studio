CREATE TYPE "app"."source_document_kind" AS ENUM('report', 'annex', 'minutes', 'plan', 'legal', 'other');--> statement-breakpoint
CREATE TYPE "app"."document_text_source" AS ENUM('RECONSTRUCTED_EXCERPT', 'PLAIN_TEXT', 'PDF_TEXT');--> statement-breakpoint
CREATE TABLE "app"."document_chunk" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"page_from" integer NOT NULL,
	"page_to" integer NOT NULL,
	"char_from" integer NOT NULL,
	"char_to" integer NOT NULL,
	"text" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_chunk_version_ordinal_key" UNIQUE("tenant_id","version_id","ordinal"),
	CONSTRAINT "document_chunk_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."document_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_label" text NOT NULL,
	"text_source" "app"."document_text_source" NOT NULL,
	"source_note" text NOT NULL,
	"content_hash" text NOT NULL,
	"page_count" integer NOT NULL,
	"chunk_count" integer NOT NULL,
	"chunking_strategy" text NOT NULL,
	"storage_key" text,
	"imported_by_user_id" uuid,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_version_label_key" UNIQUE("tenant_id","document_id","version_label"),
	CONSTRAINT "document_version_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."source_document" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"kind" "app"."source_document_kind" NOT NULL,
	"contains_pii" boolean DEFAULT false NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_document_project_code_key" UNIQUE("tenant_id","project_id","code"),
	CONSTRAINT "source_document_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "app"."document_assertion" ADD COLUMN "document_version_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."document_assertion" ADD COLUMN "chunk_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."document_chunk" ADD CONSTRAINT "document_chunk_version_fk" FOREIGN KEY ("tenant_id","version_id") REFERENCES "app"."document_version"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_chunk" ADD CONSTRAINT "document_chunk_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_version" ADD CONSTRAINT "document_version_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "app"."source_document"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_version" ADD CONSTRAINT "document_version_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_version" ADD CONSTRAINT "document_version_provenance_fk" FOREIGN KEY ("tenant_id","provenance_id") REFERENCES "app"."provenance_record"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."document_version" ADD CONSTRAINT "document_version_user_fk" FOREIGN KEY ("imported_by_user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."source_document" ADD CONSTRAINT "source_document_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_chunk_version_idx" ON "app"."document_chunk" USING btree ("tenant_id","version_id","ordinal");--> statement-breakpoint
CREATE INDEX "document_version_document_idx" ON "app"."document_version" USING btree ("tenant_id","document_id","imported_at");