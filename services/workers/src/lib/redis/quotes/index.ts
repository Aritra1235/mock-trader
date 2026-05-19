// putQuote.ts

import redisClient from "..";
import redisKeys from "../keys";
import config from "../../../config";
import type { CachedQuote } from "../../../types/quote";

async function putQuote(
  ticker: string,
  quote: any
): Promise<CachedQuote> {
  const key = redisKeys.quote(ticker);

  // normalize only what you need
  const normalizedQuote: CachedQuote = {
    symbol: ticker.toUpperCase(),
    shortName: quote.shortName ?? null,

    price: quote.regularMarketPrice ?? null,

    change: quote.regularMarketChange ?? null,

    changePercent:
      quote.regularMarketChangePercent ?? null,

    open: quote.regularMarketOpen ?? null,

    high: quote.regularMarketDayHigh ?? null,

    low: quote.regularMarketDayLow ?? null,

    previousClose:
      quote.regularMarketPreviousClose ?? null,

    volume: quote.regularMarketVolume ?? null,

    marketState: quote.marketState ?? null,

    currency: quote.currency ?? null,

    exchange: quote.fullExchangeName ?? null,

    updatedAt: Date.now(),
  };

  await redisClient.set(
    key,
    JSON.stringify(normalizedQuote),
    "EX",
    config.ttl.quotes
  );

  // optional websocket pubsub
  await redisClient.publish(
    `pubsub:quote:${ticker.toUpperCase()}`,
    JSON.stringify(normalizedQuote)
  );

  return normalizedQuote;
}

async function getCachedQuote(
  ticker: string
): Promise<CachedQuote | null> {
  const key = redisKeys.quote(ticker);

  const data = await redisClient.get(key);

  if (!data) {
    return null;
  }

  return JSON.parse(data) as CachedQuote;
}

export { putQuote, getCachedQuote };