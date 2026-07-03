import { expect, test } from "bun:test";
import { join } from "node:path";
import { buildApp } from "../../src/app/buildApp";
import type { AppEnv } from "../../src/config/env";
import { PaytmHttpClient } from "../../src/providers/paytmHttpClient";
import { MarketDataService } from "../../src/services/marketDataService";
import { PaytmSessionService } from "../../src/services/paytmSessionService";
import { MarketGateway } from "../../src/ws/marketGateway";
import { InMemoryLeases, InMemoryStore, makeCatalog } from "../testSupport";

test("app exposes health, instrument search, and quotes", async () => {
  const env: AppEnv = {
    service: {
      name: "mock-trader-api",
      port: 3000,
    },
    redis: {
      url: "redis://localhost:6379",
      database: 2,
    },
    db: {
      url: "postgres://postgres:postgres@localhost:5432/mock_trader",
    },
    paths: {
      docs: join(import.meta.dir, "..", "..", "docs"),
      data: "/tmp/mock-trader-data",
      session: "/tmp/mock-trader-session-app.json",
      catalogSnapshot: "/tmp/mock-trader-catalog-app.json",
    },
    catalog: {
      files: ["security_master.csv"],
      refreshMs: 12 * 60 * 60 * 1000,
    },
    websocket: {
      path: "/ws/market",
    },
    market: {
      upstreamMode: "QUOTE",
      reconnectAttempts: 10,
      quoteStaleMs: 60_000,
      redis: {
        controlChannel: "market:control",
        eventsChannel: "market:events:quotes",
        latestQuotePrefix: "market:quote:latest",
        candlePrefix: "market:candles:1m",
      },
      candleRetentionMs: 14 * 24 * 60 * 60 * 1000,
    },
    subscriptions: {
      maxClients: 10,
      leasePrefix: "market:subscription:leases",
      leaseMs: 60_000,
      heartbeatMs: 60_000,
      sweepMs: 60_000,
    },
    paytm: {
      apiKey: "test-api-key",
      apiSecret: "test-secret-key",
    },
  };
  const catalog = await makeCatalog("/tmp/mock-trader-catalog-app.json");
  const store = new InMemoryStore();
  const leases = new InMemoryLeases();
  const sessionService = new PaytmSessionService(
    {} as unknown as PaytmHttpClient,
    "/tmp/mock-trader-session-app.json"
  );
  const marketData = new MarketDataService(
    catalog,
    {} as unknown as PaytmHttpClient,
    sessionService,
    store,
    60_000
  );
  const gateway = new MarketGateway(
    "gateway-app",
    catalog,
    leases,
    store,
    "QUOTE",
    10,
    60_000,
    60_000,
    60_000
  );

  await store.saveLatestQuote({
    instrumentKey: "NSE:EQUITY:3456",
    securityId: "3456",
    exchangeType: "NSE",
    scripType: "EQUITY",
    modeType: "QUOTE",
    found: true,
    tradable: true,
    lastPrice: 1500,
    changePercent: 1,
    changeAbsolute: 15,
    lastTradeTime: new Date().toISOString(),
    lastUpdateTime: null,
    lastTradedQuantity: 10,
    averageTradedPrice: 1498,
    volumeTraded: 1000,
    totalBuyQuantity: 100,
    totalSellQuantity: 120,
    ohlc: { open: 1480, high: 1510, low: 1475, close: 1485 },
    week52High: 1600,
    week52Low: 1200,
    oi: null,
    changeOi: null,
    depth: null,
    providerTs: Date.now(),
    receivedAt: new Date().toISOString(),
    raw: {},
  });

  const app = buildApp({
    env,
    catalog,
    marketData,
    sessionService,
    gateway,
    store,
    leases,
  });

  const healthResponse = await app.handle(new Request("http://localhost/health"));
  const health = await healthResponse.json();
  expect(health.status).toBe("ok");

  const docsResponse = await app.handle(new Request("http://localhost/docs"));
  expect(docsResponse.status).toBe(302);
  const docsPageResponse = await app.handle(
    new Request("http://localhost/docs/index.html")
  );
  const docsPage = await docsPageResponse.text();
  expect(docsPage).toContain("https://cdn.tailwindcss.com");
  expect(docsPage).toContain("No Paytm auth is exposed to the browser.");

  const readyResponse = await app.handle(new Request("http://localhost/ready"));
  expect(readyResponse.status).toBe(503);
  const ready = await readyResponse.json();
  expect(ready.ready).toBeFalse();
  expect(ready.checks.catalog).toBeTrue();

  expect(
    (await app.handle(new Request("http://localhost/auth/login"))).status
  ).toBe(404);
  expect(
    (await app.handle(new Request("http://localhost/auth/session"))).status
  ).toBe(404);

  const searchResponse = await app.handle(
    new Request("http://localhost/v1/market/instruments/search?q=rel")
  );
  const search = await searchResponse.json();
  expect(search[0]?.symbol).toBe("RELIANCE");

  const quoteResponse = await app.handle(
    new Request("http://localhost/v1/market/quotes?ids=RELIANCE")
  );
  const quotes = await quoteResponse.json();
  expect(quotes.data[0]?.quote?.lastPrice).toBe(1500);
});
