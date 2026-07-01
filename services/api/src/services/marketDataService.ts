import {
  aggregateCandles,
  intervalToMs,
  normalizeQuotePayload,
  preferenceToRestPreference,
} from "../lib/market";
import type {
  InstrumentRecord,
  MarketMode,
  QuoteEnvelope,
  QuotePayload,
  SubscriptionPreference,
} from "../types/market";
import { CatalogService } from "./catalogService";
import { PaytmHttpClient } from "../providers/paytmHttpClient";
import { PaytmSessionService } from "./paytmSessionService";
import type { MarketDataStore } from "../repositories/marketDataStore";

export class MarketDataService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly paytmClient: PaytmHttpClient,
    private readonly sessionService: PaytmSessionService,
    private readonly store: MarketDataStore,
    private readonly quoteStaleMs: number
  ) {}

  async getQuotes(ids: string[], mode: MarketMode) {
    const instruments = uniqueInstruments(ids, this.catalog);
    const latest = await this.store.getLatestQuotes(
      instruments.map((instrument) => instrument.instrumentKey)
    );

    const stale = instruments.filter((instrument) =>
      isQuoteStale(latest[instrument.instrumentKey], this.quoteStaleMs)
    );

    if (stale.length > 0) {
      const refreshed = await this.refreshQuotes(
        stale.map((instrument) => ({
          instrumentKey: instrument.instrumentKey,
          securityId: instrument.securityId,
          exchangeType: instrument.exchange,
          scripType: instrument.scripType,
          modeType: mode,
        }))
      );

      for (const quote of refreshed) {
        latest[quote.instrumentKey] = quote;
      }
    }

    return instruments.map<QuoteEnvelope>((instrument) => ({
      instrument,
      quote: latest[instrument.instrumentKey] ?? null,
      stale: isQuoteStale(latest[instrument.instrumentKey], this.quoteStaleMs),
    }));
  }

  async listCandles(id: string, interval: string, fromMs: number, toMs: number, limit: number) {
    const instrument = this.catalog.resolve(id);
    if (!instrument) {
      return null;
    }

    const baseCandles = await this.store.listCandles(
      instrument.instrumentKey,
      fromMs,
      toMs,
      limit
    );

    return {
      instrument,
      candles:
        interval === "1m"
          ? baseCandles
          : aggregateCandles(baseCandles, intervalToMs(interval)),
    };
  }

  async getProviderChart(params: Record<string, string>) {
    const token = await this.sessionService.requireReadableToken();
    return this.paytmClient.fetchRawChart(token, params);
  }

  async refreshQuotes(preferences: SubscriptionPreference[]) {
    if (preferences.length === 0) {
      return [];
    }

    const token = await this.sessionService.requireReadableToken();
    const response = await this.paytmClient.fetchLiveMarketData(
      token,
      preferences[0].modeType,
      preferences.map(preferenceToRestPreference)
    );

    const payload = Array.isArray(response.data) ? response.data : [];
    const quotes: QuotePayload[] = [];

    for (const tick of payload) {
      if (!tick || typeof tick !== "object") {
        continue;
      }

      const raw = tick as Record<string, unknown>;
      const securityId = String(raw.security_id ?? "");
      const preference = preferences.find((item) => item.securityId === securityId);
      if (!preference) {
        continue;
      }

      const quote = normalizeQuotePayload(preference, raw);
      quotes.push(quote);
      await this.store.saveLatestQuote(quote);
    }

    return quotes;
  }
}

function uniqueInstruments(ids: string[], catalog: CatalogService) {
  const seen = new Set<string>();
  const instruments: InstrumentRecord[] = [];

  for (const id of ids) {
    const instrument = catalog.resolve(id);
    if (!instrument || seen.has(instrument.instrumentKey)) {
      continue;
    }
    seen.add(instrument.instrumentKey);
    instruments.push(instrument);
  }

  return instruments;
}

function isQuoteStale(quote: QuotePayload | undefined | null, staleMs: number) {
  if (!quote) {
    return true;
  }
  const receivedAt = Date.parse(quote.receivedAt);
  return Number.isNaN(receivedAt) || Date.now() - receivedAt > staleMs;
}
