import type { InstrumentRecord } from "../types/market";

export type HistoryRange = "5d" | "1mo" | "6mo" | "1y";

export interface HistoricalBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HistoricalCandles {
  instrumentKey: string;
  symbol: string;
  source: "Yahoo Finance";
  interval: "15m" | "1d";
  range: HistoryRange;
  bars: HistoricalBar[];
}

const cache = new Map<string, { until: number; value: HistoricalCandles }>();

export async function fetchHistoricalCandles(
  instrument: InstrumentRecord,
  range: HistoryRange,
): Promise<HistoricalCandles> {
  const ticker = `${instrument.symbol}.NS`;
  const cacheKey = `${ticker}:${range}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.until > Date.now()) return cached.value;

  const interval = range === "5d" ? "15m" : "1d";
  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
  );
  url.searchParams.set("range", range);
  url.searchParams.set("interval", interval);
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "mock-trader/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok)
    throw new Error(`Historical source returned ${response.status}`);
  const payload = await response.json();
  const bars = parseYahooBars(payload, ticker);
  if (bars.length === 0) throw new Error("Historical source returned no bars");

  const value: HistoricalCandles = {
    instrumentKey: instrument.instrumentKey,
    symbol: instrument.symbol,
    source: "Yahoo Finance",
    interval,
    range,
    bars,
  };
  if (cache.size >= 500) {
    for (const [key, entry] of cache) {
      if (entry.until <= Date.now() || cache.size >= 500) cache.delete(key);
      if (cache.size < 500) break;
    }
  }
  cache.set(cacheKey, { until: Date.now() + 5 * 60_000, value });
  return value;
}

export function parseYahooBars(
  payload: unknown,
  ticker: string,
): HistoricalBar[] {
  const root = payload as {
    chart?: {
      result?: Array<{
        meta?: { symbol?: string; currency?: string };
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            open?: Array<number | null>;
            high?: Array<number | null>;
            low?: Array<number | null>;
            close?: Array<number | null>;
            volume?: Array<number | null>;
          }>;
        };
      }>;
    };
  };
  const result = root?.chart?.result?.[0];
  if (
    result?.meta?.symbol?.toUpperCase() !== ticker.toUpperCase() ||
    result.meta.currency !== "INR"
  )
    return [];
  const quote = result.indicators?.quote?.[0];
  if (!quote || !Array.isArray(result.timestamp)) return [];

  return result.timestamp.flatMap((time, index) => {
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    if (
      !Number.isFinite(time) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      (low as number) > (high as number)
    )
      return [];
    return [
      {
        timestamp: time * 1000,
        open: open as number,
        high: high as number,
        low: low as number,
        close: close as number,
        volume: Number.isFinite(quote.volume?.[index])
          ? (quote.volume?.[index] as number)
          : 0,
      },
    ];
  });
}
