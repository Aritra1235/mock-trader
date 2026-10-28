import { eq } from "drizzle-orm";
import { type Database, db } from "../../db";
import { tradingAccounts, user, userOnboarding } from "../../db/schemas/schema";
import type { InstrumentRecord } from "../../types/market";
import type { CatalogService } from "../catalogService";
import {
  HttpError,
  type MockTradingService,
  type RequestContext,
} from "../trading/mockTradingService";
import {
  ONBOARDING_OPTIONS,
  ONBOARDING_STEPS,
  type OnboardingStepId,
  SUGGESTED_SYMBOLS,
  TERMS,
} from "./onboardingOptions";

type OnboardingRow = typeof userOnboarding.$inferSelect;

export interface ProfileInput {
  fullName: string;
  dateOfBirth: string;
  phone?: string | null;
  city: string;
  state: string;
  occupation: string;
}

export interface ExperienceInput {
  experienceLevel: string;
  instrumentsTraded: string[];
  tradingStyle: string;
}

export interface PreferencesInput {
  tradingGoals: string[];
  riskAppetite: string;
  startingCapital: number;
}

export interface WatchlistInput {
  instrumentIds: string[];
}

export interface AgreementsInput {
  termsVersion: string;
  acceptTerms: boolean;
  acceptRiskDisclosure: boolean;
}

export interface OnboardingService {
  /** True once the user has finished onboarding and owns a practice account. */
  isComplete(userId: string): Promise<boolean>;
  getState(userId: string): Promise<OnboardingState>;
  saveProfile(userId: string, input: unknown): Promise<OnboardingState>;
  saveExperience(userId: string, input: unknown): Promise<OnboardingState>;
  savePreferences(userId: string, input: unknown): Promise<OnboardingState>;
  saveWatchlist(userId: string, input: unknown): Promise<OnboardingState>;
  acceptAgreements(
    userId: string,
    input: unknown,
    context: RequestContext,
  ): Promise<OnboardingState>;
  complete(userId: string): Promise<OnboardingState>;
  summary(userId: string): Promise<OnboardingSummary>;
}

export interface OnboardingSummary {
  complete: boolean;
  currentStep: OnboardingStepId | null;
  watchlist: unknown[];
}

export type OnboardingState = Awaited<
  ReturnType<DrizzleOnboardingService["getState"]>
>;

export const MIN_AGE = 18;
const MAX_WATCHLIST = 20;

export class DrizzleOnboardingService implements OnboardingService {
  // Completion is permanent, so a positive answer can be cached for the life
  // of the process; it keeps the per-request guard off the database.
  private readonly completed = new Set<string>();

  constructor(
    private readonly catalog: CatalogService,
    private readonly trading: MockTradingService,
    private readonly database: Database = db,
  ) {}

  async isComplete(userId: string) {
    if (this.completed.has(userId)) return true;
    const [row] = await this.database
      .select({ status: userOnboarding.status })
      .from(userOnboarding)
      .where(eq(userOnboarding.userId, userId))
      .limit(1);
    const done = row?.status === "completed";
    if (done) this.completed.add(userId);
    return done;
  }

  async getState(userId: string) {
    const profile = await this.requireVerifiedUser(userId);
    const row = await this.readRow(userId);
    // Users who opened an account before onboarding existed keep it; the
    // capital choice doesn't apply to them.
    const [existing] = await this.database
      .select({
        accountNumber: tradingAccounts.accountNumber,
        startingBalance: tradingAccounts.startingBalance,
      })
      .from(tradingAccounts)
      .where(eq(tradingAccounts.userId, userId))
      .limit(1);
    const steps = ONBOARDING_STEPS.map((step) => ({
      ...step,
      complete: stepComplete(step.id, row),
    }));
    const completed = row?.status === "completed";
    return {
      status: completed ? ("completed" as const) : ("in_progress" as const),
      complete: completed,
      emailVerified: profile.emailVerified,
      currentStep: completed
        ? null
        : (steps.find((step) => !step.complete)?.id ?? "review"),
      steps,
      completedAt: row?.completedAt?.toISOString() ?? null,
      existingAccount: existing
        ? {
            accountNumber: existing.accountNumber,
            startingBalance: Number(existing.startingBalance),
          }
        : null,
      data: {
        fullName: row?.fullName ?? profile.name ?? "",
        email: profile.email,
        dateOfBirth: row?.dateOfBirth ?? null,
        phone: row?.phone ?? null,
        city: row?.city ?? null,
        state: row?.state ?? null,
        occupation: row?.occupation ?? null,
        experienceLevel: row?.experienceLevel ?? null,
        instrumentsTraded: row?.instrumentsTraded ?? [],
        tradingStyle: row?.tradingStyle ?? null,
        tradingGoals: row?.tradingGoals ?? [],
        riskAppetite: row?.riskAppetite ?? null,
        startingCapital:
          row?.startingCapital == null ? null : Number(row.startingCapital),
        watchlist: this.instrumentsFor(row?.watchlist ?? []),
        termsVersion: row?.termsVersion ?? null,
        termsAcceptedAt: row?.termsAcceptedAt?.toISOString() ?? null,
        riskDisclosureAcceptedAt:
          row?.riskDisclosureAcceptedAt?.toISOString() ?? null,
      },
      options: {
        ...ONBOARDING_OPTIONS,
        minimumAge: MIN_AGE,
        maxWatchlist: MAX_WATCHLIST,
        suggestedInstruments: this.suggestedInstruments(),
        terms: TERMS,
      },
    };
  }

  async saveProfile(userId: string, body: unknown) {
    const input = parseProfile(body);
    await this.update(userId, {
      fullName: input.fullName,
      dateOfBirth: input.dateOfBirth,
      phone: input.phone ?? null,
      city: input.city,
      state: input.state,
      occupation: input.occupation,
    });
    return this.getState(userId);
  }

  async saveExperience(userId: string, body: unknown) {
    const input = parseExperience(body);
    await this.update(userId, input);
    return this.getState(userId);
  }

  async savePreferences(userId: string, body: unknown) {
    const input = parsePreferences(body);
    await this.update(userId, {
      tradingGoals: input.tradingGoals,
      riskAppetite: input.riskAppetite,
      startingCapital: input.startingCapital.toFixed(8),
    });
    return this.getState(userId);
  }

  async saveWatchlist(userId: string, body: unknown) {
    const input = objectBody(body);
    const ids = stringArray(input.instrumentIds, "instrumentIds");
    if (ids.length === 0) {
      throw invalid("Pick at least one instrument for your watchlist.");
    }
    if (ids.length > MAX_WATCHLIST) {
      throw invalid(`Pick at most ${MAX_WATCHLIST} instruments.`);
    }
    const keys: string[] = [];
    for (const id of ids) {
      const instrument = this.catalog.resolve(id);
      if (!instrument) {
        throw new HttpError(
          422,
          "INSTRUMENT_NOT_FOUND",
          `Instrument ${id} was not found.`,
        );
      }
      if (!keys.includes(instrument.instrumentKey)) {
        keys.push(instrument.instrumentKey);
      }
    }
    await this.update(userId, { watchlist: keys });
    return this.getState(userId);
  }

  async acceptAgreements(
    userId: string,
    body: unknown,
    context: RequestContext,
  ) {
    const input = objectBody(body);
    if (input.termsVersion !== TERMS.version) {
      throw new HttpError(
        409,
        "TERMS_VERSION_MISMATCH",
        "The terms have changed. Reload and review the latest version.",
      );
    }
    if (input.acceptTerms !== true || input.acceptRiskDisclosure !== true) {
      throw invalid(
        "Accept both the terms of use and the risk disclosure to continue.",
      );
    }
    const now = new Date();
    await this.update(userId, {
      termsVersion: TERMS.version,
      termsAcceptedAt: now,
      riskDisclosureAcceptedAt: now,
      acceptanceIpAddress: context.ipAddress ?? null,
      acceptanceUserAgent: context.userAgent ?? null,
    });
    return this.getState(userId);
  }

  async complete(userId: string) {
    await this.requireVerifiedUser(userId);
    const row = await this.readRow(userId);
    if (row?.status === "completed") {
      this.completed.add(userId);
      return this.getState(userId);
    }
    const missing = ONBOARDING_STEPS.filter(
      (step) => step.id !== "review" && !stepComplete(step.id, row),
    );
    if (!row || missing.length > 0) {
      throw new HttpError(
        409,
        "ONBOARDING_INCOMPLETE",
        `Finish these steps first: ${missing.map((step) => step.title).join(", ")}.`,
      );
    }

    // An account that already exists (from before onboarding was required)
    // is kept as is; otherwise it's opened with the chosen virtual capital.
    await this.trading.ensurePracticeAccount(userId, {
      startingBalance: Number(row.startingCapital),
    });
    await this.database
      .update(userOnboarding)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(userOnboarding.userId, userId));
    this.completed.add(userId);
    return this.getState(userId);
  }

  /** The slice of onboarding state that /me returns. */
  async summary(userId: string) {
    const row = await this.readRow(userId);
    const complete = row?.status === "completed";
    if (complete) this.completed.add(userId);
    return {
      complete,
      currentStep: complete
        ? null
        : (ONBOARDING_STEPS.find((step) => !stepComplete(step.id, row))?.id ??
          "review"),
      // Seeds the watchlist on devices that don't have one yet.
      watchlist: this.instrumentsFor(row?.watchlist ?? []),
    };
  }

  private instrumentsFor(keys: string[]) {
    return keys
      .map((key) => this.catalog.resolve(key))
      .filter((item): item is InstrumentRecord => item !== null)
      .map(publicInstrument);
  }

  private suggestedInstruments() {
    return SUGGESTED_SYMBOLS.map((symbol) => {
      const match = this.catalog
        .search({ q: symbol, exchange: "NSE", scripType: "EQUITY", limit: 10 })
        .find((item) => item.symbol === symbol);
      return match ? publicInstrument(match) : null;
    }).filter((item) => item !== null);
  }

  private async requireVerifiedUser(userId: string) {
    const [profile] = await this.database
      .select()
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!profile) {
      throw new HttpError(404, "USER_NOT_FOUND", "User was not found.");
    }
    if (!profile.emailVerified) {
      throw new HttpError(
        403,
        "EMAIL_NOT_VERIFIED",
        "Verify your email before starting onboarding.",
      );
    }
    return profile;
  }

  private async readRow(userId: string) {
    const [row] = await this.database
      .select()
      .from(userOnboarding)
      .where(eq(userOnboarding.userId, userId))
      .limit(1);
    return row;
  }

  private async update(
    userId: string,
    values: Partial<typeof userOnboarding.$inferInsert>,
  ) {
    await this.requireVerifiedUser(userId);
    const row = await this.readRow(userId);
    if (row?.status === "completed") {
      throw new HttpError(
        409,
        "ONBOARDING_COMPLETED",
        "Onboarding is already complete.",
      );
    }
    await this.database
      .insert(userOnboarding)
      .values({ userId, ...values })
      .onConflictDoUpdate({
        target: userOnboarding.userId,
        set: { ...values, updatedAt: new Date() },
      });
  }
}

export function stepComplete(
  step: OnboardingStepId,
  row: OnboardingRow | undefined,
) {
  if (!row) return false;
  switch (step) {
    case "profile":
      return Boolean(
        row.fullName &&
          row.dateOfBirth &&
          row.city &&
          row.state &&
          row.occupation,
      );
    case "experience":
      return Boolean(row.experienceLevel && row.tradingStyle);
    case "preferences":
      return Boolean(
        row.tradingGoals?.length && row.riskAppetite && row.startingCapital,
      );
    case "watchlist":
      return Boolean(row.watchlist?.length);
    case "agreements":
      return Boolean(
        row.termsVersion === TERMS.version &&
          row.termsAcceptedAt &&
          row.riskDisclosureAcceptedAt,
      );
    case "review":
      return row.status === "completed";
  }
}

// --- validation ------------------------------------------------------------

const valuesOf = (list: readonly { value: string }[]) =>
  list.map((item) => item.value);

export function parseProfile(body: unknown): ProfileInput {
  const input = objectBody(body);
  const fullName = text(input.fullName, "Full name", 2, 80);
  if (!/^[\p{L}][\p{L} .'-]*$/u.test(fullName)) {
    throw invalid(
      "Use letters, spaces, dots, apostrophes or hyphens in your name.",
    );
  }
  const dateOfBirth = text(input.dateOfBirth, "Date of birth", 10, 10);
  const age = ageOn(dateOfBirth, new Date());
  if (age === null) throw invalid("Enter a valid date of birth.");
  if (age < MIN_AGE) {
    throw invalid(`You must be at least ${MIN_AGE} to open an account.`);
  }
  if (age > 110) throw invalid("Enter a valid date of birth.");

  let phone: string | null = null;
  if (input.phone !== undefined && input.phone !== null && input.phone !== "") {
    const digits = String(input.phone)
      .replace(/[\s-]/g, "")
      .replace(/^(\+91|91|0)(?=\d{10}$)/, "");
    if (!/^[6-9]\d{9}$/.test(digits)) {
      throw invalid("Enter a valid 10-digit Indian mobile number.");
    }
    phone = `+91${digits}`;
  }

  return {
    fullName: fullName.replace(/\s+/g, " "),
    dateOfBirth,
    phone,
    city: text(input.city, "City", 2, 60),
    state: oneOf(input.state, ONBOARDING_OPTIONS.states, "State"),
    occupation: oneOf(
      input.occupation,
      valuesOf(ONBOARDING_OPTIONS.occupations),
      "Occupation",
    ),
  };
}

export function parseExperience(body: unknown): ExperienceInput {
  const input = objectBody(body);
  const experienceLevel = oneOf(
    input.experienceLevel,
    valuesOf(ONBOARDING_OPTIONS.experienceLevels),
    "Experience",
  );
  const instrumentsTraded = subsetOf(
    input.instrumentsTraded ?? [],
    valuesOf(ONBOARDING_OPTIONS.instruments),
    "Instruments traded",
  );
  if (experienceLevel !== "none" && instrumentsTraded.length === 0) {
    throw invalid("Pick the instruments you have traded before.");
  }
  return {
    experienceLevel,
    instrumentsTraded: experienceLevel === "none" ? [] : instrumentsTraded,
    tradingStyle: oneOf(
      input.tradingStyle,
      valuesOf(ONBOARDING_OPTIONS.tradingStyles),
      "Trading style",
    ),
  };
}

export function parsePreferences(body: unknown): PreferencesInput {
  const input = objectBody(body);
  const tradingGoals = subsetOf(
    input.tradingGoals,
    valuesOf(ONBOARDING_OPTIONS.goals),
    "Goals",
  );
  if (tradingGoals.length === 0) throw invalid("Pick at least one goal.");
  const startingCapital = Number(input.startingCapital);
  if (
    !ONBOARDING_OPTIONS.startingCapitals.some(
      (option) => option.value === startingCapital,
    )
  ) {
    throw invalid("Choose one of the offered starting capitals.");
  }
  return {
    tradingGoals,
    riskAppetite: oneOf(
      input.riskAppetite,
      valuesOf(ONBOARDING_OPTIONS.riskAppetites),
      "Risk appetite",
    ),
    startingCapital,
  };
}

/** Whole years between a YYYY-MM-DD birth date and `today`, or null if invalid. */
export function ageOn(dateOfBirth: string, today: Date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number) as [
    number,
    number,
    number,
  ];
  const born = new Date(Date.UTC(year, month - 1, day));
  if (
    born.getUTCFullYear() !== year ||
    born.getUTCMonth() !== month - 1 ||
    born.getUTCDate() !== day ||
    born > today
  ) {
    return null;
  }
  let age = today.getUTCFullYear() - year;
  const beforeBirthday =
    today.getUTCMonth() + 1 < month ||
    (today.getUTCMonth() + 1 === month && today.getUTCDate() < day);
  if (beforeBirthday) age -= 1;
  return age;
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid("JSON object body is required.");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, min: number, max: number) {
  const result = typeof value === "string" ? value.trim() : "";
  if (result.length < min || result.length > max) {
    throw invalid(
      min === max
        ? `${label} is required.`
        : `${label} must be ${min}–${max} characters.`,
    );
  }
  return result;
}

function oneOf(value: unknown, allowed: readonly string[], label: string) {
  if (typeof value === "string" && allowed.includes(value)) return value;
  throw invalid(`Choose a valid ${label.toLowerCase()}.`);
}

function subsetOf(value: unknown, allowed: readonly string[], label: string) {
  const items = stringArray(value, label);
  for (const item of items) {
    if (!allowed.includes(item)) {
      throw invalid(`${label} contains an unknown option: ${item}.`);
    }
  }
  return [...new Set(items)];
}

function stringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw invalid(`${label} must be a list.`);
  }
  return value as string[];
}

function invalid(message: string) {
  return new HttpError(422, "INVALID_ONBOARDING", message);
}

function publicInstrument(item: InstrumentRecord) {
  return {
    instrumentKey: item.instrumentKey,
    symbol: item.symbol,
    name: item.name,
    exchange: item.exchange,
    scripType: item.scripType,
    lotSize: item.lotSize,
    tickSize: item.tickSize,
  };
}
