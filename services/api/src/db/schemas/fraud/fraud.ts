import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { session, user } from "../auth/auth-schema";
import { tradingAccounts } from "../trading/accounts";
import { accountRiskTier } from "../trading/enums";
import {
  competitions,
  leaderboardEntries,
  portfolioSnapshots,
} from "../trading/leaderboard";
import { orders, trades } from "../trading/orders";
import {
  fraudAlertSeverity,
  fraudAlertStatus,
  fraudAlertType,
  riskReviewStatus,
} from "./enums";

export const fraudSignals = pgTable(
  "fraud_signals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    accountId: text("account_id").references(() => tradingAccounts.id, {
      onDelete: "cascade",
    }),
    source: text("source").notNull(),
    signalType: text("signal_type").notNull(),
    severity: fraudAlertSeverity("severity").default("low").notNull(),
    score: integer("score").default(0).notNull(),
    rawValue: text("raw_value"),
    normalizedValue: text("normalized_value"),
    evidence: jsonb("evidence"),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("fraud_signals_user_observed_idx").on(table.userId, table.observedAt),
    index("fraud_signals_account_observed_idx").on(
      table.accountId,
      table.observedAt,
    ),
    index("fraud_signals_type_score_idx").on(table.signalType, table.score),
  ],
);

export const fraudAlerts = pgTable(
  "fraud_alerts",
  {
    id: text("id").primaryKey(),
    deduplicationKey: text("deduplication_key").notNull(),
    type: fraudAlertType("type").notNull(),
    severity: fraudAlertSeverity("severity").default("medium").notNull(),
    status: fraudAlertStatus("status").default("open").notNull(),
    score: integer("score").default(0).notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    detector: text("detector").notNull(),
    detectorVersion: text("detector_version").notNull(),
    userId: text("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    accountId: text("account_id").references(() => tradingAccounts.id, {
      onDelete: "set null",
    }),
    sessionId: text("session_id").references(() => session.id, {
      onDelete: "set null",
    }),
    competitionId: text("competition_id").references(() => competitions.id, {
      onDelete: "set null",
    }),
    leaderboardEntryId: text("leaderboard_entry_id").references(
      () => leaderboardEntries.id,
      {
        onDelete: "set null",
      },
    ),
    portfolioSnapshotId: text("portfolio_snapshot_id").references(
      () => portfolioSnapshots.id,
      {
        onDelete: "set null",
      },
    ),
    orderId: text("order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    tradeId: text("trade_id").references(() => trades.id, {
      onDelete: "set null",
    }),
    relatedAccountId: text("related_account_id").references(
      () => tradingAccounts.id,
      {
        onDelete: "set null",
      },
    ),
    relatedUserId: text("related_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    evidence: jsonb("evidence").notNull(),
    firstDetectedAt: timestamp("first_detected_at", {
      withTimezone: true,
    }).notNull(),
    lastDetectedAt: timestamp("last_detected_at", {
      withTimezone: true,
    }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    resolutionNotes: text("resolution_notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("fraud_alerts_deduplication_key_idx").on(
      table.deduplicationKey,
    ),
    index("fraud_alerts_status_severity_idx").on(table.status, table.severity),
    index("fraud_alerts_user_status_idx").on(table.userId, table.status),
    index("fraud_alerts_account_status_idx").on(table.accountId, table.status),
    index("fraud_alerts_detector_idx").on(table.detector, table.createdAt),
    index("fraud_alerts_competition_idx").on(table.competitionId),
    index("fraud_alerts_leaderboard_entry_idx").on(table.leaderboardEntryId),
    index("fraud_alerts_order_idx").on(table.orderId),
    index("fraud_alerts_trade_idx").on(table.tradeId),
  ],
);

export const accountRiskReviews = pgTable(
  "account_risk_reviews",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    accountId: text("account_id")
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "restrict" }),
    status: riskReviewStatus("status").default("pending").notNull(),
    previousRiskTier: accountRiskTier("previous_risk_tier"),
    nextRiskTier: accountRiskTier("next_risk_tier"),
    reason: text("reason").notNull(),
    evidence: jsonb("evidence").notNull(),
    reviewerUserId: text("reviewer_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("account_risk_reviews_account_created_idx").on(
      table.accountId,
      table.createdAt,
    ),
    index("account_risk_reviews_status_idx").on(table.status),
  ],
);

export const securityAuditEvents = pgTable(
  "security_audit_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    accountId: text("account_id").references(() => tradingAccounts.id, {
      onDelete: "set null",
    }),
    sessionId: text("session_id").references(() => session.id, {
      onDelete: "set null",
    }),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    deviceFingerprint: text("device_fingerprint"),
    requestId: text("request_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("security_audit_events_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("security_audit_events_account_created_idx").on(
      table.accountId,
      table.createdAt,
    ),
    index("security_audit_events_type_created_idx").on(
      table.eventType,
      table.createdAt,
    ),
    index("security_audit_events_request_idx").on(table.requestId),
  ],
);

export const fraudSignalsRelations = relations(fraudSignals, ({ one }) => ({
  user: one(user, {
    fields: [fraudSignals.userId],
    references: [user.id],
  }),
  account: one(tradingAccounts, {
    fields: [fraudSignals.accountId],
    references: [tradingAccounts.id],
  }),
}));

export const fraudAlertsRelations = relations(fraudAlerts, ({ one }) => ({
  user: one(user, {
    fields: [fraudAlerts.userId],
    references: [user.id],
  }),
  account: one(tradingAccounts, {
    fields: [fraudAlerts.accountId],
    references: [tradingAccounts.id],
  }),
  session: one(session, {
    fields: [fraudAlerts.sessionId],
    references: [session.id],
  }),
  competition: one(competitions, {
    fields: [fraudAlerts.competitionId],
    references: [competitions.id],
  }),
  leaderboardEntry: one(leaderboardEntries, {
    fields: [fraudAlerts.leaderboardEntryId],
    references: [leaderboardEntries.id],
  }),
  portfolioSnapshot: one(portfolioSnapshots, {
    fields: [fraudAlerts.portfolioSnapshotId],
    references: [portfolioSnapshots.id],
  }),
  order: one(orders, {
    fields: [fraudAlerts.orderId],
    references: [orders.id],
  }),
  trade: one(trades, {
    fields: [fraudAlerts.tradeId],
    references: [trades.id],
  }),
  resolver: one(user, {
    fields: [fraudAlerts.resolvedBy],
    references: [user.id],
  }),
  relatedAccount: one(tradingAccounts, {
    fields: [fraudAlerts.relatedAccountId],
    references: [tradingAccounts.id],
  }),
  relatedUser: one(user, {
    fields: [fraudAlerts.relatedUserId],
    references: [user.id],
  }),
}));

export const accountRiskReviewsRelations = relations(
  accountRiskReviews,
  ({ one }) => ({
    user: one(user, {
      fields: [accountRiskReviews.userId],
      references: [user.id],
    }),
    account: one(tradingAccounts, {
      fields: [accountRiskReviews.accountId],
      references: [tradingAccounts.id],
    }),
    reviewer: one(user, {
      fields: [accountRiskReviews.reviewerUserId],
      references: [user.id],
    }),
  }),
);

export const securityAuditEventsRelations = relations(
  securityAuditEvents,
  ({ one }) => ({
    user: one(user, {
      fields: [securityAuditEvents.userId],
      references: [user.id],
    }),
    account: one(tradingAccounts, {
      fields: [securityAuditEvents.accountId],
      references: [tradingAccounts.id],
    }),
    session: one(session, {
      fields: [securityAuditEvents.sessionId],
      references: [session.id],
    }),
    actor: one(user, {
      fields: [securityAuditEvents.actorUserId],
      references: [user.id],
    }),
  }),
);
