CREATE TYPE "app"."survey_correction_state" AS ENUM('REQUESTED', 'APPLIED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "app"."survey_correction" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"original_instance_id" uuid NOT NULL,
	"correction_assignment_id" uuid NOT NULL,
	"correcting_instance_id" uuid,
	"state" "app"."survey_correction_state" DEFAULT 'REQUESTED' NOT NULL,
	"reason" text NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_correction_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "survey_correction_assignment_key" UNIQUE("tenant_id","correction_assignment_id")
);
--> statement-breakpoint
ALTER TABLE "app"."field_assignment" DROP CONSTRAINT "field_assignment_campaign_parcel_key";--> statement-breakpoint
ALTER TABLE "app"."field_assignment" ADD COLUMN "corrects_assignment_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."survey_correction" ADD CONSTRAINT "survey_correction_original_fk" FOREIGN KEY ("tenant_id","original_instance_id") REFERENCES "app"."survey_instance"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_correction" ADD CONSTRAINT "survey_correction_correcting_fk" FOREIGN KEY ("tenant_id","correcting_instance_id") REFERENCES "app"."survey_instance"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_correction" ADD CONSTRAINT "survey_correction_assignment_fk" FOREIGN KEY ("tenant_id","correction_assignment_id") REFERENCES "app"."field_assignment"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_correction" ADD CONSTRAINT "survey_correction_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "survey_correction_original_idx" ON "app"."survey_correction" USING btree ("tenant_id","original_instance_id");--> statement-breakpoint
CREATE INDEX "survey_correction_state_idx" ON "app"."survey_correction" USING btree ("tenant_id","project_id","state");--> statement-breakpoint
ALTER TABLE "app"."field_assignment" ADD CONSTRAINT "field_assignment_corrects_fk" FOREIGN KEY ("tenant_id","corrects_assignment_id") REFERENCES "app"."field_assignment"("tenant_id","id") ON DELETE no action ON UPDATE no action;