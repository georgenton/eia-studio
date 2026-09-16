CREATE TYPE "app"."field_sync_outcome" AS ENUM('applied', 'duplicate', 'superseded', 'conflict', 'rejected');--> statement-breakpoint
CREATE TYPE "app"."field_sync_command_type" AS ENUM('visit.start', 'survey.upsert_draft', 'survey.submit', 'visit.finish');--> statement-breakpoint
CREATE TABLE "app"."field_sync_receipt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"command_type" "app"."field_sync_command_type" NOT NULL,
	"outcome" "app"."field_sync_outcome" NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" uuid,
	"device_revision" integer DEFAULT 0 NOT NULL,
	"result" jsonb NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_sync_receipt_command_key" UNIQUE("tenant_id","project_id","command_id")
);
--> statement-breakpoint
ALTER TABLE "app"."field_sync_receipt" ADD CONSTRAINT "field_sync_receipt_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "field_sync_receipt_entity_idx" ON "app"."field_sync_receipt" USING btree ("tenant_id","project_id","user_id","entity_id");