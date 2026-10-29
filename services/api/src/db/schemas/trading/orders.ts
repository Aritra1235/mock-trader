import { relations } from "drizzle-orm";
import {
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { session, user } from "../auth/auth-schema";
import { positions, tradingAccounts } from "./accounts";
import {
  orderProduct,
  orderSide,
  orderStatus,
  orderTimeInForce,
  orderType,
  tradeLiquidity,
} from "./enums";
import { instruments, marketQuotes } from "./market";

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "restrict" }),
    sessionId: text("session_id").references(() => session.id, {
      onDelete: "set null",
    }),
    clientOrderId: text("client_order_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    side: orderSide("side").notNull(),
    type: orderType("type").notNull(),
    status: orderStatus("status").default("draft").notNull(),
    timeInForce: orderTimeInForce("time_in_force").default("day").notNull(),
    product: orderProduct("product").default("delivery").notNull(),
    quantity: numeric("quantity", { precision: 24, scale: 8 }).notNull(),
    limitPrice: numeric("limit_price", { precision: 24, scale: 8 }),
    stopPrice: numeric("stop_price", { precision: 24, scale: 8 }),
    filledQuantity: numeric("filled_quantity", { precision: 24, scale: 8 })
      .default("0")
      .notNull(),
    averageFillPrice: numeric("average_fill_price", {
      precision: 24,
      scale: 8,
    }),
    notionalEstimate: numeric("notional_estimate", {
      precision: 24,
      scale: 8,
    }),
    source: text("source").default("api").notNull(),
    requestIpAddress: text("request_ip_address"),
    requestUserAgent: text("request_user_agent"),
    requestDeviceFingerprint: text("request_device_fingerprint"),
    placedAt: timestamp("placed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    rejectedReason: text("rejected_reason"),
    canceledReason: text("canceled_reason"),
    riskScore: numeric("risk_score", { precision: 8, scale: 2 })
      .default("0")
      .notNull(),
    riskSignals: jsonb("risk_signals"),
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
    uniqueIndex("orders_client_order_idx").on(
      table.accountId,
      table.clientOrderId,
    ),
    uniqueIndex("orders_account_idempotency_key_idx").on(
      table.accountId,
      table.idempotencyKey,
    ),
    index("orders_account_status_idx").on(table.accountId, table.status),
    index("orders_user_created_idx").on(table.userId, table.createdAt),
    index("orders_instrument_created_idx").on(
      table.instrumentId,
      table.createdAt,
    ),
    index("orders_session_idx").on(table.sessionId),
    index("orders_risk_score_idx").on(table.riskScore),
  ],
);

export const orderEvents = pgTable(
  "order_events",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    fromStatus: orderStatus("from_status"),
    toStatus: orderStatus("to_status"),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    message: text("message"),
    requestId: text("request_id"),
    ipAddress: text("ip_address"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("order_events_order_created_idx").on(table.orderId, table.createdAt),
    index("order_events_type_created_idx").on(table.eventType, table.createdAt),
  ],
);

export const orderReservations = pgTable(
  "order_reservations",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "restrict" }),
    reservationType: text("reservation_type").notNull(),
    status: text("status").default("active").notNull(),
    reservedMockCash: numeric("reserved_mock_cash", {
      precision: 24,
      scale: 8,
    })
      .default("0")
      .notNull(),
    reservedQuantity: numeric("reserved_quantity", { precision: 24, scale: 8 })
      .default("0")
      .notNull(),
    releasedMockCash: numeric("released_mock_cash", {
      precision: 24,
      scale: 8,
    })
      .default("0")
      .notNull(),
    releasedQuantity: numeric("released_quantity", {
      precision: 24,
      scale: 8,
    })
      .default("0")
      .notNull(),
    releaseReason: text("release_reason"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
  },
  (table) => [
    uniqueIndex("order_reservations_idempotency_key_idx").on(
      table.idempotencyKey,
    ),
    index("order_reservations_order_idx").on(table.orderId),
    index("order_reservations_account_status_idx").on(
      table.accountId,
      table.status,
    ),
    index("order_reservations_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export const trades = pgTable(
  "trades",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    accountId: text("account_id")
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "restrict" }),
    side: orderSide("side").notNull(),
    quantity: numeric("quantity", { precision: 24, scale: 8 }).notNull(),
    price: numeric("price", { precision: 24, scale: 8 }).notNull(),
    grossAmount: numeric("gross_amount", {
      precision: 24,
      scale: 8,
    }).notNull(),
    fees: numeric("fees", { precision: 24, scale: 8 }).default("0").notNull(),
    netAmount: numeric("net_amount", { precision: 24, scale: 8 }).notNull(),
    liquidity: tradeLiquidity("liquidity").default("taker").notNull(),
    counterpartyAccountId: text("counterparty_account_id").references(
      () => tradingAccounts.id,
      { onDelete: "set null" },
    ),
    marketQuoteId: text("market_quote_id").references(() => marketQuotes.id, {
      onDelete: "set null",
    }),
    priceSource: text("price_source").default("latest_quote").notNull(),
    quoteObservedAt: timestamp("quote_observed_at", { withTimezone: true }),
    executionReason: text("execution_reason").notNull(),
    executionVenue: text("execution_venue"),
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("trades_account_executed_idx").on(table.accountId, table.executedAt),
    index("trades_user_executed_idx").on(table.userId, table.executedAt),
    index("trades_instrument_executed_idx").on(
      table.instrumentId,
      table.executedAt,
    ),
    index("trades_order_idx").on(table.orderId),
    index("trades_counterparty_account_idx").on(table.counterpartyAccountId),
    index("trades_market_quote_idx").on(table.marketQuoteId),
    index("trades_price_source_idx").on(table.priceSource),
  ],
);

export const positionLots = pgTable(
  "position_lots",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "restrict" }),
    positionId: text("position_id").references(() => positions.id, {
      onDelete: "set null",
    }),
    openingTradeId: text("opening_trade_id")
      .notNull()
      .references(() => trades.id, { onDelete: "restrict" }),
    closingTradeId: text("closing_trade_id").references(() => trades.id, {
      onDelete: "set null",
    }),
    status: text("status").default("open").notNull(),
    openedQuantity: numeric("opened_quantity", {
      precision: 24,
      scale: 8,
    }).notNull(),
    remainingQuantity: numeric("remaining_quantity", {
      precision: 24,
      scale: 8,
    }).notNull(),
    costBasisPrice: numeric("cost_basis_price", {
      precision: 24,
      scale: 8,
    }).notNull(),
    costBasisAmount: numeric("cost_basis_amount", {
      precision: 24,
      scale: 8,
    }).notNull(),
    realizedPnl: numeric("realized_pnl", { precision: 24, scale: 8 })
      .default("0")
      .notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
  },
  (table) => [
    index("position_lots_account_instrument_status_idx").on(
      table.accountId,
      table.instrumentId,
      table.status,
    ),
    index("position_lots_position_status_idx").on(
      table.positionId,
      table.status,
    ),
    index("position_lots_opening_trade_idx").on(table.openingTradeId),
    index("position_lots_closing_trade_idx").on(table.closingTradeId),
  ],
);

export const ordersRelations = relations(orders, ({ many, one }) => ({
  account: one(tradingAccounts, {
    fields: [orders.accountId],
    references: [tradingAccounts.id],
  }),
  user: one(user, {
    fields: [orders.userId],
    references: [user.id],
  }),
  instrument: one(instruments, {
    fields: [orders.instrumentId],
    references: [instruments.id],
  }),
  session: one(session, {
    fields: [orders.sessionId],
    references: [session.id],
  }),
  events: many(orderEvents),
  reservations: many(orderReservations),
  trades: many(trades),
}));

export const orderEventsRelations = relations(orderEvents, ({ one }) => ({
  order: one(orders, {
    fields: [orderEvents.orderId],
    references: [orders.id],
  }),
  actor: one(user, {
    fields: [orderEvents.actorUserId],
    references: [user.id],
  }),
}));

export const orderReservationsRelations = relations(
  orderReservations,
  ({ one }) => ({
    order: one(orders, {
      fields: [orderReservations.orderId],
      references: [orders.id],
    }),
    account: one(tradingAccounts, {
      fields: [orderReservations.accountId],
      references: [tradingAccounts.id],
    }),
    user: one(user, {
      fields: [orderReservations.userId],
      references: [user.id],
    }),
    instrument: one(instruments, {
      fields: [orderReservations.instrumentId],
      references: [instruments.id],
    }),
  }),
);

export const tradesRelations = relations(trades, ({ one }) => ({
  order: one(orders, {
    fields: [trades.orderId],
    references: [orders.id],
  }),
  account: one(tradingAccounts, {
    fields: [trades.accountId],
    references: [tradingAccounts.id],
  }),
  user: one(user, {
    fields: [trades.userId],
    references: [user.id],
  }),
  instrument: one(instruments, {
    fields: [trades.instrumentId],
    references: [instruments.id],
  }),
  counterpartyAccount: one(tradingAccounts, {
    fields: [trades.counterpartyAccountId],
    references: [tradingAccounts.id],
  }),
  marketQuote: one(marketQuotes, {
    fields: [trades.marketQuoteId],
    references: [marketQuotes.id],
  }),
}));

export const positionLotsRelations = relations(positionLots, ({ one }) => ({
  account: one(tradingAccounts, {
    fields: [positionLots.accountId],
    references: [tradingAccounts.id],
  }),
  user: one(user, {
    fields: [positionLots.userId],
    references: [user.id],
  }),
  instrument: one(instruments, {
    fields: [positionLots.instrumentId],
    references: [instruments.id],
  }),
  position: one(positions, {
    fields: [positionLots.positionId],
    references: [positions.id],
  }),
  openingTrade: one(trades, {
    fields: [positionLots.openingTradeId],
    references: [trades.id],
  }),
  closingTrade: one(trades, {
    fields: [positionLots.closingTradeId],
    references: [trades.id],
  }),
}));
