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

export interface ServiceConfig {
  name: string;
  port: number;
}

export interface RuntimeEnv {
  service: ServiceConfig;
  redis: RedisConfig;
  db: DBConfig;
  paths: PathsConfig;
  catalog: CatalogConfig;
  websocket: WebSocketConfig;
  market: MarketConfig;
  subscriptions: SubscriptionConfig;
  paytm: PaytmConfig;
}

export interface OperatorEnv {
  paths: Pick<PathsConfig, "data" | "session" | "catalogSnapshot">;
  catalog: CatalogConfig;
  market: Pick<MarketConfig, "upstreamMode">;
  paytm: PaytmConfig;
}

export interface IngestWorkerEnv {
  redis: RedisConfig;
  paths: Pick<PathsConfig, "session">;
  market: Pick<
    MarketConfig,
    "upstreamMode" | "reconnectAttempts" | "candleRetentionMs"
  > & {
    redis: MarketConfig["redis"];
  };
}

export interface CatalogWorkerEnv {
  paths: Pick<PathsConfig, "catalogSnapshot">;
  catalog: CatalogConfig;
  paytm: PaytmConfig;
}
