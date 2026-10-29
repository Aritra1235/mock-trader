export type Instrument = {
  instrumentKey: string;
  securityId: string;
  symbol: string;
  name: string;
  exchange: string;
  scripType: string;
  lotSize: number | null;
  tickSize: number | null;
  upperLimit: number | null;
  lowerLimit: number | null;
};

export type Quote = {
  instrumentKey: string;
  lastPrice: number | null;
  changePercent: number | null;
  ohlc: {
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
  } | null;
  volume: number | null;
  receivedAt: string;
  tradable: boolean | null;
};

export type QuoteEntry = { quote: Quote | null; stale: boolean };

/** Last two daily closes, used when no live quote is available. */
export type CloseRef = {
  close: number;
  previousClose: number | null;
  at: number;
};

export type PriceView = {
  price: number | null;
  change: number | null;
  changePercent: number | null;
  source: "live" | "stale" | "close" | "none";
};

export function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function num(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

export function instrumentFrom(value: unknown): Instrument | null {
  const x = obj(value);
  const key = str(x.instrumentKey) || str(x.id);
  if (!key || !str(x.symbol)) return null;
  return {
    instrumentKey: key,
    securityId: str(x.securityId),
    symbol: str(x.symbol),
    name: str(x.name) || str(x.symbol),
    exchange: str(x.exchange),
    scripType: str(x.scripType) || str(x.type),
    lotSize: num(x.lotSize),
    tickSize: num(x.tickSize),
    upperLimit: num(x.upperLimit),
    lowerLimit: num(x.lowerLimit),
  };
}

export function quoteFrom(value: unknown): Quote | null {
  const x = obj(value);
  if (!str(x.instrumentKey)) return null;
  const o = obj(x.ohlc);
  return {
    instrumentKey: str(x.instrumentKey),
    lastPrice: num(x.lastPrice),
    changePercent: num(x.changePercent),
    ohlc: x.ohlc
      ? {
          open: num(o.open),
          high: num(o.high),
          low: num(o.low),
          close: num(o.close),
        }
      : null,
    volume: num(x.volumeTraded) ?? num(x.volume),
    receivedAt: str(x.receivedAt),
    tradable: typeof x.tradable === "boolean" ? x.tradable : null,
  };
}

export function priceView(
  entry: QuoteEntry | undefined,
  ref: CloseRef | undefined,
): PriceView {
  const quote = entry?.quote;
  if (quote?.lastPrice != null) {
    const pct = quote.changePercent;
    const prev = quote.ohlc?.close ?? null;
    const change =
      prev !== null && prev > 0
        ? quote.lastPrice - prev
        : pct !== null
          ? quote.lastPrice - quote.lastPrice / (1 + pct / 100)
          : null;
    return {
      price: quote.lastPrice,
      change,
      changePercent:
        pct ?? (change !== null && prev ? (change / prev) * 100 : null),
      source: entry?.stale ? "stale" : "live",
    };
  }
  if (ref) {
    const change =
      ref.previousClose !== null ? ref.close - ref.previousClose : null;
    return {
      price: ref.close,
      change,
      changePercent:
        change !== null && ref.previousClose
          ? (change / ref.previousClose) * 100
          : null,
      source: "close",
    };
  }
  return { price: null, change: null, changePercent: null, source: "none" };
}

export function instrumentHref(instrumentKey: string) {
  return `/markets/${encodeURIComponent(instrumentKey)}`;
}

/** Display fallback for an instrument key such as NSE:EQUITY:2885. */
export function keyLabel(instrumentKey: string) {
  const [exchange, , id] = instrumentKey.split(":");
  return id ? `${exchange} ${id}` : instrumentKey;
}

/** NSE cash session, 09:15–15:30 IST, Monday to Friday. Holidays are not modelled. */
export function marketSession(now = new Date()) {
  const ist = new Date(
    now.getTime() + (now.getTimezoneOffset() + 330) * 60_000,
  );
  const day = ist.getDay();
  const minutes = ist.getHours() * 60 + ist.getMinutes();
  const open = day >= 1 && day <= 5 && minutes >= 555 && minutes < 930;
  return open ? "open" : "closed";
}

export type Product = "delivery" | "intraday";

/** Mirrors the API's flat intraday leverage (MVP_PRODUCT.intraday). */
export const INTRADAY_LEVERAGE = 5;
export const INTRADAY_MARGIN_RATE = 1 / INTRADAY_LEVERAGE;

/**
 * Intraday window in IST: new positions until 15:15, exits until the 15:20
 * auto square-off. Mirrors the API's orderPolicy.
 */
export function intradayWindow(now = new Date()) {
  const ist = new Date(
    now.getTime() + (now.getTimezoneOffset() + 330) * 60_000,
  );
  const day = ist.getDay();
  const minutes = ist.getHours() * 60 + ist.getMinutes();
  if (day < 1 || day > 5 || minutes < 555 || minutes >= 920) return "closed";
  return minutes < 915 ? "open" : "exit_only";
}

/**
 * Buying power held for a position on top of the cash its trades moved.
 * Mirrors positionHold in the API's trading service.
 */
export function positionHold(product: Product, qty: number, avgCost: number) {
  const value = Math.abs(qty) * avgCost;
  if (product === "intraday")
    return qty < 0
      ? (1 + INTRADAY_MARGIN_RATE) * value
      : (INTRADAY_MARGIN_RATE - 1) * value;
  return qty < 0 ? 2 * value : 0;
}
