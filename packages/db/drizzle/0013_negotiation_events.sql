CREATE TABLE "negotiation_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "negotiation_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"deal_id" text NOT NULL,
	"version" integer NOT NULL,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"price" integer,
	"status" text NOT NULL,
	"message" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "negotiation_events_deal_idx" ON "negotiation_events" USING btree ("deal_id","id");