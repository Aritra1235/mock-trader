import { relations, sql } from "drizzle-orm";
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
import {
  accountRiskTier,
  accountStatus,
  accountType,
  ledgerEntryStatus,
  ledgerEntryType,
} from "./enums";
import { instruments } from "./market";

export const tradingAccounts = pgTable(
  "trading_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountNumber: text("account_number").notNull(),
    type: accountType("type").default("practice").notNull(),
    status: accountStatus("status").default("active").notNull(),
    baseCurrency: text("base_currency").default("INR").notNull(),
    startingBalance: numeric("starting_balance", { precision: 24, scale: 8 })
      .default("1000000")
      .notNull(),
    mockCashBalance: numeric("mock_cash_balance", { precision: 24, scale: 8 })
      .default("1000000")
      .notNull(),
    mockBuyingPower: numeric("mock_buying_power", { precision: 24, scale: 8 })
      .default("1000000")
      .notNull(),
    reservedMockCash: numeric("reserved_mock_cash", { precision: 24, scale: 8 })
      .default("0")
      .notNull(),
    dayTradeCount: integer("day_trade_count").default(0).notNull(),
    resetCount: integer("reset_count").default(0).notNull(),
    leaderboardEligible: boolean("leaderboard_eligible")
      .default(true)
      .notNull(),
    riskTier: accountRiskTier("risk_tier").default("low").notNull(),
    restrictionReason: text("restriction_reason"),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("trading_accounts_account_number_idx").on(table.accountNumber),
    uniqueIndex("trading_accounts_one_practice_per_user_idx")
      .on(table.userId)
      .where(sql`${table.type} = 'practice'`),
    index("trading_accounts_user_status_idx").on(table.userId, table.status),
    index("trading_accounts_risk_tier_idx").on(table.riskTier),
    index("trading_accounts_leaderboard_eligible_idx").on(
      table.leaderboardEligible,
    ),
  ],
);

export const trustedDevices = pgTable(
  "trusted_devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    fingerprintHash: text("fingerprint_hash").notNull(),
    ipHash: text("ip_hash"),
    userAgentHash: text("user_agent_hash"),
    trustScore: integer("trust_score").default(0).notNull(),
    riskSignals: jsonb("risk_signals"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
  },
  (table) => [
    uniqueIndex("trusted_devices_user_fingerprint_idx").on(
      table.userId,
      table.fingerprintHash,
    ),
    index("trusted_devices_fingerprint_idx").on(table.fingerprintHash),
    index("trusted_devices_trust_score_idx").on(table.trustScore),
  ],
);

export const positions = pgTable(
  "positions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "cascade" }),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "restrict" }),
    quantity: numeric("quantity", { precision: 24, scale: 8 })
      .default("0")
      .notNull(),
    availableQuantity: numeric("available_quantity", {
      precision: 24,
      scale: 8,
    })
      .default("0")
      .notNull(),
    averageCost: numeric("average_cost", { precision: 24, scale: 8 })
      .default("0")
      .notNull(),
    realizedPnl: numeric("realized_pnl", { precision: 24, scale: 8 })
      .default("0")
      .notNull(),
    unrealizedPnl: numeric("unrealized_pnl", { precision: 24, scale: 8 })
      .default("0")
      .notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("positions_account_instrument_idx").on(
      table.accountId,
      table.instrumentId,
    ),
    index("positions_instrument_idx").on(table.instrumentId),
  ],
);

export const mockCashLedgerEntries = pgTable(
  "mock_cash_ledger_entries",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    type: ledgerEntryType("type").notNull(),
    status: ledgerEntryStatus("status").default("pending").notNull(),
    amount: numeric("amount", { precision: 24, scale: 8 }).notNull(),
    currency: text("currency").default("INR").notNull(),
    balanceAfter: numeric("balance_after", { precision: 24, scale: 8 }),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    description: text("description"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
  },
  (table) => [
    uniqueIndex("mock_cash_ledger_entries_idempotency_key_idx").on(
      table.idempotencyKey,
    ),
    index("mock_cash_ledger_entries_account_occurred_idx").on(
      table.accountId,
      table.occurredAt,
    ),
    index("mock_cash_ledger_entries_reference_idx").on(
      table.referenceType,
      table.referenceId,
    ),
  ],
);

export const tradingAccountsRelations = relations(
  tradingAccounts,
  ({ many, one }) => ({
    user: one(user, {
      fields: [tradingAccounts.userId],
      references: [user.id],
    }),
    positions: many(positions),
    mockCashLedgerEntries: many(mockCashLedgerEntries),
  }),
);

export const trustedDevicesRelations = relations(trustedDevices, ({ one }) => ({
  user: one(user, {
    fields: [trustedDevices.userId],
    references: [user.id],
  }),
}));

export const positionsRelations = relations(positions, ({ one }) => ({
  account: one(tradingAccounts, {
    fields: [positions.accountId],
    references: [tradingAccounts.id],
  }),
  instrument: one(instruments, {
    fields: [positions.instrumentId],
    references: [instruments.id],
  }),
}));

export const mockCashLedgerEntriesRelations = relations(
  mockCashLedgerEntries,
  ({ one }) => ({
    account: one(tradingAccounts, {
      fields: [mockCashLedgerEntries.accountId],
      references: [tradingAccounts.id],
    }),
    user: one(user, {
      fields: [mockCashLedgerEntries.userId],
      references: [user.id],
    }),
  }),
);
