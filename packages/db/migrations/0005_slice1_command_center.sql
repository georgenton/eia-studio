CREATE TYPE "app"."attention_severity" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "app"."metric_key" AS ENUM('corridor_length_km', 'universe_estimated', 'universe_confirmed', 'parcels_visited', 'surveys_complete', 'revisits_scheduled', 'parcels_pending', 'productivity_per_day', 'projected_close_date', 'consultation_participants');--> statement-breakpoint
CREATE TYPE "app"."provenance_granularity" AS ENUM('INDIVIDUAL', 'AGGREGATE');--> statement-breakpoint
CREATE TYPE "app"."provenance_origin" AS ENUM('FIELD_CAPTURE', 'IMPORTED_DOCUMENT', 'IMPORTED_DATASET', 'SYSTEM_GENERATED');--> statement-breakpoint
CREATE TYPE "app"."provenance_regime" AS ENUM('HISTORICAL_OBSERVED', 'LIVE_OPERATIONAL', 'DEMO_SIMULATION');--> statement-breakpoint
CREATE TYPE "app"."provenance_transformation" AS ENUM('ORIGINAL', 'RECONSTRUCTED', 'DERIVED', 'ANONYMIZED');--> statement-breakpoint
CREATE TYPE "app"."provenance_validation" AS ENUM('VALIDATED', 'PARTIAL', 'PENDING', 'NOT_REQUIRED', 'SPECIALIST_REQUIRED');--> statement-breakpoint
CREATE TABLE "app"."activity_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_label" text NOT NULL,
	"action" text NOT NULL,
	"object_label" text,
	"provenance_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."attention_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"severity" "app"."attention_severity" NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"surface_label" text NOT NULL,
	"surface_key" text,
	"action_label" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"provenance_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."forecast_snapshot" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"algorithm_version" text NOT NULL,
	"pending" integer NOT NULL,
	"daily_completions" integer[] NOT NULL,
	"window_days" integer NOT NULL,
	"moving_average_per_day" numeric(8, 2) NOT NULL,
	"required_rate_per_day" numeric(8, 2),
	"active_technicians" integer NOT NULL,
	"assigned_technicians" integer NOT NULL,
	"target_date" date NOT NULL,
	"projected_close_date" date NOT NULL,
	"delay_days" integer NOT NULL,
	"assumptions" text[] NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provenance_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."metric_snapshot" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"key" "app"."metric_key" NOT NULL,
	"numeric_value" numeric(12, 2),
	"date_value" date,
	"note" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provenance_id" uuid NOT NULL,
	CONSTRAINT "metric_snapshot_project_key_key" UNIQUE("tenant_id","project_id","key")
);
--> statement-breakpoint
CREATE TABLE "app"."provenance_input" (
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"provenance_id" uuid NOT NULL,
	"input_provenance_id" uuid NOT NULL,
	CONSTRAINT "provenance_input_pkey" PRIMARY KEY("provenance_id","input_provenance_id")
);
--> statement-breakpoint
CREATE TABLE "app"."provenance_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"regime" "app"."provenance_regime" NOT NULL,
	"origin" "app"."provenance_origin" NOT NULL,
	"transformations" "app"."provenance_transformation"[] NOT NULL,
	"granularity" "app"."provenance_granularity",
	"title" text NOT NULL,
	"note" text NOT NULL,
	"source_label" text,
	"source_reference" text,
	"source_version" text,
	"method" text,
	"captured_at" timestamp with time zone,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"validation_state" "app"."provenance_validation" NOT NULL,
	"validation_note" text,
	CONSTRAINT "provenance_record_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "app"."project" ADD COLUMN "location_label" text;--> statement-breakpoint
ALTER TABLE "app"."activity_event" ADD CONSTRAINT "activity_event_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."activity_event" ADD CONSTRAINT "activity_event_provenance_fk" FOREIGN KEY ("tenant_id","provenance_id") REFERENCES "app"."provenance_record"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."attention_item" ADD CONSTRAINT "attention_item_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."attention_item" ADD CONSTRAINT "attention_item_provenance_fk" FOREIGN KEY ("tenant_id","provenance_id") REFERENCES "app"."provenance_record"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."forecast_snapshot" ADD CONSTRAINT "forecast_snapshot_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."forecast_snapshot" ADD CONSTRAINT "forecast_snapshot_provenance_fk" FOREIGN KEY ("tenant_id","provenance_id") REFERENCES "app"."provenance_record"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."metric_snapshot" ADD CONSTRAINT "metric_snapshot_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."metric_snapshot" ADD CONSTRAINT "metric_snapshot_provenance_fk" FOREIGN KEY ("tenant_id","provenance_id") REFERENCES "app"."provenance_record"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provenance_input" ADD CONSTRAINT "provenance_input_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provenance_input" ADD CONSTRAINT "provenance_input_record_fk" FOREIGN KEY ("tenant_id","provenance_id") REFERENCES "app"."provenance_record"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provenance_input" ADD CONSTRAINT "provenance_input_source_fk" FOREIGN KEY ("tenant_id","input_provenance_id") REFERENCES "app"."provenance_record"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provenance_record" ADD CONSTRAINT "provenance_record_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_event_project_idx" ON "app"."activity_event" USING btree ("tenant_id","project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "attention_item_project_idx" ON "app"."attention_item" USING btree ("tenant_id","project_id","display_order");--> statement-breakpoint
CREATE INDEX "forecast_snapshot_project_idx" ON "app"."forecast_snapshot" USING btree ("tenant_id","project_id","calculated_at");--> statement-breakpoint
CREATE INDEX "provenance_record_project_idx" ON "app"."provenance_record" USING btree ("tenant_id","project_id");