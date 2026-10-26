CREATE TABLE "cart_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"cart_id" text NOT NULL,
	"channel" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"error" text,
	"expires_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"source" text NOT NULL,
	"external_ref" text,
	"lines" jsonb NOT NULL,
	"subtotal" integer NOT NULL,
	"user_id" text,
	"email" text,
	"phone" text,
	"name" text,
	"consent_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"return_url" text,
	"deal_id" text,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"abandoned_at" timestamp with time zone,
	"recovered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_settings" (
	"store_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"max_discount_pct" double precision,
	"auto_approve_pct" double precision,
	"delay_minutes" integer DEFAULT 60 NOT NULL,
	"channels" text[] DEFAULT ARRAY['email']::text[] NOT NULL,
	"exit_prompt" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "brand" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "gtin" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "model_number" text;--> statement-breakpoint
ALTER TABLE "cart_invites" ADD CONSTRAINT "cart_invites_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_settings" ADD CONSTRAINT "recovery_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cart_invites_cart_idx" ON "cart_invites" USING btree ("cart_id");--> statement-breakpoint
CREATE INDEX "carts_store_status_idx" ON "carts" USING btree ("store_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "carts_external_idx" ON "carts" USING btree ("store_id","source","external_ref") WHERE external_ref is not null;