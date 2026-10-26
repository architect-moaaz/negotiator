CREATE TABLE "holds" (
	"order_id" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'held' NOT NULL,
	"amount" bigint NOT NULL,
	"gateway" text NOT NULL,
	"gateway_ref" text,
	"release_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ledger_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"txn_id" text NOT NULL,
	"order_id" text,
	"kind" text NOT NULL,
	"account" text NOT NULL,
	"amount" bigint NOT NULL,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"store_id" text NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"product_id" text,
	"title" text NOT NULL,
	"total" bigint NOT NULL,
	"fee" bigint NOT NULL,
	"gst" bigint NOT NULL,
	"seller_share" bigint NOT NULL,
	"lock_fee" bigint NOT NULL,
	"status" text DEFAULT 'placed' NOT NULL,
	"test_payments" boolean DEFAULT false NOT NULL,
	"ship_by" timestamp with time zone NOT NULL,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"address" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_deal_id_unique" UNIQUE("deal_id")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"gateway_ref" text,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "holds_release_idx" ON "holds" USING btree ("state","release_at");--> statement-breakpoint
CREATE INDEX "ledger_txn_idx" ON "ledger_entries" USING btree ("txn_id");--> statement-breakpoint
CREATE INDEX "ledger_order_idx" ON "ledger_entries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ledger_account_idx" ON "ledger_entries" USING btree ("account");--> statement-breakpoint
CREATE INDEX "orders_store_idx" ON "orders" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "refunds" USING btree ("order_id");