import { CatalogService } from "../src/services/catalogService";
import { PaytmHttpClient } from "../src/providers/paytmHttpClient";
import type { MarketDataStore } from "../src/repositories/marketDataStore";
import type {
  CandleRecord,
  QuoteEvent,
  QuotePayload,
} from "../src/types/market";
import type { SubscriptionLeaseRepository } from "../src/repositories/subscriptionLeaseRepository";

export const sampleSecurityMaster = `"security_id","symbol","name","series","tick_size","lot_size","instrument_type","segment","exchange","upper_limit","lower_limit","expiry_date","strike_price","freeze_quantity"
"3456","RELIANCE","Reliance Industries","","0.0500","1","EQ","C","NSE","2000.0000","1000.0000","","",""
"13","NIFTY50","Nifty 50","","0.0500","1","INDEX","I","NSE","","","","",""`;

export async function makeCatalog(snapshotPath = "/tmp/mock-trader-catalog-test.json") {
  const client = {
    fetchSecurityMaster: async () => sampleSecurityMaster,
  } as unknown as PaytmHttpClient;

  const catalog = new CatalogService(client, snapshotPath, ["security_master.csv"]);
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
      })
    );
  }

  async saveCandle(instrumentKey: string, candle: CandleRecord) {
    const bucket = this.candles.get(instrumentKey) ?? [];
    const existingIndex = bucket.findIndex((entry) => entry.bucketStart === candle.bucketStart);
    if (existingIndex >= 0) {
      bucket[existingIndex] = candle;
    } else {
      bucket.push(candle);
    }
    bucket.sort((left, right) => left.bucketStart - right.bucketStart);
    this.candles.set(instrumentKey, bucket);
  }

  async listCandles(instrumentKey: string, fromMs: number, toMs: number, limit: number) {
    return (this.candles.get(instrumentKey) ?? [])
      .filter((candle) => candle.bucketStart >= fromMs && candle.bucketStart <= toMs)
      .slice(0, limit);
  }

  async publishQuoteEvent(event: QuoteEvent) {
    await this.saveLatestQuote(event.quote);
    if (this.handler) {
      await this.handler(event);
    }
  }

  async subscribeToQuoteEvents(handler: (event: QuoteEvent) => void | Promise<void>) {
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
    const bucket = this.leases.get(subscriptionKey) ?? new Map<string, number>();
    bucket.set(member, expiresAt);
    this.leases.set(subscriptionKey, bucket);
    return bucket.size;
  }

  async refreshLeases(subscriptionKeys: string[], member: string, expiresAt: number) {
    for (const key of subscriptionKeys) {
      const bucket = this.leases.get(key);
      if (bucket?.has(member)) {
        bucket.set(member, expiresAt);
      }
    }
  }

  async removeLease(subscriptionKey: string, member: string) {
    const bucket = this.leases.get(subscriptionKey) ?? new Map<string, number>();
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
