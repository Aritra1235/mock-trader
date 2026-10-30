import type {
  BarRange,
  DataProvider,
  OHLCV,
  ProviderInfo,
  SymbolDescriptor,
} from "@luxalgo/vela";
import { apiClient } from "./api-client";
import { marketSession } from "./market";

type ApiTimeframe = "1" | "5" | "15" | "30" | "60" | "D" | "W" | "M";
type Resolution = { base: ApiTimeframe; minutes: number | null };

const MINUTE_MS = 60_000;
const DAY_MS = 1_440 * MINUTE_MS;
const IST_OFFSET_MS = 330 * MINUTE_MS;
const SESSION_OPEN_MINUTES = 555;
const SESSION_MINUTES = 375;
const MINUTE_BASES = [60, 30, 15, 5, 1];

const chartSymbolType: Record<string, string> = { ETF: "etf", INDEX: "index" };

export const CHART_TIMEFRAMES = ["1", "5", "15", "30", "60", "D", "W", "M"];

function resolve(timeframe: string): Resolution | null {
  if (/^1?D$/i.test(timeframe)) return { base: "D", minutes: null };
  if (/^1?W$/i.test(timeframe)) return { base: "W", minutes: null };
  if (/^1?M$/.test(timeframe)) return { base: "M", minutes: null };
  const parsed = /^(\d+)(m|h)?$/.exec(timeframe);
  if (!parsed) return null;
  const minutes = Number(parsed[1]) * (parsed[2] === "h" ? 60 : 1);
  const base = MINUTE_BASES.find((size) => minutes % size === 0);
  return base ? { base: String(base) as ApiTimeframe, minutes } : null;
}

function istDay(timestamp: number) {
  return (
    Math.floor((timestamp + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS
  );
}

// Bars start at the session open, so an hourly bar spans 09:15 to 10:15.
function barStart(timestamp: number, { base, minutes }: Resolution) {
  const day = istDay(timestamp);
  if (minutes !== null) {
    const open = day + SESSION_OPEN_MINUTES * MINUTE_MS;
    const size = minutes * MINUTE_MS;
    return open + Math.floor((timestamp - open) / size) * size;
  }
  if (base === "D") return day;
  const date = new Date(day + IST_OFFSET_MS);
  if (base === "W") return day - ((date.getUTCDay() + 6) % 7) * DAY_MS;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) - IST_OFFSET_MS;
}

function regroup(bars: OHLCV[], resolution: Resolution) {
  const groups = new Map<number, OHLCV>();
  for (const bar of bars) {
    const time = barStart(bar.time, resolution);
    const group = groups.get(time);
    if (!group) {
      groups.set(time, { ...bar, time });
      continue;
    }
    group.high = Math.max(group.high, bar.high);
    group.low = Math.min(group.low, bar.low);
    group.close = bar.close;
    group.volume = (group.volume ?? 0) + (bar.volume ?? 0);
  }
  return [...groups.values()];
}

// Depth to request when the chart asks for a bar count, padded for holidays.
function spanOf({ base, minutes }: Resolution, limit: number) {
  if (minutes !== null)
    return ((limit * minutes) / SESSION_MINUTES) * 1.6 * DAY_MS;
  const days = base === "D" ? 1.6 : base === "W" ? 7.5 : 32;
  return limit * days * DAY_MS;
}

type Stream = {
  key: string;
  resolution: Resolution;
  onBar: (bar: OHLCV) => void;
  bar: OHLCV | null;
  dayVolume: number | null;
};

/** Serves our API to Vela, and turns the quotes the app already streams into forming bars. */
export class NseChartProvider implements DataProvider {
  private symbols = new Map<string, SymbolDescriptor & { key: string }>();
  private catalog: Promise<SymbolDescriptor[]> | null = null;
  private latest = new Map<string, OHLCV>();
  private streams = new Set<Stream>();

  constructor(private readonly onStreams: (keys: string[]) => void) {}

  info(): ProviderInfo {
    return {
      name: "nse",
      displayName: "NSE",
      supportedTimeframes: CHART_TIMEFRAMES,
      capabilities: { enumerate: true, stream: true, symbolInfo: true },
    };
  }

  listSymbols() {
    this.catalog ??= apiClient
      .GET("/api/v1/market/symbols")
      .then(({ data }) => {
        if (!data) throw new Error("Symbols are unavailable");
        return data.map((row) => {
          const symbol = {
            key: row.instrumentKey,
            ticker: row.symbol,
            description: row.name,
            type: chartSymbolType[row.scripType] ?? "stock",
          };
          if (!this.symbols.has(row.symbol))
            this.symbols.set(row.symbol, symbol);
          return symbol;
        });
      })
      .catch((error) => {
        this.catalog = null;
        throw error;
      });
    return this.catalog;
  }

  async instrumentKey(ticker: string) {
    await this.listSymbols();
    return this.symbols.get(ticker)?.key ?? null;
  }

  async getSymbolInfo(ticker: string) {
    await this.listSymbols();
    const symbol = this.symbols.get(ticker);
    return (
      symbol && {
        ticker,
        description: symbol.description,
        type: symbol.type,
        exchange: "NSE",
        currency: "INR",
        timezone: "Asia/Kolkata",
        session: "0915-1530",
      }
    );
  }

  // Weekdays only, like marketSession: exchange holidays are not modelled.
  async getCalendar(_ticker: string, range: { from: number; to: number }) {
    const windows: [number, number][] = [];
    for (let day = istDay(range.from); day < range.to; day += DAY_MS) {
      const weekday = new Date(day + IST_OFFSET_MS).getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      const open = day + SESSION_OPEN_MINUTES * MINUTE_MS;
      windows.push([open, open + SESSION_MINUTES * MINUTE_MS]);
    }
    return windows;
  }

  async getBars(ticker: string, timeframe: string, range: BarRange) {
    const resolution = resolve(timeframe);
    const key = await this.instrumentKey(ticker);
    if (!resolution || !key) return [];

    const to = Math.floor(range.to ?? Date.now());
    const from = Math.floor(
      range.from ?? to - spanOf(resolution, range.limit ?? 1_000),
    );
    const { data, error } = await apiClient.GET(
      "/api/v1/market/instruments/{id}/candles",
      {
        params: {
          path: { id: key },
          query: { timeframe: resolution.base, from, to },
        },
      },
    );
    if (error || !data) throw new Error("Candles are unavailable");

    const candles = data.bars.map(({ timestamp, ...bar }) => ({
      ...bar,
      time: timestamp,
    }));
    const bars =
      resolution.minutes !== null &&
      resolution.minutes !== Number(data.timeframe)
        ? regroup(candles, resolution)
        : candles;
    const newest = bars.at(-1);
    if (newest && to >= Date.now() - DAY_MS) {
      this.latest.set(`${ticker}|${timeframe}`, newest);
    }
    return bars;
  }

  subscribe(ticker: string, timeframe: string, onBar: (bar: OHLCV) => void) {
    const resolution = resolve(timeframe);
    const key = this.symbols.get(ticker)?.key;
    if (!resolution || !key) return () => {};

    const stream: Stream = {
      key,
      resolution,
      onBar,
      bar: this.latest.get(`${ticker}|${timeframe}`) ?? null,
      dayVolume: null,
    };
    this.streams.add(stream);
    this.announce();
    return () => {
      this.streams.delete(stream);
      this.announce();
    };
  }

  /** Feed one quote into every chart showing that instrument. */
  pushQuote(key: string, price: number, dayVolume: number | null) {
    if (marketSession() !== "open") return;
    const now = Date.now();
    for (const stream of this.streams) {
      if (stream.key === key) advance(stream, price, dayVolume, now);
    }
  }

  private announce() {
    this.onStreams([...new Set([...this.streams].map((x) => x.key))]);
  }
}

function advance(
  stream: Stream,
  price: number,
  dayVolume: number | null,
  now: number,
) {
  const time = barStart(now, stream.resolution);
  const traded =
    dayVolume !== null && stream.dayVolume !== null
      ? Math.max(dayVolume - stream.dayVolume, 0)
      : 0;
  if (dayVolume !== null) stream.dayVolume = dayVolume;

  const current = stream.bar;
  if (current && current.time > time) return;
  const bar: OHLCV =
    current?.time === time
      ? {
          ...current,
          high: Math.max(current.high, price),
          low: Math.min(current.low, price),
          close: price,
          volume: (current.volume ?? 0) + traded,
        }
      : {
          time,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: traded,
        };
  stream.bar = bar;
  stream.onBar({ ...bar });
}
