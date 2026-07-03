import dotenv from "dotenv";
import { join } from "node:path";
import type { MarketMode } from "../types/market";
import type {
  RedisConfig,
  PathsConfig,
  CatalogConfig,
  WebSocketConfig,
  MarketConfig,
  SubscriptionConfig,
  PaytmConfig,
  DBConfig,
} from "./interfaces";

dotenv.config();

export interface AppEnv {
  service: {
    name: string;
    port: number;
  };
  redis: RedisConfig;
  db: DBConfig;
  paths: PathsConfig;
  catalog: CatalogConfig;
  websocket: WebSocketConfig;
  market: MarketConfig;
  subscriptions: SubscriptionConfig;
  paytm: PaytmConfig;
}

function required(name: string): string {
  const value = process.env[name];

  if (!value || value.trim() === "") {
    throw new Error(`${name} is required`);
  }

  return value;
}

function asPositiveInt(input: string | undefined, fallback: number) {
  const value = Number(input ?? fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function asMode(input: string | undefined): MarketMode {
  if (input === "LTP" || input === "QUOTE" || input === "FULL") {
    return input;
  }

  return "QUOTE";
}

export function loadEnv(): AppEnv {
  const dataDir =
    process.env.DATA_DIR ?? join(import.meta.dir, "..", "..", "data");

  return {
    service: {
      name: process.env.SERVICE_NAME ?? "mock-trader-api",
      port: asPositiveInt(process.env.PORT, 3000),
    },

    redis: {
      url: required("REDIS_URL"),
      database: asPositiveInt(required("REDIS_DATABASE"), 2),
    },

    db: {
      url: required("DATABASE_URL"),
      poolMax: asPositiveInt(process.env.DATABASE_POOL_MAX, 10),
    },

    paths: {
      docs: process.env.DOCS_DIR ?? join(import.meta.dir, "..", "..", "docs"),
      data: dataDir,
      session:
        process.env.PAYTM_SESSION_PATH ?? join(dataDir, "paytm-session.json"),
      catalogSnapshot:
        process.env.CATALOG_SNAPSHOT_PATH ??
        join(dataDir, "instruments.snapshot.json"),
    },

    catalog: {
      files: (process.env.CATALOG_FILES ?? "security_master.csv")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),

      refreshMs:
        asPositiveInt(process.env.CATALOG_REFRESH_MINUTES, 720) * 60 * 1000,
    },

    websocket: {
      path: process.env.PRICE_WS_PATH ?? "/ws/market",
    },

    market: {
      upstreamMode: asMode(process.env.UPSTREAM_PRICE_MODE),
      reconnectAttempts: asPositiveInt(
        process.env.PRICE_WS_RECONNECT_ATTEMPTS,
        10,
      ),
      quoteStaleMs: asPositiveInt(process.env.QUOTE_STALE_MS, 15_000),

      redis: {
        controlChannel: process.env.PRICE_CONTROL_CHANNEL ?? "market:control",

        eventsChannel:
          process.env.PRICE_EVENTS_CHANNEL ?? "market:events:quotes",

        latestQuotePrefix:
          process.env.LATEST_QUOTE_PREFIX ?? "market:quote:latest",

        candlePrefix: process.env.CANDLE_PREFIX ?? "market:candles:1m",
      },

      candleRetentionMs:
        asPositiveInt(process.env.CANDLE_RETENTION_DAYS, 14) *
        24 *
        60 *
        60 *
        1000,
    },

    subscriptions: {
      maxClients: asPositiveInt(process.env.MAX_PRICE_SUBSCRIPTIONS, 100),

      leasePrefix:
        process.env.SUBSCRIPTION_LEASE_PREFIX ?? "market:subscription:leases",

      leaseMs: asPositiveInt(process.env.SUBSCRIPTION_LEASE_MS, 45_000),

      heartbeatMs: asPositiveInt(process.env.SUBSCRIPTION_HEARTBEAT_MS, 15_000),

      sweepMs: asPositiveInt(process.env.SUBSCRIPTION_SWEEP_MS, 20_000),
    },

    paytm: {
      apiKey: required("PAYTM_API_KEY"),
      apiSecret: required("PAYTM_SECRET_KEY"),
    },
  };
}
