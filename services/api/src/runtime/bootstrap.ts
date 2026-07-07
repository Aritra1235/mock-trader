import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { buildApp } from "../app/buildApp";
import { loadRuntimeEnv } from "../config/env";
import { PaytmHttpClient } from "../providers/paytmHttpClient";
import { RedisMarketDataStore } from "../repositories/marketDataStore";
import { RedisSubscriptionLeaseRepository } from "../repositories/subscriptionLeaseRepository";
import { CatalogService } from "../services/catalogService";
import { MarketDataService } from "../services/marketDataService";
import { PaytmSessionService } from "../services/paytmSessionService";
import { MarketGateway } from "../ws/marketGateway";

export async function bootstrapRuntime() {
  const env = loadRuntimeEnv();
  await mkdir(dirname(env.paths.session), { recursive: true });
  await mkdir(dirname(env.paths.catalogSnapshot), { recursive: true });

  const paytmClient = new PaytmHttpClient(
    env.paytm.apiKey,
    env.paytm.apiSecret,
  );
  const sessionService = new PaytmSessionService(
    paytmClient,
    env.paths.session,
  );
  const catalog = new CatalogService(
    paytmClient,
    env.paths.catalogSnapshot,
    env.catalog.files,
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
    url: env.redis.url,
    database: env.redis.database,
    latestQuotePrefix: env.market.redis.latestQuotePrefix,
    candlePrefix: env.market.redis.candlePrefix,
    quoteEventsChannel: env.market.redis.eventsChannel,
    candleRetentionMs: env.market.candleRetentionMs,
  });
  await store.connect();

  const leases = new RedisSubscriptionLeaseRepository({
    url: env.redis.url,
    database: env.redis.database,
    leasePrefix: env.subscriptions.leasePrefix,
    controlChannel: env.market.redis.controlChannel,
  });
  await leases.connect();

  const marketData = new MarketDataService(
    catalog,
    paytmClient,
    sessionService,
    store,
    env.market.quoteStaleMs,
  );

  const gateway = new MarketGateway(
    crypto.randomUUID(),
    catalog,
    leases,
    store,
    env.market.upstreamMode,
    env.subscriptions.maxClients,
    env.subscriptions.leaseMs,
    env.subscriptions.heartbeatMs,
    env.subscriptions.sweepMs,
  );
  await gateway.start();

  setInterval(() => {
    void catalog.syncFromProvider().catch((error) => {
      console.warn("Scheduled catalog sync failed", error);
    });
  }, env.catalog.refreshMs);

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
