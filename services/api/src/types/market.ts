export type MarketMode = "LTP" | "QUOTE" | "FULL";

export interface InstrumentRecord {
  instrumentKey: string;
  securityId: string;
  symbol: string;
  name: string;
  series: string | null;
  exchange: string;
  segment: string;
  instrumentType: string;
  scripType: string;
  tickSize: number | null;
  lotSize: number | null;
  upperLimit: number | null;
  lowerLimit: number | null;
  expiryDate: string | null;
  strikePrice: number | null;
  freezeQuantity: number | null;
  searchableText: string;
}

export interface SubscriptionPreference {
  instrumentKey: string;
  securityId: string;
  exchangeType: string;
  scripType: string;
  modeType: MarketMode;
}

export interface QuoteDepthLevel {
  quantity: number | null;
  price: number | null;
  orders: number | null;
}

export interface QuotePayload {
  instrumentKey: string;
  securityId: string;
  exchangeType: string;
  scripType: string;
  modeType: MarketMode;
  found: boolean;
  tradable: boolean | null;
  lastPrice: number | null;
  changePercent: number | null;
  changeAbsolute: number | null;
  lastTradeTime: string | null;
  lastUpdateTime: string | null;
  lastTradedQuantity: number | null;
  averageTradedPrice: number | null;
  volumeTraded: number | null;
  totalBuyQuantity: number | null;
  totalSellQuantity: number | null;
  ohlc: {
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
  } | null;
  week52High: number | null;
  week52Low: number | null;
  oi: number | null;
  changeOi: number | null;
  depth: {
    buy: QuoteDepthLevel[];
    sell: QuoteDepthLevel[];
  } | null;
  providerTs: number | null;
  receivedAt: string;
  raw: Record<string, unknown>;
}

export interface CandleRecord {
  bucketStart: number;
  intervalMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  trades: number;
  lastUpdatedAt: number;
}

export interface QuoteEvent {
  type: "quote";
  instrumentKey: string;
  subscriptionKey: string;
  quote: QuotePayload;
}

export interface QuoteEnvelope {
  instrument: InstrumentRecord;
  quote: QuotePayload | null;
  stale: boolean;
}
