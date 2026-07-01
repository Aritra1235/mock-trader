import { createClient } from "redis";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LivePriceWebSocket } from "../../../libraries/tsPMClient/src/livePriceWebSocket";

type Subscription = {
  key: string;
  scripId: string;
  exchangeType: string;
  scripType: string;
  modeType: string;
};

type ControlMessage = {
  action?: "subscribe" | "unsubscribe";
  subscription?: {
    key?: string;
    scripId?: string | number;
    exchangeType?: string;
    scripType?: string;
    modeType?: string;
  };
  source?: string;
  timestamp?: number;
};

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379/2";
const controlChannel = process.env.PRICE_CONTROL_CHANNEL ?? "price:control";
const priceChannelPrefix = process.env.PRICE_CHANNEL_PREFIX ?? "price:tick:";
const priceLatestPrefix = process.env.PRICE_LATEST_PREFIX ?? "price:latest:";
const publishIntervalMs = Math.max(20, Number(process.env.PRICE_PUBLISH_INTERVAL_MS ?? 100));
const defaultModeType = process.env.PRICE_MODE_TYPE ?? "LTP";
const reconnectAttempts = Number(process.env.PRICE_WS_RECONNECT_ATTEMPTS ?? 10);
const sessionPath =
  process.env.PAYTM_SESSION_PATH ??
  join(import.meta.dir, "../..", "api", "data", "paytm-session.json");
const directPublicAccessToken = process.env.PAYTM_PUBLIC_ACCESS_TOKEN ?? null;

const redis = createClient({ url: redisUrl });
const redisSubscriber = redis.duplicate();

redis.on("error", (err) => console.error("Redis error:", err));
redisSubscriber.on("error", (err) => console.error("Redis subscriber error:", err));

await redis.connect();
await redisSubscriber.connect();

const publicAccessToken = await loadPublicAccessToken();

const livePriceWebSocket = new LivePriceWebSocket();
let socketConnected = false;

const subscriptionCounts = new Map<string, number>();
const subscriptionsByKey = new Map<string, Subscription>();
const keysByScripId = new Map<string, Set<string>>();
const latestByKey = new Map<string, string>();

livePriceWebSocket.setReconnectConfig(true, reconnectAttempts);
livePriceWebSocket.setOnOpenListener(() => {
  socketConnected = true;
  const active = Array.from(subscriptionsByKey.values()).map((subscription) =>
    toPreference(subscription, "ADD")
  );
  if (active.length > 0) {
    livePriceWebSocket.subscribe(active);
  }
});
livePriceWebSocket.setOnCloseListener((code, reason) => {
  socketConnected = false;
  console.warn("Price feed disconnected", { code, reason: reason.toString() });
});
livePriceWebSocket.setOnErrorListener((err) => {
  console.error("Price feed error", err);
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("Expected 101 status code")) {
    console.error("Price feed handshake failed. Check Paytm public access token validity.");
  }
});
livePriceWebSocket.setOnMessageListener((arr) => {
  for (const tick of arr) {
    handleTick(tick);
  }
});

await redisSubscriber.subscribe(controlChannel, (message) => {
  handleControlMessage(message);
});

const publishTimer = setInterval(() => {
  flushUpdates().catch((error) => {
    console.error("Failed to publish price updates", error);
  });
}, publishIntervalMs);

livePriceWebSocket.connect(publicAccessToken);

process.on("SIGINT", async () => {
  clearInterval(publishTimer);
  livePriceWebSocket.disconnect();
  if (redisSubscriber.isOpen) {
    await redisSubscriber.quit();
  }
  if (redis.isOpen) {
    await redis.quit();
  }
  process.exit(0);
});

function buildKey(subscription: Pick<Subscription, "exchangeType" | "scripType" | "modeType" | "scripId">) {
  return `${subscription.exchangeType}:${subscription.scripType}:${subscription.modeType}:${subscription.scripId}`;
}

function toPreference(subscription: Subscription, actionType: "ADD" | "REMOVE") {
  return {
    actionType,
    modeType: subscription.modeType,
    scripType: subscription.scripType,
    exchangeType: subscription.exchangeType,
    scripId: subscription.scripId
  };
}

function normalizeScripId(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(raw);
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed && !Number.isNaN(Number(trimmed))) {
      return trimmed;
    }
  }
  return null;
}

function normalizeSubscription(message: ControlMessage): Subscription | null {
  const subscription = message.subscription;
  if (!subscription) {
    return null;
  }
  const scripId = normalizeScripId(subscription.scripId);
  const exchangeType =
    typeof subscription.exchangeType === "string" ? subscription.exchangeType.trim() : null;
  const scripType =
    typeof subscription.scripType === "string" ? subscription.scripType.trim() : null;
  const modeType = typeof subscription.modeType === "string" ? subscription.modeType : defaultModeType;
  if (!scripId || !exchangeType || !scripType) {
    return null;
  }
  const key = subscription.key ?? buildKey({ scripId, exchangeType, scripType, modeType });
  return {
    key,
    scripId,
    exchangeType,
    scripType,
    modeType
  };
}

function handleControlMessage(message: string) {
  let parsed: ControlMessage;
  try {
    parsed = JSON.parse(message) as ControlMessage;
  } catch (error) {
    console.error("Failed to parse control message", error);
    return;
  }

  const subscription = normalizeSubscription(parsed);
  if (!subscription) {
    console.error("Invalid subscription control message", message);
    return;
  }

  if (parsed.action === "subscribe") {
    registerSubscription(subscription);
    return;
  }

  if (parsed.action === "unsubscribe") {
    unregisterSubscription(subscription);
    return;
  }

  console.error("Unknown control action", parsed.action);
}

function registerSubscription(subscription: Subscription) {
  const current = subscriptionCounts.get(subscription.key) ?? 0;
  subscriptionCounts.set(subscription.key, current + 1);
  if (current > 0) {
    return;
  }

  subscriptionsByKey.set(subscription.key, subscription);
  const keys = keysByScripId.get(subscription.scripId) ?? new Set<string>();
  keys.add(subscription.key);
  keysByScripId.set(subscription.scripId, keys);

  if (socketConnected) {
    livePriceWebSocket.subscribe([toPreference(subscription, "ADD")]);
  }
}

function unregisterSubscription(subscription: Subscription) {
  const current = subscriptionCounts.get(subscription.key);
  if (!current) {
    console.warn("Unsubscribe requested for inactive key", subscription.key);
    return;
  }

  if (current > 1) {
    subscriptionCounts.set(subscription.key, current - 1);
    return;
  }

  subscriptionCounts.delete(subscription.key);
  subscriptionsByKey.delete(subscription.key);
  const keys = keysByScripId.get(subscription.scripId);
  if (keys) {
    keys.delete(subscription.key);
    if (keys.size === 0) {
      keysByScripId.delete(subscription.scripId);
    }
  }

  latestByKey.delete(subscription.key);
  if (socketConnected) {
    livePriceWebSocket.subscribe([toPreference(subscription, "REMOVE")]);
  }
}

function extractSecurityId(tick: Record<string, unknown>): string | null {
  return normalizeScripId(tick.security_id);
}

function handleTick(tick: Record<string, unknown>) {
  const scripId = extractSecurityId(tick);
  if (!scripId) {
    return;
  }
  const keys = keysByScripId.get(scripId);
  if (!keys || keys.size === 0) {
    return;
  }

  const providerTs =
    typeof tick.last_trade_time === "number"
      ? tick.last_trade_time
      : typeof tick.last_update_time === "number"
        ? tick.last_update_time
        : null;
  const serverTs = Date.now();

  for (const key of keys) {
    const payload = JSON.stringify({
      type: "price",
      data: {
        ...tick,
        scripId,
        providerTs,
        serverTs,
        subscriptionKey: key
      }
    });
    latestByKey.set(key, payload);
  }
}

async function flushUpdates() {
  if (latestByKey.size === 0) {
    return;
  }
  const entries = Array.from(latestByKey.entries());
  latestByKey.clear();

  const pipeline = redis.multi();
  for (const [key, payload] of entries) {
    pipeline.set(`${priceLatestPrefix}${key}`, payload);
    pipeline.publish(`${priceChannelPrefix}${key}`, payload);
  }
  await pipeline.exec();
}

async function loadPublicAccessToken() {
  if (directPublicAccessToken) {
    return directPublicAccessToken;
  }
  try {
    const raw = await readFile(sessionPath, "utf-8");
    const parsed = JSON.parse(raw) as { public_access_token?: string };
    if (parsed.public_access_token) {
      return parsed.public_access_token;
    }
  } catch (error) {
    console.error("Failed to read Paytm session file", error);
  }
  throw new Error(
    "PAYTM_PUBLIC_ACCESS_TOKEN is not set and no public_access_token found in session file."
  );
}
