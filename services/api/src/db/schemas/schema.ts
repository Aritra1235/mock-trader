import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export * from "./auth/auth-schema";
export * from "./fraud/enums";
export * from "./fraud/fraud";
export * from "./trading/accounts";
export * from "./trading/enums";
export * from "./trading/leaderboard";
export * from "./trading/market";
export * from "./trading/orders";
