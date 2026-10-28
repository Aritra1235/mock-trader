import {
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "../auth/auth-schema";

export const onboardingStatus = pgEnum("onboarding_status", [
  "in_progress",
  "completed",
]);

/**
 * One row per user, filled in step by step. A user can't reach accounts,
 * orders or market data until status is "completed".
 */
export const userOnboarding = pgTable(
  "user_onboarding",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    status: onboardingStatus("status").default("in_progress").notNull(),
    fullName: text("full_name"),
    dateOfBirth: date("date_of_birth"),
    phone: text("phone"),
    city: text("city"),
    state: text("state"),
    occupation: text("occupation"),
    experienceLevel: text("experience_level"),
    instrumentsTraded: jsonb("instruments_traded").$type<string[]>(),
    tradingStyle: text("trading_style"),
    tradingGoals: jsonb("trading_goals").$type<string[]>(),
    riskAppetite: text("risk_appetite"),
    startingCapital: numeric("starting_capital", { precision: 24, scale: 8 }),
    watchlist: jsonb("watchlist").$type<string[]>(),
    termsVersion: text("terms_version"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    riskDisclosureAcceptedAt: timestamp("risk_disclosure_accepted_at", {
      withTimezone: true,
    }),
    acceptanceIpAddress: text("acceptance_ip_address"),
    acceptanceUserAgent: text("acceptance_user_agent"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("user_onboarding_status_idx").on(table.status)],
);
