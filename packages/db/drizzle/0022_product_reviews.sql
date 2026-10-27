CREATE TABLE "product_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"store_id" text NOT NULL,
	"product_id" text,
	"user_id" text NOT NULL,
	"author_name" text NOT NULL,
	"rating" integer NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"seller_reply" text,
	"seller_replied_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"hidden_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_reviews_order_idx" ON "product_reviews" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "product_reviews_product_idx" ON "product_reviews" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_reviews_store_idx" ON "product_reviews" USING btree ("store_id");