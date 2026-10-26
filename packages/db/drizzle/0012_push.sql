CREATE TABLE "push_tokens" (
	"token" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_tokens_token_actor_type_pk" PRIMARY KEY("token","actor_type")
);
--> statement-breakpoint
CREATE INDEX "push_tokens_actor_idx" ON "push_tokens" USING btree ("actor_type","actor_id");