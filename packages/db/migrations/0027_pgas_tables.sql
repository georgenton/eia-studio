CREATE TABLE "app"."pgas_import_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"source_file" text NOT NULL,
	"source_sha256" text NOT NULL,
	"plan_count" integer NOT NULL,
	"measure_count" integer NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"supersedes_run_id" uuid,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pgas_import_run_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."pgas_measure" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"measure_code" text NOT NULL,
	"stated_number" text,
	"programme_title" text,
	"programme_ordinal" integer DEFAULT 0 NOT NULL,
	"aspect" text,
	"impact" text,
	"measure" text,
	"indicator" text,
	"verification" text,
	"responsible" text,
	"frequency" text,
	"deadline" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pgas_measure_plan_ordinal_key" UNIQUE("tenant_id","plan_id","ordinal"),
	CONSTRAINT "pgas_measure_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."pgas_plan" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"import_run_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"code" text,
	"title" text NOT NULL,
	"objective" text,
	"place" text,
	"column_headings" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pgas_plan_run_ordinal_key" UNIQUE("tenant_id","import_run_id","ordinal"),
	CONSTRAINT "pgas_plan_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "app"."pgas_import_run" ADD CONSTRAINT "pgas_import_run_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pgas_import_run" ADD CONSTRAINT "pgas_import_run_provenance_fk" FOREIGN KEY ("tenant_id","provenance_id") REFERENCES "app"."provenance_record"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pgas_import_run" ADD CONSTRAINT "pgas_import_run_supersedes_fk" FOREIGN KEY ("tenant_id","supersedes_run_id") REFERENCES "app"."pgas_import_run"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pgas_measure" ADD CONSTRAINT "pgas_measure_plan_fk" FOREIGN KEY ("tenant_id","plan_id") REFERENCES "app"."pgas_plan"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pgas_measure" ADD CONSTRAINT "pgas_measure_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pgas_plan" ADD CONSTRAINT "pgas_plan_run_fk" FOREIGN KEY ("tenant_id","import_run_id") REFERENCES "app"."pgas_import_run"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."pgas_plan" ADD CONSTRAINT "pgas_plan_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pgas_import_run_active_idx" ON "app"."pgas_import_run" USING btree ("tenant_id","project_id","is_active");--> statement-breakpoint
CREATE INDEX "pgas_measure_project_idx" ON "app"."pgas_measure" USING btree ("tenant_id","project_id","programme_ordinal","ordinal");