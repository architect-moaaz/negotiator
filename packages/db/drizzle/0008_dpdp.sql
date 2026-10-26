CREATE TABLE "consents" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "consents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"subject" text NOT NULL,
	"purpose" text NOT NULL,
	"action" text NOT NULL,
	"wording" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grievances" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact" text NOT NULL,
	"category" text NOT NULL,
	"reference" text,
	"message" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"response" text,
	"handled_by" text,
	"acknowledge_by" timestamp with time zone NOT NULL,
	"resolve_by" timestamp with time zone NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "consents_subject_idx" ON "consents" USING btree ("subject");--> statement-breakpoint
CREATE INDEX "grievances_status_idx" ON "grievances" USING btree ("status");