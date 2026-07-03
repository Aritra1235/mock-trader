import type { MarketMode } from "../types/market";

export interface RedisConfig {
  url: string;
  database: number;
}

export interface PathsConfig {
  docs: string;
  data: string;
  session: string;
  catalogSnapshot: string;
}

export interface CatalogConfig {
  files: string[];
  refreshMs: number;
}

export interface WebSocketConfig {
  path: string;
}

export interface MarketConfig {
  upstreamMode: MarketMode;
  reconnectAttempts: number;
  quoteStaleMs: number;

  redis: {
    controlChannel: string;
    eventsChannel: string;
    latestQuotePrefix: string;
    candlePrefix: string;
  };

  candleRetentionMs: number;
}

export interface SubscriptionConfig {
  maxClients: number;
  leasePrefix: string;
  leaseMs: number;
  heartbeatMs: number;
  sweepMs: number;
}

export interface PaytmConfig {
  apiKey: string | null;
  apiSecret: string | null;
}

export interface DBConfig {
  url: string;
  poolMax: number;
}
