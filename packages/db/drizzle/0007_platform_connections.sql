CREATE TABLE "platform_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"scopes" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uninstalled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "platform_connections" ADD CONSTRAINT "platform_connections_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_connections_external_idx" ON "platform_connections" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "platform_connections_store_idx" ON "platform_connections" USING btree ("store_id");