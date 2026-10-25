CREATE TABLE "device_links" (
	"device_hash" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_links_device_hash_actor_type_actor_id_pk" PRIMARY KEY("device_hash","actor_type","actor_id")
);
--> statement-breakpoint
CREATE TABLE "risk_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "risk_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "flagged" text;--> statement-breakpoint
CREATE INDEX "device_links_actor_idx" ON "device_links" USING btree ("actor_type","actor_id");--> statement-breakpoint
CREATE INDEX "risk_events_created_idx" ON "risk_events" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "risk_events_subject_idx" ON "risk_events" USING btree ("subject_type","subject_id");