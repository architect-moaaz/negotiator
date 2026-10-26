CREATE TABLE "fee_invoices" (
	"number" text PRIMARY KEY NOT NULL,
	"fy" text NOT NULL,
	"serial" integer NOT NULL,
	"org_id" text NOT NULL,
	"store_id" text NOT NULL,
	"period" text NOT NULL,
	"seller_name" text NOT NULL,
	"seller_gstin" text,
	"seller_address" text,
	"place_of_supply" text,
	"taxable" bigint NOT NULL,
	"cgst" bigint NOT NULL,
	"sgst" bigint NOT NULL,
	"igst" bigint NOT NULL,
	"total" bigint NOT NULL,
	"lines" jsonb NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fee_invoices_store_period_idx" ON "fee_invoices" USING btree ("store_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_invoices_fy_serial_idx" ON "fee_invoices" USING btree ("fy","serial");--> statement-breakpoint
CREATE INDEX "fee_invoices_org_idx" ON "fee_invoices" USING btree ("org_id");