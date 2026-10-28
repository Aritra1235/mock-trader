import type { PaytmHttpClient } from "../src/providers/paytmHttpClient";
import type { MarketDataStore } from "../src/repositories/marketDataStore";
import type { SubscriptionLeaseRepository } from "../src/repositories/subscriptionLeaseRepository";
import type {
  AuthSessionResult,
  AuthSessionService,
} from "../src/services/authSessionService";
import { CatalogService } from "../src/services/catalogService";
import type { OnboardingService } from "../src/services/onboarding/onboardingService";
import type {
  CandleRecord,
  QuoteEvent,
  QuotePayload,
} from "../src/types/market";

export const sampleSecurityMaster = `"security_id","symbol","name","series","tick_size","lot_size","instrument_type","segment","exchange","upper_limit","lower_limit","expiry_date","strike_price","freeze_quantity"
"3456","RELIANCE","Reliance Industries","","0.0500","1","EQ","C","NSE","2000.0000","1000.0000","","",""
"13","NIFTY50","Nifty 50","","0.0500","1","INDEX","I","NSE","","","","",""`;

export async function makeCatalog(
  snapshotPath = "/tmp/mock-trader-catalog-test.json",
) {
  const client = {
    fetchSecurityMaster: async () => sampleSecurityMaster,
  } as unknown as PaytmHttpClient;

  const catalog = new CatalogService(client, snapshotPath, [
    "security_master.csv",
  ]);
  await catalog.syncFromProvider();
  return catalog;
}

export class InMemoryStore implements MarketDataStore {
  latest = new Map<string, QuotePayload>();
  candles = new Map<string, CandleRecord[]>();
  handler: ((event: QuoteEvent) => void | Promise<void>) | null = null;

  async ping() {
    return true;
  }

  async saveLatestQuote(quote: QuotePayload) {
    this.latest.set(quote.instrumentKey, quote);
  }

  async getLatestQuote(instrumentKey: string) {
    return this.latest.get(instrumentKey) ?? null;
  }

  async getLatestQuotes(instrumentKeys: string[]) {
    return Object.fromEntries(
      instrumentKeys.flatMap((key) => {
        const quote = this.latest.get(key);
        return quote ? [[key, quote]] : [];
      }),
    );
  }

  async saveCandle(instrumentKey: string, candle: CandleRecord) {
    const bucket = this.candles.get(instrumentKey) ?? [];
    const existingIndex = bucket.findIndex(
      (entry) => entry.bucketStart === candle.bucketStart,
    );
    if (existingIndex >= 0) {
      bucket[existingIndex] = candle;
    } else {
      bucket.push(candle);
    }
    bucket.sort((left, right) => left.bucketStart - right.bucketStart);
    this.candles.set(instrumentKey, bucket);
  }

  async listCandles(
    instrumentKey: string,
    fromMs: number,
    toMs: number,
    limit: number,
  ) {
    return (this.candles.get(instrumentKey) ?? [])
      .filter(
        (candle) => candle.bucketStart >= fromMs && candle.bucketStart <= toMs,
      )
      .slice(0, limit);
  }

  async publishQuoteEvent(event: QuoteEvent) {
    await this.saveLatestQuote(event.quote);
    if (this.handler) {
      await this.handler(event);
    }
  }

  async subscribeToQuoteEvents(
    handler: (event: QuoteEvent) => void | Promise<void>,
  ) {
    this.handler = handler;
  }

  async disconnect() {}
}

export class InMemoryLeases implements SubscriptionLeaseRepository {
  leases = new Map<string, Map<string, number>>();
  published: string[] = [];

  async ping() {
    return true;
  }

  async addLease(subscriptionKey: string, member: string, expiresAt: number) {
    const bucket =
      this.leases.get(subscriptionKey) ?? new Map<string, number>();
    bucket.set(member, expiresAt);
    this.leases.set(subscriptionKey, bucket);
    return bucket.size;
  }

  async refreshLeases(
    subscriptionKeys: string[],
    member: string,
    expiresAt: number,
  ) {
    for (const key of subscriptionKeys) {
      const bucket = this.leases.get(key);
      if (bucket?.has(member)) {
        bucket.set(member, expiresAt);
      }
    }
  }

  async removeLease(subscriptionKey: string, member: string) {
    const bucket =
      this.leases.get(subscriptionKey) ?? new Map<string, number>();
    bucket.delete(member);
    if (bucket.size === 0) {
      this.leases.delete(subscriptionKey);
      return 0;
    }
    return bucket.size;
  }

  async sweepExpired(now: number) {
    const expired: string[] = [];
    for (const [key, bucket] of this.leases.entries()) {
      for (const [member, expiresAt] of bucket.entries()) {
        if (expiresAt <= now) {
          bucket.delete(member);
        }
      }
      if (bucket.size === 0) {
        this.leases.delete(key);
        expired.push(key);
      }
    }
    return expired;
  }

  async publishControl(message: string) {
    this.published.push(message);
  }

  async disconnect() {}
}

/** Onboarding stub: users in `completeUsers` count as onboarded. */
export class FakeOnboardingService implements OnboardingService {
  calls: unknown[][] = [];

  constructor(readonly completeUsers = new Set<string>()) {}

  async isComplete(userId: string) {
    return this.completeUsers.has(userId);
  }

  async summary(userId: string) {
    const complete = this.completeUsers.has(userId);
    return {
      complete,
      currentStep: complete ? null : ("profile" as const),
      watchlist: [],
    };
  }

  private record(name: string, userId: string, input?: unknown) {
    this.calls.push(
      input === undefined ? [name, userId] : [name, userId, input],
    );
    return { complete: this.completeUsers.has(userId) } as never;
  }

  async getState(userId: string) {
    return this.record("getState", userId);
  }
  async saveProfile(userId: string, input: unknown) {
    return this.record("saveProfile", userId, input);
  }
  async saveExperience(userId: string, input: unknown) {
    return this.record("saveExperience", userId, input);
  }
  async savePreferences(userId: string, input: unknown) {
    return this.record("savePreferences", userId, input);
  }
  async saveWatchlist(userId: string, input: unknown) {
    return this.record("saveWatchlist", userId, input);
  }
  async acceptAgreements(userId: string, input: unknown) {
    return this.record("acceptAgreements", userId, input);
  }
  async complete(userId: string) {
    this.completeUsers.add(userId);
    return this.record("complete", userId);
  }
}

/** Auth stub that always returns the given user (or no session). */
export class FakeAuthSessionService implements AuthSessionService {
  constructor(private readonly userId: string | null) {}

  async getSession(): Promise<AuthSessionResult | null> {
    if (!this.userId) return null;
    return {
      user: { id: this.userId, role: "user", banned: false },
      session: { id: "session-1" },
    };
  }
}
