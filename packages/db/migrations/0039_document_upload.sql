-- A document version can be an uploaded file (Production V1 Wave 2, ADR-031, PART G/I/O).
--
-- Every column is added nullable, or with a default that is true of the rows already there:
--
--   * `processing_state` defaults to `READY`, which is what a version whose text was transcribed
--     and chunked already is. It is not pretending — those versions have their chunks.
--   * `privacy_classification` defaults to `REVIEW_REQUIRED`, and deliberately not to "none
--     known": the product has read nothing at upload time, and a green state nobody checked is
--     exactly the one that would later be quoted.
--   * the file columns stay null for the pilot's reconstructed excerpts, so a transcribed version
--     and an uploaded one stay tellable apart by looking rather than by inference.
--
-- Additive and forward-only: no row is rewritten, nothing is dropped, and a citation made against
-- an existing version resolves to exactly the words it resolved to before.
CREATE TYPE "app"."document_privacy" AS ENUM('NO_PERSONAL_DATA_KNOWN', 'CONTAINS_PERSONAL_DATA', 'REVIEW_REQUIRED');--> statement-breakpoint
CREATE TYPE "app"."document_processing_state" AS ENUM('UPLOADED', 'QUEUED', 'PROCESSING', 'READY', 'REQUIRES_OCR', 'FAILED');--> statement-breakpoint
ALTER TYPE "app"."document_text_source" ADD VALUE 'DOCX_TEXT';--> statement-breakpoint
ALTER TYPE "app"."document_text_source" ADD VALUE 'PENDING_EXTRACTION';--> statement-breakpoint
ALTER TABLE "app"."document_version" ADD COLUMN "stored_object_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."document_version" ADD COLUMN "file_sha256" text;--> statement-breakpoint
ALTER TABLE "app"."document_version" ADD COLUMN "original_filename" text;--> statement-breakpoint
ALTER TABLE "app"."document_version" ADD COLUMN "mime_type" text;--> statement-breakpoint
ALTER TABLE "app"."document_version" ADD COLUMN "size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "app"."document_version" ADD COLUMN "processing_state" "app"."document_processing_state" DEFAULT 'READY' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."document_version" ADD COLUMN "processing_note" text;--> statement-breakpoint
ALTER TABLE "app"."document_version" ADD COLUMN "privacy_classification" "app"."document_privacy" DEFAULT 'REVIEW_REQUIRED' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."document_version" ADD COLUMN "source_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."document_version" ADD CONSTRAINT "document_version_stored_object_fk" FOREIGN KEY ("tenant_id","stored_object_id") REFERENCES "app"."stored_object"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_version_file_hash_idx" ON "app"."document_version" USING btree ("tenant_id","document_id","file_sha256");