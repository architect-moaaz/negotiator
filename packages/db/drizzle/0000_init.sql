CREATE TABLE "activity" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "activity_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"user_id" text,
	"deal_id" text,
	"detail" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"key" text PRIMARY KEY NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"seller_id" text,
	"status" text NOT NULL,
	"channel" text NOT NULL,
	"city" text,
	"deal_price" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller_aliases" (
	"alias" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller_demand" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"marketplace" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sellers" (
	"id" text PRIMARY KEY NOT NULL,
	"store_name" text NOT NULL,
	"contact_name" text NOT NULL,
	"phone" text NOT NULL,
	"budget_pct" double precision NOT NULL,
	"auto_approve_share" double precision NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sellers_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"channel" text NOT NULL,
	"city" text,
	"demographics" jsonb,
	"consent_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "visits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"vid" text NOT NULL,
	"path" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seller_aliases" ADD CONSTRAINT "seller_aliases_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_tokens" ADD CONSTRAINT "seller_tokens_seller_id_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."sellers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_at_idx" ON "activity" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_deal_idx" ON "activity" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "activity_user_idx" ON "activity" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "deals_created_idx" ON "deals" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "deals_user_idx" ON "deals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "deals_seller_idx" ON "deals" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "deals_status_idx" ON "deals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "seller_aliases_seller_idx" ON "seller_aliases" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "seller_tokens_seller_idx" ON "seller_tokens" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "visits_at_idx" ON "visits" USING btree ("at" DESC NULLS LAST);