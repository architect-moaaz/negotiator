CREATE TABLE "reconciliation_issues" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reconciliation_issues_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_id" bigint NOT NULL,
	"day" date NOT NULL,
	"order_id" text NOT NULL,
	"kind" text NOT NULL,
	"ledger_amount" bigint NOT NULL,
	"gateway_amount" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reconciliation_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"day" date NOT NULL,
	"gateway" text NOT NULL,
	"report_lines" integer NOT NULL,
	"ledger_lines" integer NOT NULL,
	"matched" integer NOT NULL,
	"issues" integer NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "reconciliation_issues_status_idx" ON "reconciliation_issues" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_issues_key_idx" ON "reconciliation_issues" USING btree ("day","order_id","kind");--> statement-breakpoint
CREATE INDEX "reconciliation_runs_day_idx" ON "reconciliation_runs" USING btree ("day");