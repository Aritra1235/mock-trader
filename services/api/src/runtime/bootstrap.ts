import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { buildApp } from "../app/buildApp";
import { loadEnv } from "../config/env";
import { PaytmHttpClient } from "../providers/paytmHttpClient";
import { RedisMarketDataStore } from "../repositories/marketDataStore";
import { RedisSubscriptionLeaseRepository } from "../repositories/subscriptionLeaseRepository";
import { CatalogService } from "../services/catalogService";
import { MarketDataService } from "../services/marketDataService";
import { PaytmSessionService } from "../services/paytmSessionService";
import { MarketGateway } from "../ws/marketGateway";

export async function bootstrapRuntime() {
  const env = loadEnv();
  await mkdir(dirname(env.sessionPath), { recursive: true });
  await mkdir(dirname(env.catalogSnapshotPath), { recursive: true });

  const paytmClient = new PaytmHttpClient(env.paytmApiKey, env.paytmApiSecret);
  const sessionService = new PaytmSessionService(paytmClient, env.sessionPath);
  const catalog = new CatalogService(
    paytmClient,
    env.catalogSnapshotPath,
    env.catalogFiles
  );

  const loadedSnapshot = await catalog.loadSnapshot();
  if (!loadedSnapshot) {
    try {
      await catalog.syncFromProvider();
    } catch (error) {
      console.warn("Catalog bootstrap sync failed", error);
    }
  }

  const store = new RedisMarketDataStore({
    url: env.redisUrl,
    database: env.redisDatabase,
    latestQuotePrefix: env.latestQuotePrefix,
    candlePrefix: env.candlePrefix,
    quoteEventsChannel: env.priceEventsChannel,
    candleRetentionMs: env.candleRetentionMs,
  });
  await store.connect();

  const leases = new RedisSubscriptionLeaseRepository({
    url: env.redisUrl,
    database: env.redisDatabase,
    leasePrefix: env.subscriptionLeasePrefix,
    controlChannel: env.priceControlChannel,
  });
  await leases.connect();

  const marketData = new MarketDataService(
    catalog,
    paytmClient,
    sessionService,
    store,
    env.quoteStaleMs
  );

  const gateway = new MarketGateway(
    crypto.randomUUID(),
    catalog,
    leases,
    store,
    env.upstreamMode,
    env.maxClientSubscriptions,
    env.subscriptionLeaseMs,
    env.subscriptionHeartbeatMs,
    env.subscriptionSweepMs
  );
  await gateway.start();

  setInterval(() => {
    void catalog.syncFromProvider().catch((error) => {
      console.warn("Scheduled catalog sync failed", error);
    });
  }, env.catalogRefreshMs);

  return {
    env,
    app: buildApp({
      env,
      catalog,
      marketData,
      sessionService,
      gateway,
      store,
      leases,
    }),
    store,
    leases,
    gateway,
    catalog,
  };
}
