CREATE TABLE "price_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"product_id" text NOT NULL,
	"target_price" integer NOT NULL,
	"price_at_set" integer NOT NULL,
	"stop_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"fired_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_alerts_product_idx" ON "price_alerts" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_alerts_live_idx" ON "price_alerts" USING btree ("user_id","product_id") WHERE fired_at is null and stopped_at is null;