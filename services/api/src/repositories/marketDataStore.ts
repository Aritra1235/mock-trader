import { createClient, type RedisClientType } from "redis";
import type { CandleRecord, QuoteEvent, QuotePayload } from "../types/market";

export interface MarketDataStore {
  ping(): Promise<boolean>;
  saveLatestQuote(quote: QuotePayload): Promise<void>;
  getLatestQuote(instrumentKey: string): Promise<QuotePayload | null>;
  getLatestQuotes(instrumentKeys: string[]): Promise<Record<string, QuotePayload>>;
  saveCandle(instrumentKey: string, candle: CandleRecord): Promise<void>;
  listCandles(
    instrumentKey: string,
    fromMs: number,
    toMs: number,
    limit: number
  ): Promise<CandleRecord[]>;
  publishQuoteEvent(event: QuoteEvent): Promise<void>;
  subscribeToQuoteEvents(handler: (event: QuoteEvent) => void | Promise<void>): Promise<void>;
  disconnect(): Promise<void>;
}

export interface MarketDataStoreOptions {
  url: string;
  database: number;
  latestQuotePrefix: string;
  candlePrefix: string;
  quoteEventsChannel: string;
  candleRetentionMs: number;
}

export class RedisMarketDataStore implements MarketDataStore {
  private readonly commandClient: RedisClientType;
  private readonly subscriberClient: RedisClientType;

  constructor(private readonly options: MarketDataStoreOptions) {
    this.commandClient = createClient({
      url: options.url,
      database: options.database,
    });
    this.subscriberClient = this.commandClient.duplicate();
    this.commandClient.on("error", (error) =>
      console.error("Redis market store error", error)
    );
    this.subscriberClient.on("error", (error) =>
      console.error("Redis market subscriber error", error)
    );
  }

  async connect() {
    if (!this.commandClient.isOpen) {
      await this.commandClient.connect();
    }
    if (!this.subscriberClient.isOpen) {
      await this.subscriberClient.connect();
    }
  }

  async ping() {
    return (await this.commandClient.ping()) === "PONG";
  }

  async saveLatestQuote(quote: QuotePayload) {
    await this.commandClient.set(
      this.latestQuoteKey(quote.instrumentKey),
      JSON.stringify(quote)
    );
  }

  async getLatestQuote(instrumentKey: string) {
    const raw = await this.commandClient.get(this.latestQuoteKey(instrumentKey));
    return raw ? (JSON.parse(raw) as QuotePayload) : null;
  }

  async getLatestQuotes(instrumentKeys: string[]) {
    if (instrumentKeys.length === 0) {
      return {};
    }

    const values = await this.commandClient.mGet(
      instrumentKeys.map((key) => this.latestQuoteKey(key))
    );

    return Object.fromEntries(
      instrumentKeys.flatMap((key, index) => {
        const value = values[index];
        return value ? [[key, JSON.parse(value) as QuotePayload]] : [];
      })
    );
  }

  async saveCandle(instrumentKey: string, candle: CandleRecord) {
    const key = this.candleKey(instrumentKey);
    const cutoff = candle.bucketStart - this.options.candleRetentionMs;

    await this.commandClient
      .multi()
      .zAdd(key, {
        score: candle.bucketStart,
        value: JSON.stringify(candle),
      })
      .zRemRangeByScore(key, 0, cutoff)
      .exec();
  }

  async listCandles(instrumentKey: string, fromMs: number, toMs: number, limit: number) {
    const values = await this.commandClient.zRangeByScore(
      this.candleKey(instrumentKey),
      fromMs,
      toMs,
      {
        LIMIT: {
          offset: 0,
          count: limit,
        },
      }
    );

    return values.map((value) => JSON.parse(value) as CandleRecord);
  }

  async publishQuoteEvent(event: QuoteEvent) {
    const payload = JSON.stringify(event);
    await this.commandClient
      .multi()
      .set(this.latestQuoteKey(event.instrumentKey), JSON.stringify(event.quote))
      .publish(this.options.quoteEventsChannel, payload)
      .exec();
  }

  async subscribeToQuoteEvents(handler: (event: QuoteEvent) => void | Promise<void>) {
    await this.subscriberClient.subscribe(this.options.quoteEventsChannel, async (message) => {
      await handler(JSON.parse(message) as QuoteEvent);
    });
  }

  async disconnect() {
    if (this.subscriberClient.isOpen) {
      await this.subscriberClient.quit();
    }
    if (this.commandClient.isOpen) {
      await this.commandClient.quit();
    }
  }

  private latestQuoteKey(instrumentKey: string) {
    return `${this.options.latestQuotePrefix}:${instrumentKey}`;
  }

  private candleKey(instrumentKey: string) {
    return `${this.options.candlePrefix}:${instrumentKey}`;
  }
}
