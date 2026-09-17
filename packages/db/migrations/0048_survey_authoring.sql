ALTER TABLE "app"."survey_question" ADD COLUMN "section" text;--> statement-breakpoint
ALTER TABLE "app"."survey_question_translation" ADD COLUMN "section" text;--> statement-breakpoint
ALTER TABLE "app"."survey_version" ADD COLUMN "published_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."survey_version" ADD CONSTRAINT "survey_version_published_by_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "app"."user"("id") ON DELETE no action ON UPDATE no action;