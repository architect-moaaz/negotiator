CREATE TABLE "web_push_subscriptions" (
	"endpoint" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "web_push_phone_idx" ON "web_push_subscriptions" USING btree ("phone");