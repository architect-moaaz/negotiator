CREATE TABLE "kyc_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"store_id" text,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"masked" text,
	"identity_hash" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "business_type" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "verification_token" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "kyc_checks" ADD CONSTRAINT "kyc_checks_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_checks" ADD CONSTRAINT "kyc_checks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kyc_checks_org_idx" ON "kyc_checks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "kyc_checks_hash_idx" ON "kyc_checks" USING btree ("identity_hash");