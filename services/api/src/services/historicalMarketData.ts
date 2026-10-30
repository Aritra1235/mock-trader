import { log } from "../lib/log";
import type { InstrumentRecord, QuotePayload } from "../types/market";

export type HistoryRange = "5d" | "1mo" | "6mo" | "1y";

export interface HistoricalBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

type HistorySource = "Paytm Money" | "Yahoo Finance";

export interface HistoricalCandles {
  instrumentKey: string;
  symbol: string;
  source: HistorySource;
  interval: "15m" | "1d";
  range: HistoryRange;
  bars: HistoricalBar[];
}

export interface PaytmHistorySource {
  getDailyChart(
    instrument: InstrumentRecord,
    fromDate: string,
    toDate: string,
  ): Promise<unknown>;
  getSessionQuote(instrument: InstrumentRecord): Promise<QuotePayload | null>;
}

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;
// Paytm has daily bars from here on and allows 89 days per request. History is
// fetched in fixed windows so finished ones can be reused across every range.
export const CHART_HISTORY_START = Date.parse("2017-01-01T00:00:00+05:30");
const PAYTM_WINDOW_DAYS = 80;
const PAYTM_CONCURRENCY = 4;
const RANGE_DAYS: Record<Exclude<HistoryRange, "5d">, number> = {
  "1mo": 31,
  "6mo": 183,
  "1y": 366,
};
const cache = new Map<string, { until: number; value: HistoricalCandles }>();
const yahooCache = new Map<
  string,
  { until: number; value: Promise<HistoricalBar[]> }
>();
const paytmWindows = new Map<
  string,
  { until: number; value: HistoricalBar[] }
>();

export async function fetchHistoricalCandles(
  instrument: InstrumentRecord,
  range: HistoryRange,
  paytm?: PaytmHistorySource,
): Promise<HistoricalCandles> {
  const cacheKey = `${instrument.instrumentKey}:${range}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.until > Date.now()) return cached.value;

  const now = Date.now();
  const series =
    range === "5d"
      ? {
          source: "Yahoo Finance" as const,
          bars: await fetchYahooBars(`${instrument.symbol}.NS`, "5d", "15m"),
        }
      : await fetchDailyBars(
          instrument,
          now - RANGE_DAYS[range] * DAY_MS,
          now,
          paytm,
        );

  const value: HistoricalCandles = {
    instrumentKey: instrument.instrumentKey,
    symbol: instrument.symbol,
    source: series.source,
    interval: range === "5d" ? "15m" : "1d",
    range,
    bars: series.bars,
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

async function fetchDailyBars(
  instrument: InstrumentRecord,
  from: number,
  to: number,
  paytm?: PaytmHistorySource,
): Promise<{ source: HistorySource; bars: HistoricalBar[] }> {
  if (paytm) {
    try {
      const bars = await fetchPaytmDailyBars(instrument, from, to, paytm);
      if (bars.length > 0) return { source: "Paytm Money", bars };
    } catch (error) {
      log.warn("paytm history failed, using yahoo", {
        symbol: instrument.symbol,
        error,
      });
    }
  }
  const bars = await fetchYahooBars(`${instrument.symbol}.NS`, "10y", "1d");
  return {
    source: "Yahoo Finance",
    bars: bars
      .map((bar) => ({ ...bar, timestamp: istDayStart(bar.timestamp) }))
      .filter((bar) => bar.timestamp >= from && bar.timestamp <= to),
  };
}

async function fetchPaytmDailyBars(
  instrument: InstrumentRecord,
  from: number,
  to: number,
  paytm: PaytmHistorySource,
) {
  const first = paytmWindowIndex(Math.max(from, CHART_HISTORY_START));
  const last = paytmWindowIndex(Math.min(to, Date.now()));
  const pending: number[] = [];
  for (let index = last; index >= first; index -= 1) pending.push(index);

  const windows: HistoricalBar[][] = [];
  await Promise.all(
    Array.from({ length: PAYTM_CONCURRENCY }, async () => {
      for (let index = pending.shift(); index !== undefined; ) {
        windows.push(await fetchPaytmWindow(instrument, index, paytm));
        index = pending.shift();
      }
    }),
  );
  const bars = windows
    .flat()
    .filter((bar) => bar.timestamp >= from && bar.timestamp <= to)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (bars.length === 0 || to < istDayStart(Date.now())) return bars;

  // Paytm publishes the daily bar after the session; the live quote covers
  // the gap until then.
  const quote = await paytm.getSessionQuote(instrument).catch(() => null);
  const session = quote ? sessionBar(quote) : null;
  const newest = bars.at(-1) as HistoricalBar;
  if (session && session.timestamp > newest.timestamp) bars.push(session);
  return bars;
}

function paytmWindowIndex(timestamp: number) {
  return Math.floor(
    (timestamp - CHART_HISTORY_START) / (PAYTM_WINDOW_DAYS * DAY_MS),
  );
}

async function fetchPaytmWindow(
  instrument: InstrumentRecord,
  index: number,
  paytm: PaytmHistorySource,
) {
  const key = `${instrument.instrumentKey}:${index}`;
  const cached = paytmWindows.get(key);
  if (cached && cached.until > Date.now()) return cached.value;

  const start = CHART_HISTORY_START + index * PAYTM_WINDOW_DAYS * DAY_MS;
  const end = start + (PAYTM_WINDOW_DAYS - 1) * DAY_MS;
  const open = end >= Date.now();
  const value = parsePaytmBars(
    await paytm.getDailyChart(
      instrument,
      istDate(Math.min(end, Date.now())),
      istDate(start),
    ),
  );
  // Paytm matches symbols loosely: names with "&" or "-", such as M&M, can
  // bring back several securities mixed together under the same dates.
  if (new Set(value.map((bar) => bar.timestamp)).size !== value.length) {
    throw new Error("Paytm returned more than one bar per day");
  }

  if (paytmWindows.size >= 5000) paytmWindows.clear();
  paytmWindows.set(key, {
    until: Date.now() + (open ? 5 * 60_000 : DAY_MS),
    value,
  });
  return value;
}

function istDayStart(timestamp: number) {
  return Date.parse(`${istDate(timestamp)}T00:00:00+05:30`);
}

function istDate(timestamp: number) {
  return new Date(timestamp + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function sessionBar(quote: QuotePayload): HistoricalBar | null {
  const open = quote.ohlc?.open;
  const high = quote.ohlc?.high;
  const low = quote.ohlc?.low;
  const close = quote.lastPrice;
  const tradedAt = quote.lastTradeTime ? Date.parse(quote.lastTradeTime) : NaN;
  if (!open || !high || !low || !close || Number.isNaN(tradedAt)) return null;
  return {
    timestamp: Date.parse(`${istDate(tradedAt)}T00:00:00+05:30`),
    open,
    high: Math.max(high, close),
    low: Math.min(low, close),
    close,
    volume: quote.volumeTraded ?? 0,
  };
}

// Rows look like ["21-10-2026 00:00", open, high, low, close, volume], in IST.
export function parsePaytmBars(payload: unknown): HistoricalBar[] {
  const rows = (payload as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row) => {
    if (!Array.isArray(row)) return [];
    const [time, open, high, low, close, volume] = row;
    const match = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}:\d{2})$/.exec(String(time));
    if (
      !match ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      low > high
    )
      return [];
    const [, day, month, year, clock] = match;
    return [
      {
        timestamp: Date.parse(`${year}-${month}-${day}T${clock}:00+05:30`),
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
      },
    ];
  });
}

function fetchYahooBars(ticker: string, range: string, interval: string) {
  const key = `${ticker}:${range}:${interval}`;
  const cached = yahooCache.get(key);
  if (cached && cached.until > Date.now()) return cached.value;

  const value = requestYahooBars(ticker, range, interval);
  if (yahooCache.size >= 500) yahooCache.clear();
  yahooCache.set(key, {
    until: Date.now() + (interval === "1m" ? 60_000 : 5 * 60_000),
    value,
  });
  value.catch(() => yahooCache.delete(key));
  return value;
}

async function requestYahooBars(
  ticker: string,
  range: string,
  interval: string,
) {
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
  return bars;
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
