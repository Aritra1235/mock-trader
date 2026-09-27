import { pgEnum } from "drizzle-orm/pg-core";

export const fraudAlertType = pgEnum("fraud_alert_type", [
  "account_integrity",
  "session_anomaly",
  "leaderboard_abuse",
  "trade_abuse",
  "market_manipulation",
  "collusion",
  "policy_violation",
]);

export const fraudAlertSeverity = pgEnum("fraud_alert_severity", [
  "info",
  "low",
  "medium",
  "high",
  "critical",
]);

export const fraudAlertStatus = pgEnum("fraud_alert_status", [
  "open",
  "investigating",
  "resolved",
  "false_positive",
]);

export const riskReviewStatus = pgEnum("risk_review_status", [
  "pending",
  "approved",
  "restricted",
  "rejected",
  "escalated",
]);
