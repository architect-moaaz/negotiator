CREATE TABLE "ondc_messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ondc_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"transaction_id" text NOT NULL,
	"message_id" text NOT NULL,
	"action" text NOT NULL,
	"direction" text NOT NULL,
	"counterparty" text NOT NULL,
	"user_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ondc_messages_txn_idx" ON "ondc_messages" USING btree ("transaction_id","action");--> statement-breakpoint
CREATE INDEX "ondc_messages_created_idx" ON "ondc_messages" USING btree ("created_at");