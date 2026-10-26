CREATE TABLE "store_daily_metrics" (
	"day" date NOT NULL,
	"store_id" text NOT NULL,
	"org_id" text NOT NULL,
	"negotiations" integer DEFAULT 0 NOT NULL,
	"agreed" integer DEFAULT 0 NOT NULL,
	"escalated" integer DEFAULT 0 NOT NULL,
	"human_approved" integer DEFAULT 0 NOT NULL,
	"human_rejected" integer DEFAULT 0 NOT NULL,
	"list_value" bigint DEFAULT 0 NOT NULL,
	"agreed_value" bigint DEFAULT 0 NOT NULL,
	"total_rounds" integer DEFAULT 0 NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"gmv" bigint DEFAULT 0 NOT NULL,
	"fees" bigint DEFAULT 0 NOT NULL,
	"refunds" bigint DEFAULT 0 NOT NULL,
	"disputes" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_daily_metrics_day_store_id_pk" PRIMARY KEY("day","store_id")
);
--> statement-breakpoint
CREATE INDEX "store_daily_metrics_org_idx" ON "store_daily_metrics" USING btree ("org_id","day");