CREATE TABLE "app"."survey_option_translation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_option_translation_key" UNIQUE("tenant_id","option_id","locale")
);
--> statement-breakpoint
CREATE TABLE "app"."survey_question_translation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"prompt" text NOT NULL,
	"help_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_question_translation_key" UNIQUE("tenant_id","question_id","locale")
);
--> statement-breakpoint
ALTER TABLE "app"."survey_option_translation" ADD CONSTRAINT "survey_option_translation_option_fk" FOREIGN KEY ("tenant_id","option_id") REFERENCES "app"."survey_option"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_option_translation" ADD CONSTRAINT "survey_option_translation_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_question_translation" ADD CONSTRAINT "survey_question_translation_question_fk" FOREIGN KEY ("tenant_id","question_id") REFERENCES "app"."survey_question"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."survey_question_translation" ADD CONSTRAINT "survey_question_translation_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "app"."project"("tenant_id","id") ON DELETE cascade ON UPDATE no action;