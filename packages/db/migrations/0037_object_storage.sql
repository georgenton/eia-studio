-- Object storage metadata (Production V1 Wave 2, ADR-031).
--
-- Two tables and two enums, generated from the schema. The bytes never come here: PostgreSQL holds
-- what the product knows *about* an object, and the row is the thing anything else may read — an
-- upload the client said succeeded is not.
--
-- Grants, row level security and the write-once rule are in 0038, which is hand-written because
-- policies are reviewed SQL (ADR-013).
CREATE TYPE "app"."storage_namespace" AS ENUM('documents', 'field-media');--> statement-breakpoint
CREATE TYPE "app"."upload_intent_state" AS ENUM('ISSUED', 'FINALIZED', 'ABANDONED');--> statement-breakpoint
CREATE TABLE "app"."stored_object" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"namespace" "app"."storage_namespace" NOT NULL,
	"object_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stored_object_object_key_key" UNIQUE("tenant_id","object_key"),
	CONSTRAINT "stored_object_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."upload_intent" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"namespace" "app"."storage_namespace" NOT NULL,
	"object_key" text NOT NULL,
	"declared_filename" text NOT NULL,
	"declared_mime_type" text NOT NULL,
	"declared_size_bytes" bigint NOT NULL,
	"max_bytes" bigint NOT NULL,
	"state" "app"."upload_intent_state" DEFAULT 'ISSUED' NOT NULL,
	"issued_by_user_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "upload_intent_object_key_key" UNIQUE("tenant_id","object_key"),
	CONSTRAINT "upload_intent_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "app"."stored_object" ADD CONSTRAINT "stored_object_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."stored_object" ADD CONSTRAINT "stored_object_user_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."upload_intent" ADD CONSTRAINT "upload_intent_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."upload_intent" ADD CONSTRAINT "upload_intent_user_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stored_object_project_namespace_idx" ON "app"."stored_object" USING btree ("tenant_id","project_id","namespace");--> statement-breakpoint
CREATE INDEX "stored_object_hash_idx" ON "app"."stored_object" USING btree ("tenant_id","project_id","sha256");--> statement-breakpoint
CREATE INDEX "upload_intent_project_state_idx" ON "app"."upload_intent" USING btree ("tenant_id","project_id","state");