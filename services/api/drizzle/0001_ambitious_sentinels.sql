CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"severity" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"metadata" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
DROP INDEX "orders_idempotency_key_idx";--> statement-breakpoint
ALTER TABLE "mock_cash_ledger_entries" ALTER COLUMN "currency" SET DEFAULT 'INR';--> statement-breakpoint
ALTER TABLE "trading_accounts" ALTER COLUMN "base_currency" SET DEFAULT 'INR';--> statement-breakpoint
ALTER TABLE "trading_accounts" ALTER COLUMN "starting_balance" SET DEFAULT '1000000';--> statement-breakpoint
ALTER TABLE "trading_accounts" ALTER COLUMN "mock_cash_balance" SET DEFAULT '1000000';--> statement-breakpoint
ALTER TABLE "trading_accounts" ALTER COLUMN "mock_buying_power" SET DEFAULT '1000000';--> statement-breakpoint
ALTER TABLE "instruments" ALTER COLUMN "currency" SET DEFAULT 'INR';--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auditLog_userId_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auditLog_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "auditLog_createdAt_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
WITH ranked_practice_accounts AS (
	SELECT "id", row_number() OVER (
		PARTITION BY "user_id"
		ORDER BY "created_at", "id"
	) AS account_rank
	FROM "trading_accounts"
	WHERE "type" = 'practice'
)
UPDATE "trading_accounts"
SET
	"type" = 'private',
	"metadata" = coalesce("metadata", '{}'::jsonb) || '{"migration":"duplicate_practice_account_preserved_as_private"}'::jsonb,
	"updated_at" = now()
WHERE "id" IN (
	SELECT "id" FROM ranked_practice_accounts WHERE account_rank > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "trading_accounts_one_practice_per_user_idx" ON "trading_accounts" USING btree ("user_id") WHERE "trading_accounts"."type" = 'practice';--> statement-breakpoint
CREATE UNIQUE INDEX "orders_account_idempotency_key_idx" ON "orders" USING btree ("account_id","idempotency_key");
