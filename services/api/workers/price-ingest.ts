import { createClient } from "redis";
import { LivePriceWebSocket } from "../../../libraries/tsPMClient/src/livePriceWebSocket";
import { loadIngestWorkerEnv } from "../src/config/env";
import {
  buildSubscriptionKey,
  createOrMergeCandle,
  normalizeQuotePayload,
} from "../src/lib/market";
import { loadSession } from "../src/lib/sessionStore";
import type { CandleRecord, QuoteEvent, SubscriptionPreference } from "../src/types/market";

type ControlMessage = {
  action?: "subscribe" | "unsubscribe";
  subscriptionKey?: string;
  subscription?: SubscriptionPreference;
};

const env = loadIngestWorkerEnv();
const redis = createClient({ url: env.redis.url, database: env.redis.database });
const subscriber = redis.duplicate();

redis.on("error", (error) => console.error("Price worker redis error", error));
subscriber.on("error", (error) =>
  console.error("Price worker redis subscriber error", error)
);

await redis.connect();
await subscriber.connect();

const session = await loadSession(env.paths.session);
if (!session?.public_access_token) {
  throw new Error("Paytm public access token is required before starting price ingest");
}

const live = new LivePriceWebSocket();
live.setReconnectConfig(true, env.market.reconnectAttempts);

const active = new Map<string, SubscriptionPreference>();
const candles = new Map<string, CandleRecord>();
const bySecurityId = new Map<string, Set<string>>();

live.setOnOpenListener(() => {
  const preferences = Array.from(active.values()).map((subscription) => ({
    actionType: "ADD",
    exchangeType: subscription.exchangeType,
    modeType: subscription.modeType,
    scripType: subscription.scripType,
    scripId: subscription.securityId,
  }));

  if (preferences.length > 0) {
    live.subscribe(preferences);
  }
});

live.setOnErrorListener((error) => {
  console.error("Live price websocket error", error);
});

live.setOnCloseListener((code, reason) => {
  console.warn("Live price websocket closed", { code, reason: reason.toString() });
});

live.setOnMessageListener((ticks) => {
  for (const tick of ticks) {
    handleTick(tick);
  }
});

await subscriber.subscribe(env.market.redis.controlChannel, async (message) => {
  const control = JSON.parse(message) as ControlMessage;
  if (!control.subscription) {
    return;
  }

  const subscriptionKey =
    control.subscriptionKey ?? buildSubscriptionKey(control.subscription);

  if (control.action === "subscribe") {
    if (active.has(subscriptionKey)) {
      return;
    }

    active.set(subscriptionKey, control.subscription);
    const keys = bySecurityId.get(control.subscription.securityId) ?? new Set<string>();
    keys.add(subscriptionKey);
    bySecurityId.set(control.subscription.securityId, keys);

    live.subscribe([
      {
        actionType: "ADD",
        exchangeType: control.subscription.exchangeType,
        modeType: control.subscription.modeType,
        scripType: control.subscription.scripType,
        scripId: control.subscription.securityId,
      },
    ]);
    return;
  }

  if (control.action === "unsubscribe") {
    const current = active.get(subscriptionKey);
    if (!current) {
      return;
    }

    active.delete(subscriptionKey);
    const keys = bySecurityId.get(current.securityId);
    keys?.delete(subscriptionKey);
    if (keys && keys.size === 0) {
      bySecurityId.delete(current.securityId);
    }

    live.subscribe([
      {
        actionType: "REMOVE",
        exchangeType: current.exchangeType,
        modeType: current.modeType,
        scripType: current.scripType,
        scripId: current.securityId,
      },
    ]);
  }
});

live.connect(session.public_access_token);

process.on("SIGINT", async () => {
  live.disconnect();
  if (subscriber.isOpen) {
    await subscriber.quit();
  }
  if (redis.isOpen) {
    await redis.quit();
  }
  process.exit(0);
});

function handleTick(raw: Record<string, unknown>) {
  const securityId = String(raw.security_id ?? "");
  const keys = bySecurityId.get(securityId);
  if (!keys || keys.size === 0) {
    return;
  }

  for (const subscriptionKey of keys) {
    const preference = active.get(subscriptionKey);
    if (!preference) {
      continue;
    }

    const quote = normalizeQuotePayload(preference, raw);
    const timestamp =
      quote.providerTs ??
      Date.parse(quote.lastTradeTime ?? quote.lastUpdateTime ?? quote.receivedAt);
    const price = quote.lastPrice;

    if (price != null && Number.isFinite(timestamp)) {
      const candle = createOrMergeCandle(
        candles.get(preference.instrumentKey) ?? null,
        price,
        timestamp,
        quote.lastTradedQuantity
      );
      candles.set(preference.instrumentKey, candle);
      void redis
        .multi()
        .zAdd(`${env.market.redis.candlePrefix}:${preference.instrumentKey}`, {
          score: candle.bucketStart,
          value: JSON.stringify(candle),
        })
        .zRemRangeByScore(
          `${env.market.redis.candlePrefix}:${preference.instrumentKey}`,
          0,
          candle.bucketStart - env.market.candleRetentionMs
        )
        .exec();
    }

    const event: QuoteEvent = {
      type: "quote",
      instrumentKey: preference.instrumentKey,
      subscriptionKey,
      quote,
    };

    void redis
      .multi()
      .set(
        `${env.market.redis.latestQuotePrefix}:${preference.instrumentKey}`,
        JSON.stringify(quote)
      )
      .publish(env.market.redis.eventsChannel, JSON.stringify(event))
      .exec();
  }
}
