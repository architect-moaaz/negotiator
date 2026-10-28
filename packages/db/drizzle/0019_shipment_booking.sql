ALTER TABLE "shipments" ADD COLUMN "booking_ref" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "label_url" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "pickup_at" timestamp with time zone;