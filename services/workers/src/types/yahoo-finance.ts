
export type Interval =
    | '1m'
    | '2m'
    | '5m'
    | '15m'
    | '30m'
    | '60m'
    | '90m'
    | '1h'
    | '1d'
    | '5d'
    | '1wk'
    | '1mo'
    | '3mo';


export type Range =
    | "1d"
    | "5d"
    | "1mo"
    | "3mo"
    | "6mo"
    | "1y"
    | "5y";


export interface Candle {
    timestamp: number;

    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;

    volume: number | null;
}

export interface CachedChart {
    symbol: string;

    range: ChartRange;
    interval: ChartInterval;

    currency: string | null;
    exchange: string | null;
    timezone: string | null;

    previousClose: number | null;

    candles: Candle[];

    updatedAt: number;
}