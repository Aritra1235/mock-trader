CREATE TYPE "public"."order_product" AS ENUM('delivery', 'intraday');--> statement-breakpoint
DROP INDEX "positions_account_instrument_idx";--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "product" "order_product" DEFAULT 'delivery' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "product" "order_product" DEFAULT 'delivery' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "positions_account_instrument_product_idx" ON "positions" USING btree ("account_id","instrument_id","product");