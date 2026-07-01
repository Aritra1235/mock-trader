import dotenv from "dotenv";
import { join } from "node:path";
import type { MarketMode } from "../types/market";

dotenv.config();

export interface AppEnv {
  serviceName: string;
  port: number;
  redisUrl: string;
  redisDatabase: number;
  docsDir: string;
  dataDir: string;
  sessionPath: string;
  catalogSnapshotPath: string;
  catalogFiles: string[];
  catalogRefreshMs: number;
  priceWsPath: string;
  priceControlChannel: string;
  priceEventsChannel: string;
  latestQuotePrefix: string;
  candlePrefix: string;
  subscriptionLeasePrefix: string;
  upstreamMode: MarketMode;
  reconnectAttempts: number;
  quoteStaleMs: number;
  maxClientSubscriptions: number;
  subscriptionLeaseMs: number;
  subscriptionHeartbeatMs: number;
  subscriptionSweepMs: number;
  candleRetentionMs: number;
  paytmApiKey: string | null;
  paytmApiSecret: string | null;
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
  const dataDir = process.env.DATA_DIR ?? join(import.meta.dir, "..", "..", "data");
  const port = asPositiveInt(process.env.PORT, 3000);

  return {
    serviceName: process.env.SERVICE_NAME ?? "mock-trader-api",
    port,
    redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
    redisDatabase: asPositiveInt(process.env.REDIS_DATABASE, 2),
    docsDir: process.env.DOCS_DIR ?? join(import.meta.dir, "..", "..", "docs"),
    dataDir,
    sessionPath:
      process.env.PAYTM_SESSION_PATH ?? join(dataDir, "paytm-session.json"),
    catalogSnapshotPath:
      process.env.CATALOG_SNAPSHOT_PATH ??
      join(dataDir, "instruments.snapshot.json"),
    catalogFiles: (process.env.CATALOG_FILES ?? "security_master.csv")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    catalogRefreshMs:
      asPositiveInt(process.env.CATALOG_REFRESH_MINUTES, 720) * 60 * 1000,
    priceWsPath: process.env.PRICE_WS_PATH ?? "/ws/market",
    priceControlChannel: process.env.PRICE_CONTROL_CHANNEL ?? "market:control",
    priceEventsChannel: process.env.PRICE_EVENTS_CHANNEL ?? "market:events:quotes",
    latestQuotePrefix: process.env.LATEST_QUOTE_PREFIX ?? "market:quote:latest",
    candlePrefix: process.env.CANDLE_PREFIX ?? "market:candles:1m",
    subscriptionLeasePrefix:
      process.env.SUBSCRIPTION_LEASE_PREFIX ?? "market:subscription:leases",
    upstreamMode: asMode(process.env.UPSTREAM_PRICE_MODE),
    reconnectAttempts: asPositiveInt(process.env.PRICE_WS_RECONNECT_ATTEMPTS, 10),
    quoteStaleMs: asPositiveInt(process.env.QUOTE_STALE_MS, 15_000),
    maxClientSubscriptions: asPositiveInt(process.env.MAX_PRICE_SUBSCRIPTIONS, 100),
    subscriptionLeaseMs: asPositiveInt(process.env.SUBSCRIPTION_LEASE_MS, 45_000),
    subscriptionHeartbeatMs: asPositiveInt(
      process.env.SUBSCRIPTION_HEARTBEAT_MS,
      15_000
    ),
    subscriptionSweepMs: asPositiveInt(
      process.env.SUBSCRIPTION_SWEEP_MS,
      20_000
    ),
    candleRetentionMs:
      asPositiveInt(process.env.CANDLE_RETENTION_DAYS, 14) *
      24 *
      60 *
      60 *
      1000,
    paytmApiKey: process.env.PAYTM_API_KEY ?? null,
    paytmApiSecret: process.env.PAYTM_SECRET_KEY ?? null,
  };
}
