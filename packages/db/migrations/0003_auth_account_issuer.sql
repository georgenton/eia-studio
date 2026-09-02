ALTER TABLE "auth"."account" ADD COLUMN "issuer" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_account_id_key" ON "auth"."account" USING btree ("issuer","account_id");