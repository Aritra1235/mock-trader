CREATE TYPE "public"."fraud_alert_severity" AS ENUM('info', 'low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."fraud_alert_status" AS ENUM('open', 'investigating', 'resolved', 'false_positive');--> statement-breakpoint
CREATE TYPE "public"."fraud_alert_type" AS ENUM('account_integrity', 'session_anomaly', 'leaderboard_abuse', 'trade_abuse', 'market_manipulation', 'collusion', 'policy_violation');--> statement-breakpoint
CREATE TYPE "public"."risk_review_status" AS ENUM('pending', 'approved', 'restricted', 'rejected', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."account_risk_tier" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."trading_account_status" AS ENUM('active', 'restricted', 'suspended', 'closed');--> statement-breakpoint
CREATE TYPE "public"."trading_account_type" AS ENUM('practice', 'competition', 'private');--> statement-breakpoint
CREATE TYPE "public"."competition_participant_status" AS ENUM('active', 'disqualified', 'left');--> statement-breakpoint
CREATE TYPE "public"."competition_status" AS ENUM('draft', 'scheduled', 'active', 'finalized', 'archived');--> statement-breakpoint
CREATE TYPE "public"."instrument_status" AS ENUM('active', 'inactive', 'delisted', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."instrument_type" AS ENUM('equity', 'etf', 'mutual_fund', 'option', 'future', 'currency', 'crypto', 'index');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_status" AS ENUM('pending', 'posted', 'reversed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('initial_credit', 'reset_credit', 'trade_buy', 'trade_sell', 'fee', 'dividend', 'interest', 'admin_adjustment', 'leaderboard_adjustment', 'hold', 'release');--> statement-breakpoint
CREATE TYPE "public"."order_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('draft', 'queued', 'accepted', 'partially_filled', 'filled', 'canceled', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."order_time_in_force" AS ENUM('day', 'gtc', 'ioc', 'fok');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('market', 'limit', 'stop', 'stop_limit');--> statement-breakpoint
CREATE TYPE "public"."trade_liquidity" AS ENUM('maker', 'taker', 'auction', 'internal');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	"device_fingerprint" text,
	"device_trust_score" integer DEFAULT 0,
	"geo_country" text,
	"geo_region" text,
	"risk_score" integer DEFAULT 0,
	"risk_signals" jsonb,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp,
	"trading_status" text DEFAULT 'active',
	"leaderboard_status" text DEFAULT 'eligible',
	"risk_tier" text DEFAULT 'low',
	"fraud_review_status" text DEFAULT 'clear',
	"last_risk_review_at" timestamp,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_risk_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"status" "risk_review_status" DEFAULT 'pending' NOT NULL,
	"previous_risk_tier" "account_risk_tier",
	"next_risk_tier" "account_risk_tier",
	"reason" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"reviewer_user_id" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fraud_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"deduplication_key" text NOT NULL,
	"type" "fraud_alert_type" NOT NULL,
	"severity" "fraud_alert_severity" DEFAULT 'medium' NOT NULL,
	"status" "fraud_alert_status" DEFAULT 'open' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"detector" text NOT NULL,
	"detector_version" text NOT NULL,
	"user_id" text,
	"account_id" text,
	"session_id" text,
	"competition_id" text,
	"leaderboard_entry_id" text,
	"portfolio_snapshot_id" text,
	"order_id" text,
	"trade_id" text,
	"related_account_id" text,
	"related_user_id" text,
	"evidence" jsonb NOT NULL,
	"first_detected_at" timestamp with time zone NOT NULL,
	"last_detected_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fraud_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"account_id" text,
	"source" text NOT NULL,
	"signal_type" text NOT NULL,
	"severity" "fraud_alert_severity" DEFAULT 'low' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"raw_value" text,
	"normalized_value" text,
	"evidence" jsonb,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"account_id" text,
	"session_id" text,
	"actor_user_id" text,
	"event_type" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"device_fingerprint" text,
	"request_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_cash_ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" "ledger_entry_type" NOT NULL,
	"status" "ledger_entry_status" DEFAULT 'pending' NOT NULL,
	"amount" numeric(24, 8) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"balance_after" numeric(24, 8),
	"reference_type" text,
	"reference_id" text,
	"idempotency_key" text NOT NULL,
	"description" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"instrument_id" text NOT NULL,
	"quantity" numeric(24, 8) DEFAULT '0' NOT NULL,
	"available_quantity" numeric(24, 8) DEFAULT '0' NOT NULL,
	"average_cost" numeric(24, 8) DEFAULT '0' NOT NULL,
	"realized_pnl" numeric(24, 8) DEFAULT '0' NOT NULL,
	"unrealized_pnl" numeric(24, 8) DEFAULT '0' NOT NULL,
	"opened_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_number" text NOT NULL,
	"type" "trading_account_type" DEFAULT 'practice' NOT NULL,
	"status" "trading_account_status" DEFAULT 'active' NOT NULL,
	"base_currency" text DEFAULT 'USD' NOT NULL,
	"starting_balance" numeric(24, 8) DEFAULT '100000' NOT NULL,
	"mock_cash_balance" numeric(24, 8) DEFAULT '100000' NOT NULL,
	"mock_buying_power" numeric(24, 8) DEFAULT '100000' NOT NULL,
	"reserved_mock_cash" numeric(24, 8) DEFAULT '0' NOT NULL,
	"day_trade_count" integer DEFAULT 0 NOT NULL,
	"reset_count" integer DEFAULT 0 NOT NULL,
	"leaderboard_eligible" boolean DEFAULT true NOT NULL,
	"risk_tier" "account_risk_tier" DEFAULT 'low' NOT NULL,
	"restriction_reason" text,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trusted_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"fingerprint_hash" text NOT NULL,
	"ip_hash" text,
	"user_agent_hash" text,
	"trust_score" integer DEFAULT 0 NOT NULL,
	"risk_signals" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "competition_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"competition_id" text NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"status" "competition_participant_status" DEFAULT 'active' NOT NULL,
	"disqualified_reason" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" "competition_status" DEFAULT 'draft' NOT NULL,
	"starting_balance" numeric(24, 8) DEFAULT '100000' NOT NULL,
	"base_currency" text DEFAULT 'USD' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"allow_reset" boolean DEFAULT false NOT NULL,
	"max_resets" integer DEFAULT 0 NOT NULL,
	"max_daily_orders" integer,
	"max_position_weight_pct" numeric(8, 4),
	"rules" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaderboard_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"competition_id" text,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"rank" integer NOT NULL,
	"previous_rank" integer,
	"equity" numeric(24, 8) NOT NULL,
	"return_pct" numeric(12, 6) NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"risk_score" integer DEFAULT 0 NOT NULL,
	"eligible" boolean DEFAULT true NOT NULL,
	"ineligible_reason" text,
	"calculated_at" timestamp with time zone NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshot_positions" (
	"id" text PRIMARY KEY NOT NULL,
	"portfolio_snapshot_id" text NOT NULL,
	"account_id" text NOT NULL,
	"competition_id" text,
	"instrument_id" text NOT NULL,
	"market_quote_id" text,
	"quantity" numeric(24, 8) NOT NULL,
	"average_cost" numeric(24, 8) NOT NULL,
	"last_price" numeric(24, 8) NOT NULL,
	"market_value" numeric(24, 8) NOT NULL,
	"unrealized_pnl" numeric(24, 8) NOT NULL,
	"weight_pct" numeric(12, 6),
	"valuation_source" text DEFAULT 'latest_quote' NOT NULL,
	"quote_observed_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"competition_id" text,
	"mock_cash_balance" numeric(24, 8) NOT NULL,
	"positions_value" numeric(24, 8) NOT NULL,
	"equity" numeric(24, 8) NOT NULL,
	"realized_pnl" numeric(24, 8) DEFAULT '0' NOT NULL,
	"unrealized_pnl" numeric(24, 8) DEFAULT '0' NOT NULL,
	"return_pct" numeric(12, 6) NOT NULL,
	"max_drawdown_pct" numeric(12, 6),
	"trade_count" integer DEFAULT 0 NOT NULL,
	"valuation_source" text DEFAULT 'latest_quote' NOT NULL,
	"snapshot_at" timestamp with time zone NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"exchange" text NOT NULL,
	"name" text NOT NULL,
	"type" "instrument_type" NOT NULL,
	"status" "instrument_status" DEFAULT 'active' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"security_id" text,
	"isin" text,
	"lot_size" integer DEFAULT 1 NOT NULL,
	"tick_size" numeric(20, 8),
	"price_band" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"instrument_id" text NOT NULL,
	"source" text NOT NULL,
	"bid_price" numeric(20, 8),
	"ask_price" numeric(20, 8),
	"last_price" numeric(20, 8),
	"day_volume" bigint,
	"provider_sequence" text,
	"raw_payload" jsonb,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"event_type" text NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status",
	"actor_user_id" text,
	"message" text,
	"request_id" text,
	"ip_address" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"instrument_id" text NOT NULL,
	"reservation_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reserved_mock_cash" numeric(24, 8) DEFAULT '0' NOT NULL,
	"reserved_quantity" numeric(24, 8) DEFAULT '0' NOT NULL,
	"released_mock_cash" numeric(24, 8) DEFAULT '0' NOT NULL,
	"released_quantity" numeric(24, 8) DEFAULT '0' NOT NULL,
	"release_reason" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"instrument_id" text NOT NULL,
	"session_id" text,
	"client_order_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"side" "order_side" NOT NULL,
	"type" "order_type" NOT NULL,
	"status" "order_status" DEFAULT 'draft' NOT NULL,
	"time_in_force" "order_time_in_force" DEFAULT 'day' NOT NULL,
	"quantity" numeric(24, 8) NOT NULL,
	"limit_price" numeric(24, 8),
	"stop_price" numeric(24, 8),
	"filled_quantity" numeric(24, 8) DEFAULT '0' NOT NULL,
	"average_fill_price" numeric(24, 8),
	"notional_estimate" numeric(24, 8),
	"source" text DEFAULT 'api' NOT NULL,
	"request_ip_address" text,
	"request_user_agent" text,
	"request_device_fingerprint" text,
	"placed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"rejected_reason" text,
	"canceled_reason" text,
	"risk_score" numeric(8, 2) DEFAULT '0' NOT NULL,
	"risk_signals" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position_lots" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"instrument_id" text NOT NULL,
	"position_id" text,
	"opening_trade_id" text NOT NULL,
	"closing_trade_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_quantity" numeric(24, 8) NOT NULL,
	"remaining_quantity" numeric(24, 8) NOT NULL,
	"cost_basis_price" numeric(24, 8) NOT NULL,
	"cost_basis_amount" numeric(24, 8) NOT NULL,
	"realized_pnl" numeric(24, 8) DEFAULT '0' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"instrument_id" text NOT NULL,
	"side" "order_side" NOT NULL,
	"quantity" numeric(24, 8) NOT NULL,
	"price" numeric(24, 8) NOT NULL,
	"gross_amount" numeric(24, 8) NOT NULL,
	"fees" numeric(24, 8) DEFAULT '0' NOT NULL,
	"net_amount" numeric(24, 8) NOT NULL,
	"liquidity" "trade_liquidity" DEFAULT 'taker' NOT NULL,
	"counterparty_account_id" text,
	"market_quote_id" text,
	"price_source" text DEFAULT 'latest_quote' NOT NULL,
	"quote_observed_at" timestamp with time zone,
	"execution_reason" text NOT NULL,
	"execution_venue" text,
	"executed_at" timestamp with time zone NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_risk_reviews" ADD CONSTRAINT "account_risk_reviews_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_risk_reviews" ADD CONSTRAINT "account_risk_reviews_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_risk_reviews" ADD CONSTRAINT "account_risk_reviews_reviewer_user_id_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_leaderboard_entry_id_leaderboard_entries_id_fk" FOREIGN KEY ("leaderboard_entry_id") REFERENCES "public"."leaderboard_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_portfolio_snapshot_id_portfolio_snapshots_id_fk" FOREIGN KEY ("portfolio_snapshot_id") REFERENCES "public"."portfolio_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_related_account_id_trading_accounts_id_fk" FOREIGN KEY ("related_account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_related_user_id_user_id_fk" FOREIGN KEY ("related_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_signals" ADD CONSTRAINT "fraud_signals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_signals" ADD CONSTRAINT "fraud_signals_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_audit_events" ADD CONSTRAINT "security_audit_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_audit_events" ADD CONSTRAINT "security_audit_events_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_audit_events" ADD CONSTRAINT "security_audit_events_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_audit_events" ADD CONSTRAINT "security_audit_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_cash_ledger_entries" ADD CONSTRAINT "mock_cash_ledger_entries_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_cash_ledger_entries" ADD CONSTRAINT "mock_cash_ledger_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD CONSTRAINT "trading_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_participants" ADD CONSTRAINT "competition_participants_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_participants" ADD CONSTRAINT "competition_participants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_participants" ADD CONSTRAINT "competition_participants_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshot_positions" ADD CONSTRAINT "portfolio_snapshot_positions_portfolio_snapshot_id_portfolio_snapshots_id_fk" FOREIGN KEY ("portfolio_snapshot_id") REFERENCES "public"."portfolio_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshot_positions" ADD CONSTRAINT "portfolio_snapshot_positions_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshot_positions" ADD CONSTRAINT "portfolio_snapshot_positions_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshot_positions" ADD CONSTRAINT "portfolio_snapshot_positions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshot_positions" ADD CONSTRAINT "portfolio_snapshot_positions_market_quote_id_market_quotes_id_fk" FOREIGN KEY ("market_quote_id") REFERENCES "public"."market_quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_quotes" ADD CONSTRAINT "market_quotes_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_reservations" ADD CONSTRAINT "order_reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_reservations" ADD CONSTRAINT "order_reservations_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_reservations" ADD CONSTRAINT "order_reservations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_reservations" ADD CONSTRAINT "order_reservations_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_lots" ADD CONSTRAINT "position_lots_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_lots" ADD CONSTRAINT "position_lots_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_lots" ADD CONSTRAINT "position_lots_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_lots" ADD CONSTRAINT "position_lots_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_lots" ADD CONSTRAINT "position_lots_opening_trade_id_trades_id_fk" FOREIGN KEY ("opening_trade_id") REFERENCES "public"."trades"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_lots" ADD CONSTRAINT "position_lots_closing_trade_id_trades_id_fk" FOREIGN KEY ("closing_trade_id") REFERENCES "public"."trades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_counterparty_account_id_trading_accounts_id_fk" FOREIGN KEY ("counterparty_account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_market_quote_id_market_quotes_id_fk" FOREIGN KEY ("market_quote_id") REFERENCES "public"."market_quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_device_fingerprint_idx" ON "session" USING btree ("device_fingerprint");--> statement-breakpoint
CREATE INDEX "session_risk_score_idx" ON "session" USING btree ("risk_score");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "account_risk_reviews_account_created_idx" ON "account_risk_reviews" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "account_risk_reviews_status_idx" ON "account_risk_reviews" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "fraud_alerts_deduplication_key_idx" ON "fraud_alerts" USING btree ("deduplication_key");--> statement-breakpoint
CREATE INDEX "fraud_alerts_status_severity_idx" ON "fraud_alerts" USING btree ("status","severity");--> statement-breakpoint
CREATE INDEX "fraud_alerts_user_status_idx" ON "fraud_alerts" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "fraud_alerts_account_status_idx" ON "fraud_alerts" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "fraud_alerts_detector_idx" ON "fraud_alerts" USING btree ("detector","created_at");--> statement-breakpoint
CREATE INDEX "fraud_alerts_competition_idx" ON "fraud_alerts" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "fraud_alerts_leaderboard_entry_idx" ON "fraud_alerts" USING btree ("leaderboard_entry_id");--> statement-breakpoint
CREATE INDEX "fraud_alerts_order_idx" ON "fraud_alerts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "fraud_alerts_trade_idx" ON "fraud_alerts" USING btree ("trade_id");--> statement-breakpoint
CREATE INDEX "fraud_signals_user_observed_idx" ON "fraud_signals" USING btree ("user_id","observed_at");--> statement-breakpoint
CREATE INDEX "fraud_signals_account_observed_idx" ON "fraud_signals" USING btree ("account_id","observed_at");--> statement-breakpoint
CREATE INDEX "fraud_signals_type_score_idx" ON "fraud_signals" USING btree ("signal_type","score");--> statement-breakpoint
CREATE INDEX "security_audit_events_user_created_idx" ON "security_audit_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "security_audit_events_account_created_idx" ON "security_audit_events" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "security_audit_events_type_created_idx" ON "security_audit_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "security_audit_events_request_idx" ON "security_audit_events" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mock_cash_ledger_entries_idempotency_key_idx" ON "mock_cash_ledger_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "mock_cash_ledger_entries_account_occurred_idx" ON "mock_cash_ledger_entries" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "mock_cash_ledger_entries_reference_idx" ON "mock_cash_ledger_entries" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_account_instrument_idx" ON "positions" USING btree ("account_id","instrument_id");--> statement-breakpoint
CREATE INDEX "positions_instrument_idx" ON "positions" USING btree ("instrument_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_accounts_account_number_idx" ON "trading_accounts" USING btree ("account_number");--> statement-breakpoint
CREATE INDEX "trading_accounts_user_status_idx" ON "trading_accounts" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "trading_accounts_risk_tier_idx" ON "trading_accounts" USING btree ("risk_tier");--> statement-breakpoint
CREATE INDEX "trading_accounts_leaderboard_eligible_idx" ON "trading_accounts" USING btree ("leaderboard_eligible");--> statement-breakpoint
CREATE UNIQUE INDEX "trusted_devices_user_fingerprint_idx" ON "trusted_devices" USING btree ("user_id","fingerprint_hash");--> statement-breakpoint
CREATE INDEX "trusted_devices_fingerprint_idx" ON "trusted_devices" USING btree ("fingerprint_hash");--> statement-breakpoint
CREATE INDEX "trusted_devices_trust_score_idx" ON "trusted_devices" USING btree ("trust_score");--> statement-breakpoint
CREATE UNIQUE INDEX "competition_participants_competition_user_idx" ON "competition_participants" USING btree ("competition_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competition_participants_account_idx" ON "competition_participants" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "competition_participants_status_idx" ON "competition_participants" USING btree ("competition_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "competitions_slug_idx" ON "competitions" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "competitions_status_window_idx" ON "competitions" USING btree ("status","starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboard_entries_scope_account_calculated_idx" ON "leaderboard_entries" USING btree ("competition_id","account_id","calculated_at");--> statement-breakpoint
CREATE INDEX "leaderboard_entries_scope_rank_idx" ON "leaderboard_entries" USING btree ("competition_id","rank");--> statement-breakpoint
CREATE INDEX "leaderboard_entries_user_calculated_idx" ON "leaderboard_entries" USING btree ("user_id","calculated_at");--> statement-breakpoint
CREATE INDEX "leaderboard_entries_risk_score_idx" ON "leaderboard_entries" USING btree ("risk_score");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_snapshot_positions_snapshot_instrument_idx" ON "portfolio_snapshot_positions" USING btree ("portfolio_snapshot_id","instrument_id");--> statement-breakpoint
CREATE INDEX "portfolio_snapshot_positions_account_idx" ON "portfolio_snapshot_positions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "portfolio_snapshot_positions_competition_idx" ON "portfolio_snapshot_positions" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "portfolio_snapshot_positions_market_quote_idx" ON "portfolio_snapshot_positions" USING btree ("market_quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_snapshots_account_snapshot_idx" ON "portfolio_snapshots" USING btree ("account_id","snapshot_at");--> statement-breakpoint
CREATE INDEX "portfolio_snapshots_competition_snapshot_idx" ON "portfolio_snapshots" USING btree ("competition_id","snapshot_at");--> statement-breakpoint
CREATE INDEX "portfolio_snapshots_equity_idx" ON "portfolio_snapshots" USING btree ("equity");--> statement-breakpoint
CREATE UNIQUE INDEX "instruments_exchange_symbol_idx" ON "instruments" USING btree ("exchange","symbol");--> statement-breakpoint
CREATE INDEX "instruments_security_id_idx" ON "instruments" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "instruments_type_status_idx" ON "instruments" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "market_quotes_instrument_observed_idx" ON "market_quotes" USING btree ("instrument_id","observed_at");--> statement-breakpoint
CREATE INDEX "market_quotes_source_observed_idx" ON "market_quotes" USING btree ("source","observed_at");--> statement-breakpoint
CREATE INDEX "order_events_order_created_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_events_type_created_idx" ON "order_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_reservations_idempotency_key_idx" ON "order_reservations" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "order_reservations_order_idx" ON "order_reservations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_reservations_account_status_idx" ON "order_reservations" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "order_reservations_user_created_idx" ON "order_reservations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_client_order_idx" ON "orders" USING btree ("account_id","client_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_idempotency_key_idx" ON "orders" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_account_status_idx" ON "orders" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "orders_user_created_idx" ON "orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_instrument_created_idx" ON "orders" USING btree ("instrument_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_session_idx" ON "orders" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "orders_risk_score_idx" ON "orders" USING btree ("risk_score");--> statement-breakpoint
CREATE INDEX "position_lots_account_instrument_status_idx" ON "position_lots" USING btree ("account_id","instrument_id","status");--> statement-breakpoint
CREATE INDEX "position_lots_position_status_idx" ON "position_lots" USING btree ("position_id","status");--> statement-breakpoint
CREATE INDEX "position_lots_opening_trade_idx" ON "position_lots" USING btree ("opening_trade_id");--> statement-breakpoint
CREATE INDEX "position_lots_closing_trade_idx" ON "position_lots" USING btree ("closing_trade_id");--> statement-breakpoint
CREATE INDEX "trades_account_executed_idx" ON "trades" USING btree ("account_id","executed_at");--> statement-breakpoint
CREATE INDEX "trades_user_executed_idx" ON "trades" USING btree ("user_id","executed_at");--> statement-breakpoint
CREATE INDEX "trades_instrument_executed_idx" ON "trades" USING btree ("instrument_id","executed_at");--> statement-breakpoint
CREATE INDEX "trades_order_idx" ON "trades" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "trades_counterparty_account_idx" ON "trades" USING btree ("counterparty_account_id");--> statement-breakpoint
CREATE INDEX "trades_market_quote_idx" ON "trades" USING btree ("market_quote_id");--> statement-breakpoint
CREATE INDEX "trades_price_source_idx" ON "trades" USING btree ("price_source");