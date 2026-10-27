CREATE TABLE "away_rules" (
	"store_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"max_pct_off" double precision DEFAULT 0 NOT NULL,
	"days" integer[] DEFAULT '{0,1,2,3,4,5,6}'::integer[] NOT NULL,
	"start_hour" integer DEFAULT 21 NOT NULL,
	"end_hour" integer DEFAULT 9 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "away_rules" ADD CONSTRAINT "away_rules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;