import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "../auth/auth-schema";
import { tradingAccounts } from "./accounts";
import { competitionParticipantStatus, competitionStatus } from "./enums";
import { instruments, marketQuotes } from "./market";

export const competitions = pgTable(
  "competitions",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    status: competitionStatus("status").default("draft").notNull(),
    startingBalance: numeric("starting_balance", {
      precision: 24,
      scale: 8,
    })
      .default("100000")
      .notNull(),
    baseCurrency: text("base_currency").default("USD").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    allowReset: boolean("allow_reset").default(false).notNull(),
    maxResets: integer("max_resets").default(0).notNull(),
    maxDailyOrders: integer("max_daily_orders"),
    maxPositionWeightPct: numeric("max_position_weight_pct", {
      precision: 8,
      scale: 4,
    }),
    rules: jsonb("rules"),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("competitions_slug_idx").on(table.slug),
    index("competitions_status_window_idx").on(
      table.status,
      table.startsAt,
      table.endsAt,
    ),
  ],
);

export const competitionParticipants = pgTable(
  "competition_participants",
  {
    id: text("id").primaryKey(),
    competitionId: text("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "cascade" }),
    status: competitionParticipantStatus("status").default("active").notNull(),
    disqualifiedReason: text("disqualified_reason"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("competition_participants_competition_user_idx").on(
      table.competitionId,
      table.userId,
    ),
    uniqueIndex("competition_participants_account_idx").on(table.accountId),
    index("competition_participants_status_idx").on(
      table.competitionId,
      table.status,
    ),
  ],
);

export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "cascade" }),
    competitionId: text("competition_id").references(() => competitions.id, {
      onDelete: "cascade",
    }),
    mockCashBalance: numeric("mock_cash_balance", {
      precision: 24,
      scale: 8,
    }).notNull(),
    positionsValue: numeric("positions_value", {
      precision: 24,
      scale: 8,
    }).notNull(),
    equity: numeric("equity", { precision: 24, scale: 8 }).notNull(),
    realizedPnl: numeric("realized_pnl", { precision: 24, scale: 8 })
      .default("0")
      .notNull(),
    unrealizedPnl: numeric("unrealized_pnl", { precision: 24, scale: 8 })
      .default("0")
      .notNull(),
    returnPct: numeric("return_pct", { precision: 12, scale: 6 }).notNull(),
    maxDrawdownPct: numeric("max_drawdown_pct", {
      precision: 12,
      scale: 6,
    }),
    tradeCount: integer("trade_count").default(0).notNull(),
    valuationSource: text("valuation_source").default("latest_quote").notNull(),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("portfolio_snapshots_account_snapshot_idx").on(
      table.accountId,
      table.snapshotAt,
    ),
    index("portfolio_snapshots_competition_snapshot_idx").on(
      table.competitionId,
      table.snapshotAt,
    ),
    index("portfolio_snapshots_equity_idx").on(table.equity),
  ],
);

export const portfolioSnapshotPositions = pgTable(
  "portfolio_snapshot_positions",
  {
    id: text("id").primaryKey(),
    portfolioSnapshotId: text("portfolio_snapshot_id")
      .notNull()
      .references(() => portfolioSnapshots.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "cascade" }),
    competitionId: text("competition_id").references(() => competitions.id, {
      onDelete: "cascade",
    }),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "restrict" }),
    marketQuoteId: text("market_quote_id").references(() => marketQuotes.id, {
      onDelete: "set null",
    }),
    quantity: numeric("quantity", { precision: 24, scale: 8 }).notNull(),
    averageCost: numeric("average_cost", {
      precision: 24,
      scale: 8,
    }).notNull(),
    lastPrice: numeric("last_price", { precision: 24, scale: 8 }).notNull(),
    marketValue: numeric("market_value", {
      precision: 24,
      scale: 8,
    }).notNull(),
    unrealizedPnl: numeric("unrealized_pnl", {
      precision: 24,
      scale: 8,
    }).notNull(),
    weightPct: numeric("weight_pct", { precision: 12, scale: 6 }),
    valuationSource: text("valuation_source").default("latest_quote").notNull(),
    quoteObservedAt: timestamp("quote_observed_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
  },
  (table) => [
    uniqueIndex("portfolio_snapshot_positions_snapshot_instrument_idx").on(
      table.portfolioSnapshotId,
      table.instrumentId,
    ),
    index("portfolio_snapshot_positions_account_idx").on(table.accountId),
    index("portfolio_snapshot_positions_competition_idx").on(
      table.competitionId,
    ),
    index("portfolio_snapshot_positions_market_quote_idx").on(
      table.marketQuoteId,
    ),
  ],
);

export const leaderboardEntries = pgTable(
  "leaderboard_entries",
  {
    id: text("id").primaryKey(),
    competitionId: text("competition_id").references(() => competitions.id, {
      onDelete: "cascade",
    }),
    accountId: text("account_id")
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    previousRank: integer("previous_rank"),
    equity: numeric("equity", { precision: 24, scale: 8 }).notNull(),
    returnPct: numeric("return_pct", { precision: 12, scale: 6 }).notNull(),
    tradeCount: integer("trade_count").default(0).notNull(),
    riskScore: integer("risk_score").default(0).notNull(),
    eligible: boolean("eligible").default(true).notNull(),
    ineligibleReason: text("ineligible_reason"),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("leaderboard_entries_scope_account_calculated_idx").on(
      table.competitionId,
      table.accountId,
      table.calculatedAt,
    ),
    index("leaderboard_entries_scope_rank_idx").on(
      table.competitionId,
      table.rank,
    ),
    index("leaderboard_entries_user_calculated_idx").on(
      table.userId,
      table.calculatedAt,
    ),
    index("leaderboard_entries_risk_score_idx").on(table.riskScore),
  ],
);

export const competitionsRelations = relations(
  competitions,
  ({ many, one }) => ({
    creator: one(user, {
      fields: [competitions.createdBy],
      references: [user.id],
    }),
    participants: many(competitionParticipants),
    snapshots: many(portfolioSnapshots),
    snapshotPositions: many(portfolioSnapshotPositions),
    leaderboardEntries: many(leaderboardEntries),
  }),
);

export const competitionParticipantsRelations = relations(
  competitionParticipants,
  ({ one }) => ({
    competition: one(competitions, {
      fields: [competitionParticipants.competitionId],
      references: [competitions.id],
    }),
    user: one(user, {
      fields: [competitionParticipants.userId],
      references: [user.id],
    }),
    account: one(tradingAccounts, {
      fields: [competitionParticipants.accountId],
      references: [tradingAccounts.id],
    }),
  }),
);

export const portfolioSnapshotsRelations = relations(
  portfolioSnapshots,
  ({ many, one }) => ({
    account: one(tradingAccounts, {
      fields: [portfolioSnapshots.accountId],
      references: [tradingAccounts.id],
    }),
    competition: one(competitions, {
      fields: [portfolioSnapshots.competitionId],
      references: [competitions.id],
    }),
    positions: many(portfolioSnapshotPositions),
  }),
);

export const portfolioSnapshotPositionsRelations = relations(
  portfolioSnapshotPositions,
  ({ one }) => ({
    snapshot: one(portfolioSnapshots, {
      fields: [portfolioSnapshotPositions.portfolioSnapshotId],
      references: [portfolioSnapshots.id],
    }),
    account: one(tradingAccounts, {
      fields: [portfolioSnapshotPositions.accountId],
      references: [tradingAccounts.id],
    }),
    competition: one(competitions, {
      fields: [portfolioSnapshotPositions.competitionId],
      references: [competitions.id],
    }),
    instrument: one(instruments, {
      fields: [portfolioSnapshotPositions.instrumentId],
      references: [instruments.id],
    }),
    marketQuote: one(marketQuotes, {
      fields: [portfolioSnapshotPositions.marketQuoteId],
      references: [marketQuotes.id],
    }),
  }),
);

export const leaderboardEntriesRelations = relations(
  leaderboardEntries,
  ({ one }) => ({
    competition: one(competitions, {
      fields: [leaderboardEntries.competitionId],
      references: [competitions.id],
    }),
    account: one(tradingAccounts, {
      fields: [leaderboardEntries.accountId],
      references: [tradingAccounts.id],
    }),
    user: one(user, {
      fields: [leaderboardEntries.userId],
      references: [user.id],
    }),
  }),
);
