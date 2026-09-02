CREATE TYPE "app"."affectation_category" AS ENUM('right_of_way', 'access', 'infrastructure', 'crops', 'other');--> statement-breakpoint
CREATE TYPE "app"."chainage_method" AS ENUM('frontage_midpoint', 'centroid_projection', 'access_point', 'declared');--> statement-breakpoint
CREATE TYPE "app"."parcel_side" AS ENUM('left', 'right', 'both');--> statement-breakpoint
CREATE TYPE "app"."parcel_status" AS ENUM('confirmed', 'estimated', 'not_located', 'excluded');--> statement-breakpoint
CREATE TYPE "app"."spatial_dataset_kind" AS ENUM('alignment', 'parcels', 'affectations');--> statement-breakpoint
CREATE TYPE "app"."spatial_dataset_origin" AS ENUM('generated', 'imported', 'field_captured');--> statement-breakpoint
CREATE TABLE "app"."affectation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"parcel_id" uuid NOT NULL,
	"dataset_version_id" uuid NOT NULL,
	"category" "app"."affectation_category" NOT NULL,
	"geom" geometry(Polygon,32717) NOT NULL,
	"affected_area_m2" numeric(14, 2) NOT NULL,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "affectation_parcel_version_category_key" UNIQUE("tenant_id","parcel_id","dataset_version_id","category")
);
--> statement-breakpoint
CREATE TABLE "app"."alignment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"dataset_version_id" uuid NOT NULL,
	"label" text NOT NULL,
	"geom" geometry(LineString,32717) NOT NULL,
	"length_m" numeric(12, 2) NOT NULL,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."parcel" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"parcel_code" text NOT NULL,
	"sector_label" text,
	"side" "app"."parcel_side" NOT NULL,
	"status" "app"."parcel_status" DEFAULT 'estimated' NOT NULL,
	"chainage_m" numeric(10, 1),
	"chainage_method" "app"."chainage_method",
	"frontage_m" numeric(8, 1),
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parcel_project_code_key" UNIQUE("tenant_id","project_id","parcel_code"),
	CONSTRAINT "parcel_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."parcel_geometry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"parcel_id" uuid NOT NULL,
	"dataset_version_id" uuid NOT NULL,
	"geom" geometry(Polygon,32717) NOT NULL,
	"area_m2" numeric(14, 2) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"superseded_by_geometry_id" uuid,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parcel_geometry_parcel_version_key" UNIQUE("tenant_id","parcel_id","dataset_version_id"),
	CONSTRAINT "parcel_geometry_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."spatial_dataset" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "app"."spatial_dataset_kind" NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spatial_dataset_project_kind_key" UNIQUE("tenant_id","project_id","kind"),
	CONSTRAINT "spatial_dataset_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."spatial_dataset_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"version_label" text NOT NULL,
	"origin" "app"."spatial_dataset_origin" NOT NULL,
	"source_crs" text NOT NULL,
	"generator_version" text,
	"feature_count" integer NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"supersedes_version_id" uuid,
	"produced_at" timestamp with time zone NOT NULL,
	"note" text,
	"provenance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spatial_dataset_version_label_key" UNIQUE("tenant_id","dataset_id","version_label"),
	CONSTRAINT "spatial_dataset_version_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "app"."affectation" ADD CONSTRAINT "affectation_parcel_fk" FOREIGN KEY ("tenant_id","parcel_id") REFERENCES "app"."parcel"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."affectation" ADD CONSTRAINT "affectation_version_fk" FOREIGN KEY ("tenant_id","dataset_version_id") REFERENCES "app"."spatial_dataset_version"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."affectation" ADD CONSTRAINT "affectation_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."alignment" ADD CONSTRAINT "alignment_version_fk" FOREIGN KEY ("tenant_id","dataset_version_id") REFERENCES "app"."spatial_dataset_version"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."alignment" ADD CONSTRAINT "alignment_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."parcel" ADD CONSTRAINT "parcel_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."parcel_geometry" ADD CONSTRAINT "parcel_geometry_parcel_fk" FOREIGN KEY ("tenant_id","parcel_id") REFERENCES "app"."parcel"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."parcel_geometry" ADD CONSTRAINT "parcel_geometry_version_fk" FOREIGN KEY ("tenant_id","dataset_version_id") REFERENCES "app"."spatial_dataset_version"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."parcel_geometry" ADD CONSTRAINT "parcel_geometry_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."spatial_dataset" ADD CONSTRAINT "spatial_dataset_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."spatial_dataset_version" ADD CONSTRAINT "spatial_dataset_version_dataset_fk" FOREIGN KEY ("tenant_id","dataset_id") REFERENCES "app"."spatial_dataset"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."spatial_dataset_version" ADD CONSTRAINT "spatial_dataset_version_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."spatial_dataset_version" ADD CONSTRAINT "spatial_dataset_version_supersedes_fk" FOREIGN KEY ("tenant_id","supersedes_version_id") REFERENCES "app"."spatial_dataset_version"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "affectation_geom_idx" ON "app"."affectation" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "alignment_geom_idx" ON "app"."alignment" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "parcel_project_chainage_idx" ON "app"."parcel" USING btree ("tenant_id","project_id","chainage_m");--> statement-breakpoint
CREATE INDEX "parcel_geometry_geom_idx" ON "app"."parcel_geometry" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "parcel_geometry_active_idx" ON "app"."parcel_geometry" USING btree ("tenant_id","project_id","is_active");--> statement-breakpoint
CREATE INDEX "spatial_dataset_version_active_idx" ON "app"."spatial_dataset_version" USING btree ("tenant_id","dataset_id","is_active");