import { relations } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { instrumentStatus, instrumentType } from "./enums";

export const instruments = pgTable(
  "instruments",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    exchange: text("exchange").notNull(),
    name: text("name").notNull(),
    type: instrumentType("type").notNull(),
    status: instrumentStatus("status").default("active").notNull(),
    currency: text("currency").default("INR").notNull(),
    securityId: text("security_id"),
    isin: text("isin"),
    lotSize: integer("lot_size").default(1).notNull(),
    tickSize: numeric("tick_size", { precision: 20, scale: 8 }),
    priceBand: jsonb("price_band"),
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
    uniqueIndex("instruments_exchange_symbol_idx").on(
      table.exchange,
      table.symbol,
    ),
    index("instruments_security_id_idx").on(table.securityId),
    index("instruments_type_status_idx").on(table.type, table.status),
  ],
);

export const marketQuotes = pgTable(
  "market_quotes",
  {
    id: text("id").primaryKey(),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    bidPrice: numeric("bid_price", { precision: 20, scale: 8 }),
    askPrice: numeric("ask_price", { precision: 20, scale: 8 }),
    lastPrice: numeric("last_price", { precision: 20, scale: 8 }),
    dayVolume: bigint("day_volume", { mode: "number" }),
    providerSequence: text("provider_sequence"),
    rawPayload: jsonb("raw_payload"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("market_quotes_instrument_observed_idx").on(
      table.instrumentId,
      table.observedAt,
    ),
    index("market_quotes_source_observed_idx").on(
      table.source,
      table.observedAt,
    ),
  ],
);

export const instrumentsRelations = relations(instruments, ({ many }) => ({
  quotes: many(marketQuotes),
}));

export const marketQuotesRelations = relations(marketQuotes, ({ one }) => ({
  instrument: one(instruments, {
    fields: [marketQuotes.instrumentId],
    references: [instruments.id],
  }),
}));
