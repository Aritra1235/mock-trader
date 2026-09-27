import { pgEnum } from "drizzle-orm/pg-core";

export const accountRiskTier = pgEnum("account_risk_tier", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const accountType = pgEnum("trading_account_type", [
  "practice",
  "competition",
  "private",
]);

export const accountStatus = pgEnum("trading_account_status", [
  "active",
  "restricted",
  "suspended",
  "closed",
]);

export const instrumentType = pgEnum("instrument_type", [
  "equity",
  "etf",
  "mutual_fund",
  "option",
  "future",
  "currency",
  "crypto",
  "index",
]);

export const instrumentStatus = pgEnum("instrument_status", [
  "active",
  "inactive",
  "delisted",
  "suspended",
]);

export const orderSide = pgEnum("order_side", ["buy", "sell"]);

export const orderType = pgEnum("order_type", [
  "market",
  "limit",
  "stop",
  "stop_limit",
]);

export const orderTimeInForce = pgEnum("order_time_in_force", [
  "day",
  "gtc",
  "ioc",
  "fok",
]);

export const orderStatus = pgEnum("order_status", [
  "draft",
  "queued",
  "accepted",
  "partially_filled",
  "filled",
  "canceled",
  "rejected",
  "expired",
]);

export const tradeLiquidity = pgEnum("trade_liquidity", [
  "maker",
  "taker",
  "auction",
  "internal",
]);

export const ledgerEntryType = pgEnum("ledger_entry_type", [
  "initial_credit",
  "reset_credit",
  "trade_buy",
  "trade_sell",
  "fee",
  "dividend",
  "interest",
  "admin_adjustment",
  "leaderboard_adjustment",
  "hold",
  "release",
]);

export const ledgerEntryStatus = pgEnum("ledger_entry_status", [
  "pending",
  "posted",
  "reversed",
  "failed",
]);

export const competitionStatus = pgEnum("competition_status", [
  "draft",
  "scheduled",
  "active",
  "finalized",
  "archived",
]);

export const competitionParticipantStatus = pgEnum(
  "competition_participant_status",
  ["active", "disqualified", "left"],
);
