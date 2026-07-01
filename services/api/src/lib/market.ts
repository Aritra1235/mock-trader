import type {
  CandleRecord,
  InstrumentRecord,
  MarketMode,
  QuoteDepthLevel,
  QuotePayload,
  SubscriptionPreference,
} from "../types/market";

const OPTION_MARKERS = ["OPT", "OPTION"];
const FUTURE_MARKERS = ["FUT", "FUTURE"];
const PAYTM_1980_EPOCH_OFFSET_SECONDS = 315_532_800;
const UNIX_SECONDS_2020 = 1_577_836_800;

export function parseNumber(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) {
    return input;
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

export function normalizeBoolean(input: unknown): boolean | null {
  if (typeof input === "boolean") {
    return input;
  }
  if (typeof input === "number") {
    return input === 1;
  }
  if (typeof input === "string") {
    const lowered = input.trim().toLowerCase();
    if (lowered === "true" || lowered === "1") {
      return true;
    }
    if (lowered === "false" || lowered === "0") {
      return false;
    }
  }
  return null;
}

export function normalizeTimestamp(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) {
    if (input > 1_000_000_000_000) {
      return input;
    }
    const unixSeconds =
      input < UNIX_SECONDS_2020 ? input + PAYTM_1980_EPOCH_OFFSET_SECONDS : input;
    return unixSeconds * 1000;
  }
  if (typeof input === "string") {
    const numeric = Number(input);
    if (Number.isFinite(numeric)) {
      return normalizeTimestamp(numeric);
    }
    const millis = Date.parse(input);
    return Number.isNaN(millis) ? null : millis;
  }
  return null;
}

export function toIsoString(input: unknown): string | null {
  const millis = normalizeTimestamp(input);
  return millis ? new Date(millis).toISOString() : null;
}

export function buildInstrumentKey(
  exchangeType: string,
  scripType: string,
  securityId: string
) {
  return `${exchangeType}:${scripType}:${securityId}`;
}

export function buildSubscriptionKey(preference: SubscriptionPreference) {
  return `${preference.instrumentKey}:${preference.modeType}`;
}

export function inferScripType(instrumentType: string, symbol: string, segment: string) {
  const upperType = instrumentType.toUpperCase();
  if (OPTION_MARKERS.some((marker) => upperType.includes(marker))) {
    return "OPTION";
  }
  if (FUTURE_MARKERS.some((marker) => upperType.includes(marker))) {
    return "FUTURE";
  }
  if (upperType.includes("ETF")) {
    return "ETF";
  }
  if (upperType.includes("INDEX") || segment.toUpperCase() === "I" || symbol.includes("NIFTY")) {
    return "INDEX";
  }
  return "EQUITY";
}

export function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      const next = line[index + 1];
      if (quoted && next === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

export function parseSecurityMaster(csv: string) {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  const records: InstrumentRecord[] = [];

  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    if (cells.length !== headers.length) {
      continue;
    }

    const raw = Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
    const securityId = raw.security_id;
    const exchange = raw.exchange.toUpperCase();
    const symbol = raw.symbol.toUpperCase();
    const segment = raw.segment.toUpperCase();
    const instrumentType = raw.instrument_type.toUpperCase();
    const scripType = inferScripType(instrumentType, symbol, segment);
    const name = raw.name || symbol;

    records.push({
      instrumentKey: buildInstrumentKey(exchange, scripType, securityId),
      securityId,
      symbol,
      name,
      series: raw.series || null,
      exchange,
      segment,
      instrumentType,
      scripType,
      tickSize: parseNumber(raw.tick_size),
      lotSize: parseNumber(raw.lot_size),
      upperLimit: parseNumber(raw.upper_limit),
      lowerLimit: parseNumber(raw.lower_limit),
      expiryDate: raw.expiry_date || null,
      strikePrice: parseNumber(raw.strike_price),
      freezeQuantity: parseNumber(raw.freeze_quantity),
      searchableText: `${symbol} ${name} ${exchange} ${instrumentType} ${securityId}`.toLowerCase(),
    });
  }

  return records;
}

export function normalizeQuotePayload(
  preference: SubscriptionPreference,
  raw: Record<string, unknown>,
  receivedAt = new Date().toISOString()
): QuotePayload {
  const ohlcRaw =
    raw.ohlc && typeof raw.ohlc === "object" ? (raw.ohlc as Record<string, unknown>) : null;
  const rawDepth =
    raw.depth && typeof raw.depth === "object" ? (raw.depth as Record<string, unknown>) : null;

  return {
    instrumentKey: preference.instrumentKey,
    securityId: preference.securityId,
    exchangeType: preference.exchangeType,
    scripType: preference.scripType,
    modeType: preference.modeType,
    found: normalizeBoolean(raw.found) ?? true,
    tradable: normalizeBoolean(raw.tradable),
    lastPrice: parseNumber(raw.last_price),
    changePercent: parseNumber(raw.change_percent),
    changeAbsolute: parseNumber(raw.change_absolute),
    lastTradeTime: toIsoString(raw.last_trade_time),
    lastUpdateTime: toIsoString(raw.last_update_time),
    lastTradedQuantity: parseNumber(raw.last_traded_quantity),
    averageTradedPrice: parseNumber(raw.average_traded_price),
    volumeTraded: parseNumber(raw.volume_traded),
    totalBuyQuantity: parseNumber(raw.total_buy_quantity),
    totalSellQuantity: parseNumber(raw.total_sell_quantity),
    ohlc: {
      open: parseNumber(ohlcRaw?.open ?? raw.open),
      high: parseNumber(ohlcRaw?.high ?? raw.high),
      low: parseNumber(ohlcRaw?.low ?? raw.low),
      close: parseNumber(ohlcRaw?.close ?? raw.close),
    },
    week52High: parseNumber(raw["52_week_high"] ?? raw.fifty_two_week_high),
    week52Low: parseNumber(raw["52_week_low"] ?? raw.fifty_two_week_low),
    oi: parseNumber(raw.oi),
    changeOi: parseNumber(raw.change_oi),
    depth: normalizeDepth(rawDepth),
    providerTs:
      normalizeTimestamp(raw.last_trade_time) ??
      normalizeTimestamp(raw.last_update_time),
    receivedAt,
    raw,
  };
}

function normalizeDepth(rawDepth: Record<string, unknown> | null) {
  if (!rawDepth) {
    return null;
  }

  return {
    buy: normalizeDepthSide(rawDepth.buy),
    sell: normalizeDepthSide(rawDepth.sell),
  };
}

function normalizeDepthSide(input: unknown): QuoteDepthLevel[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((entry) => {
    const level = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    return {
      quantity: parseNumber(level.quantity),
      price: parseNumber(level.price),
      orders: parseNumber(level.orders),
    };
  });
}

export function intervalToMs(interval: string) {
  const lookup: Record<string, number> = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "1d": 86_400_000,
  };
  return lookup[interval] ?? lookup["1m"];
}

export function bucketTimestamp(timestamp: number, intervalMs: number) {
  return Math.floor(timestamp / intervalMs) * intervalMs;
}

export function createOrMergeCandle(
  current: CandleRecord | null,
  price: number,
  timestamp: number,
  volume: number | null,
  intervalMs = 60_000
): CandleRecord {
  const bucketStart = bucketTimestamp(timestamp, intervalMs);

  if (!current || current.bucketStart !== bucketStart) {
    return {
      bucketStart,
      intervalMs,
      open: price,
      high: price,
      low: price,
      close: price,
      volume,
      trades: 1,
      lastUpdatedAt: timestamp,
    };
  }

  return {
    ...current,
    high: Math.max(current.high, price),
    low: Math.min(current.low, price),
    close: price,
    volume:
      volume == null && current.volume == null
        ? null
        : (current.volume ?? 0) + (volume ?? 0),
    trades: current.trades + 1,
    lastUpdatedAt: timestamp,
  };
}

export function aggregateCandles(candles: CandleRecord[], targetIntervalMs: number) {
  if (candles.length === 0) {
    return [];
  }

  const buckets = new Map<number, CandleRecord>();

  for (const candle of candles) {
    const bucketStart = bucketTimestamp(candle.bucketStart, targetIntervalMs);
    const existing = buckets.get(bucketStart);

    if (!existing) {
      buckets.set(bucketStart, {
        bucketStart,
        intervalMs: targetIntervalMs,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        trades: candle.trades,
        lastUpdatedAt: candle.lastUpdatedAt,
      });
      continue;
    }

    existing.high = Math.max(existing.high, candle.high);
    existing.low = Math.min(existing.low, candle.low);
    existing.close = candle.close;
    existing.trades += candle.trades;
    existing.lastUpdatedAt = Math.max(existing.lastUpdatedAt, candle.lastUpdatedAt);
    existing.volume =
      existing.volume == null && candle.volume == null
        ? null
        : (existing.volume ?? 0) + (candle.volume ?? 0);
  }

  return Array.from(buckets.values()).sort((left, right) => left.bucketStart - right.bucketStart);
}

export function preferenceToProviderPayload(preference: SubscriptionPreference) {
  return {
    exchangeType: preference.exchangeType,
    modeType: preference.modeType,
    scripType: preference.scripType,
    scripId: preference.securityId,
  };
}

export function preferenceToRestPreference(preference: SubscriptionPreference) {
  return `${preference.exchangeType}:${preference.securityId}:${preference.scripType}`;
}

export function normalizeMode(input: unknown, fallback: MarketMode): MarketMode {
  if (input === "LTP" || input === "QUOTE" || input === "FULL") {
    return input;
  }
  return fallback;
}
