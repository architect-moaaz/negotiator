DROP INDEX "return_requests_order_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "return_requests_order_uq" ON "return_requests" USING btree ("order_id");