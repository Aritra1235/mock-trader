import { join } from "node:path";
import dotenv from "dotenv";
import type { MarketMode } from "../types/market";
import type {
  AuthEnv,
  CatalogConfig,
  CatalogWorkerEnv,
  DBConfig,
  GoogleOAuthConfig,
  IngestWorkerEnv,
  MarketConfig,
  OperatorEnv,
  PathsConfig,
  PaytmConfig,
  RedisConfig,
  RuntimeEnv,
  ServiceConfig,
  SubscriptionConfig,
  WebSocketConfig,
} from "./interfaces";

dotenv.config();

export type AppEnv = RuntimeEnv;

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

function loadServiceConfig(): ServiceConfig {
  return {
    name: process.env.SERVICE_NAME ?? "mock-trader-api",
    port: asPositiveInt(process.env.PORT, 5000),
    publicUrl: process.env.API_PUBLIC_URL ?? "http://localhost:5000",
    allowedOrigins: withLoopbackAliases(
      parseAllowedOrigins(process.env.APP_ORIGINS),
    ),
  };
}

export function parseAllowedOrigins(value = "http://localhost:3001"): string[] {
  const entries = csv(value);
  if (entries.length === 0) {
    throw new Error("APP_ORIGINS must contain at least one frontend origin");
  }

  return [
    ...new Set(
      entries.map((entry) => {
        let url: URL;
        try {
          url = new URL(entry);
        } catch {
          throw new Error(`Invalid APP_ORIGINS entry: ${entry}`);
        }
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.pathname !== "/" ||
          url.search ||
          url.hash
        ) {
          throw new Error(
            `APP_ORIGINS entries must be HTTP(S) origins without paths: ${entry}`,
          );
        }
        return url.origin;
      }),
    ),
  ];
}

const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"];

// Browsers treat localhost, 127.0.0.1 and [::1] as different origins. Allowing
// one loopback origin also allows its aliases on the same scheme and port.
export function withLoopbackAliases(origins: string[]): string[] {
  const all = new Set(origins);
  for (const origin of origins) {
    const url = new URL(origin);
    if (!loopbackHosts.includes(url.hostname)) continue;
    for (const host of loopbackHosts) {
      url.hostname = host;
      all.add(url.origin);
    }
  }
  return [...all];
}

function asSameSite(input: string | undefined): "lax" | "none" {
  const value = (input ?? "lax").trim().toLowerCase();
  if (value === "lax" || value === "none") return value;
  throw new Error("AUTH_COOKIE_SAMESITE must be lax or none");
}

function csv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function loadRedisConfig(): RedisConfig {
  return {
    url: required("REDIS_URL"),
    database: asPositiveInt(required("REDIS_DATABASE"), 2),
  };
}

function loadDbConfig(): DBConfig {
  return {
    url: required("DATABASE_URL"),
    poolMax: asPositiveInt(process.env.DATABASE_POOL_MAX, 10),
  };
}

function loadPathsConfig(): PathsConfig {
  const dataDir =
    process.env.DATA_DIR ?? join(import.meta.dir, "..", "..", "data");

  return {
    docs: process.env.DOCS_DIR ?? join(import.meta.dir, "..", "..", "docs"),
    data: dataDir,
    session:
      process.env.PAYTM_SESSION_PATH ?? join(dataDir, "paytm-session.json"),
    catalogSnapshot:
      process.env.CATALOG_SNAPSHOT_PATH ??
      join(dataDir, "instruments.snapshot.json"),
  };
}

function loadCatalogConfig(): CatalogConfig {
  return {
    files: (process.env.CATALOG_FILES ?? "security_master.csv")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    refreshMs:
      asPositiveInt(process.env.CATALOG_REFRESH_MINUTES, 720) * 60 * 1000,
  };
}

function loadWebSocketConfig(): WebSocketConfig {
  return {
    path: process.env.PRICE_WS_PATH ?? "/ws/market",
  };
}

function loadMarketConfig(): MarketConfig {
  return {
    upstreamMode: asMode(process.env.UPSTREAM_PRICE_MODE),
    reconnectAttempts: asPositiveInt(
      process.env.PRICE_WS_RECONNECT_ATTEMPTS,
      10,
    ),
    quoteStaleMs: asPositiveInt(process.env.QUOTE_STALE_MS, 15_000),
    redis: {
      controlChannel: process.env.PRICE_CONTROL_CHANNEL ?? "market:control",
      eventsChannel: process.env.PRICE_EVENTS_CHANNEL ?? "market:events:quotes",
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
  };
}

function loadSubscriptionConfig(): SubscriptionConfig {
  return {
    maxClients: asPositiveInt(process.env.MAX_PRICE_SUBSCRIPTIONS, 100),
    leasePrefix:
      process.env.SUBSCRIPTION_LEASE_PREFIX ?? "market:subscription:leases",
    leaseMs: asPositiveInt(process.env.SUBSCRIPTION_LEASE_MS, 45_000),
    heartbeatMs: asPositiveInt(process.env.SUBSCRIPTION_HEARTBEAT_MS, 15_000),
    sweepMs: asPositiveInt(process.env.SUBSCRIPTION_SWEEP_MS, 20_000),
  };
}

function loadPaytmConfig(): PaytmConfig {
  return {
    apiKey: required("PAYTM_API_KEY"),
    apiSecret: required("PAYTM_SECRET_KEY"),
  };
}

function loadGoogleOAuthConfig(): GoogleOAuthConfig {
  return {
    clientId: required("GOOGLE_CLIENT_ID"),
    clientSecret: required("GOOGLE_CLIENT_SECRET"),
  };
}

export function loadRuntimeEnv(): RuntimeEnv {
  return {
    service: loadServiceConfig(),
    redis: loadRedisConfig(),
    db: loadDbConfig(),
    paths: loadPathsConfig(),
    catalog: loadCatalogConfig(),
    websocket: loadWebSocketConfig(),
    market: loadMarketConfig(),
    subscriptions: loadSubscriptionConfig(),
    paytm: loadPaytmConfig(),
  };
}

export function loadOperatorEnv(): OperatorEnv {
  const paths = loadPathsConfig();

  return {
    paths: {
      data: paths.data,
      session: paths.session,
      catalogSnapshot: paths.catalogSnapshot,
    },
    catalog: loadCatalogConfig(),
    market: {
      upstreamMode: asMode(process.env.UPSTREAM_PRICE_MODE),
    },
    paytm: loadPaytmConfig(),
  };
}

export function loadIngestWorkerEnv(): IngestWorkerEnv {
  const paths = loadPathsConfig();
  const market = loadMarketConfig();

  return {
    redis: loadRedisConfig(),
    paths: {
      session: paths.session,
    },
    market: {
      upstreamMode: market.upstreamMode,
      reconnectAttempts: market.reconnectAttempts,
      candleRetentionMs: market.candleRetentionMs,
      redis: market.redis,
    },
  };
}

export function loadCatalogWorkerEnv(): CatalogWorkerEnv {
  const paths = loadPathsConfig();

  return {
    paths: {
      catalogSnapshot: paths.catalogSnapshot,
    },
    catalog: loadCatalogConfig(),
    paytm: loadPaytmConfig(),
  };
}

export function loadDatabaseEnv(): DBConfig {
  return loadDbConfig();
}

export function loadAuthEnv(): AuthEnv {
  const baseUrl = required("BETTER_AUTH_URL");
  const sameSite = asSameSite(process.env.AUTH_COOKIE_SAMESITE);
  return {
    baseUrl,
    secret: required("BETTER_AUTH_SECRET"),
    // Frontend origins plus the API's own origin (OAuth callbacks land there).
    trustedOrigins: withLoopbackAliases([
      ...parseAllowedOrigins(process.env.APP_ORIGINS),
      new URL(baseUrl).origin,
    ]),
    // SameSite=None is only needed when the frontend and API are on different
    // sites (not just different subdomains or ports); browsers require Secure with it.
    cookieSameSite: sameSite,
    secureCookies: baseUrl.startsWith("https://") || sameSite === "none",
    google: loadGoogleOAuthConfig(),
  };
}

export const loadEnv = loadRuntimeEnv;
