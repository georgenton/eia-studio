CREATE SCHEMA "portal";
--> statement-breakpoint
CREATE TABLE "portal"."client_publication" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"published_by" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"content_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"source_provenance_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_publication_project_sequence_key" UNIQUE("tenant_id","project_id","sequence"),
	CONSTRAINT "client_publication_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "portal"."client_publication" ADD CONSTRAINT "client_publication_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal"."client_publication" ADD CONSTRAINT "client_publication_published_by_fk" FOREIGN KEY ("published_by") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;