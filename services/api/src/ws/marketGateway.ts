import { Buffer } from "node:buffer";
import type { ServerWebSocket } from "bun";
import { buildSubscriptionKey, normalizeMode } from "../lib/market";
import type { MarketMode, QuoteEvent, SubscriptionPreference } from "../types/market";
import { CatalogService } from "../services/catalogService";
import type { SubscriptionLeaseRepository } from "../repositories/subscriptionLeaseRepository";
import type { MarketDataStore } from "../repositories/marketDataStore";

type SocketState = {
  id: string;
  subscriptions: Map<string, SubscriptionPreference>;
};

type ClientMessage = {
  type?: string;
  symbols?: unknown;
  modeType?: unknown;
};

export class MarketGateway {
  private readonly states = new WeakMap<ServerWebSocket<unknown>, SocketState>();
  private readonly sockets = new Set<ServerWebSocket<unknown>>();
  private readonly instrumentSubscribers = new Map<string, Set<ServerWebSocket<unknown>>>();
  private heartbeatTimer: Timer | null = null;
  private sweepTimer: Timer | null = null;

  constructor(
    private readonly gatewayId: string,
    private readonly catalog: CatalogService,
    private readonly leases: SubscriptionLeaseRepository,
    private readonly store: MarketDataStore,
    private readonly defaultMode: MarketMode,
    private readonly maxSubscriptions: number,
    private readonly leaseMs: number,
    private readonly heartbeatMs: number,
    private readonly sweepMs: number
  ) {}

  async start() {
    await this.store.subscribeToQuoteEvents(async (event) => {
      this.broadcastQuote(event);
    });

    this.heartbeatTimer = setInterval(() => {
      void this.refreshLeases();
    }, this.heartbeatMs);

    this.sweepTimer = setInterval(() => {
      void this.sweepExpiredLeases();
    }, this.sweepMs);
  }

  stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  open(ws: ServerWebSocket<unknown>) {
    this.sockets.add(ws);
    this.states.set(ws, {
      id: crypto.randomUUID(),
      subscriptions: new Map(),
    });

    ws.send(
      JSON.stringify({
        type: "connected",
        gatewayId: this.gatewayId,
        upstreamMode: this.defaultMode,
        maxSubscriptions: this.maxSubscriptions,
      })
    );
  }

  async message(ws: ServerWebSocket<unknown>, message: unknown) {
    const text = toTextMessage(message);
    if (!text) {
      ws.send(JSON.stringify({ type: "error", message: "Unsupported payload" }));
      return;
    }

    let payload: ClientMessage;
    try {
      payload = JSON.parse(text) as ClientMessage;
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    if (payload.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
      return;
    }

    if (payload.type === "subscribe") {
      await this.subscribe(ws, payload.symbols, payload.modeType);
      return;
    }

    if (payload.type === "unsubscribe") {
      await this.unsubscribe(ws, payload.symbols);
      return;
    }

    ws.send(JSON.stringify({ type: "error", message: "Unknown message type" }));
  }

  async close(ws: ServerWebSocket<unknown>) {
    const state = this.states.get(ws);
    this.sockets.delete(ws);
    if (!state) {
      return;
    }

    const now = Date.now();
    for (const [subscriptionKey, preference] of state.subscriptions.entries()) {
      const remaining = await this.leases.removeLease(
        subscriptionKey,
        this.memberKey(state.id),
        now
      );
      this.instrumentSubscribers.get(preference.instrumentKey)?.delete(ws);
      if (remaining === 0) {
        await this.publishControl("unsubscribe", subscriptionKey, preference);
      }
    }
  }

  private async subscribe(
    ws: ServerWebSocket<unknown>,
    symbols: unknown,
    modeInput: unknown
  ) {
    const state = this.states.get(ws);
    if (!state) {
      return;
    }

    const mode = normalizeMode(modeInput, this.defaultMode);
    const preferences = normalizePreferences(symbols, this.catalog, mode);
    if (preferences.length === 0) {
      ws.send(JSON.stringify({ type: "error", message: "No valid symbols supplied" }));
      return;
    }

    if (state.subscriptions.size + preferences.length > this.maxSubscriptions) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: `Subscription limit exceeded (${this.maxSubscriptions})`,
        })
      );
      return;
    }

    const now = Date.now();
    const expiresAt = now + this.leaseMs;
    const subscribed: SubscriptionPreference[] = [];

    for (const preference of preferences) {
      const subscriptionKey = buildSubscriptionKey(preference);
      if (state.subscriptions.has(subscriptionKey)) {
        continue;
      }

      const activeCount = await this.leases.addLease(
        subscriptionKey,
        this.memberKey(state.id),
        expiresAt
      );

      state.subscriptions.set(subscriptionKey, preference);
      const bucket =
        this.instrumentSubscribers.get(preference.instrumentKey) ??
        new Set<ServerWebSocket<unknown>>();
      bucket.add(ws);
      this.instrumentSubscribers.set(preference.instrumentKey, bucket);
      subscribed.push(preference);

      if (activeCount === 1) {
        await this.publishControl("subscribe", subscriptionKey, preference);
      }
    }

    ws.send(
      JSON.stringify({
        type: "subscribed",
        count: subscribed.length,
        symbols: subscribed,
      })
    );
  }

  private async unsubscribe(ws: ServerWebSocket<unknown>, symbols: unknown) {
    const state = this.states.get(ws);
    if (!state) {
      return;
    }

    const preferences = normalizePreferences(symbols, this.catalog, this.defaultMode);
    if (preferences.length === 0) {
      ws.send(JSON.stringify({ type: "error", message: "No valid symbols supplied" }));
      return;
    }

    const now = Date.now();
    const removed: SubscriptionPreference[] = [];

    for (const preference of preferences) {
      const subscriptionKey = buildSubscriptionKey(preference);
      if (!state.subscriptions.has(subscriptionKey)) {
        continue;
      }

      const remaining = await this.leases.removeLease(
        subscriptionKey,
        this.memberKey(state.id),
        now
      );

      state.subscriptions.delete(subscriptionKey);
      this.instrumentSubscribers.get(preference.instrumentKey)?.delete(ws);
      removed.push(preference);

      if (remaining === 0) {
        await this.publishControl("unsubscribe", subscriptionKey, preference);
      }
    }

    ws.send(
      JSON.stringify({
        type: "unsubscribed",
        count: removed.length,
        symbols: removed,
      })
    );
  }

  private async refreshLeases() {
    const expiresAt = Date.now() + this.leaseMs;
    for (const socket of this.sockets) {
      const state = this.states.get(socket);
      if (!state || state.subscriptions.size === 0) {
        continue;
      }
      await this.leases.refreshLeases(
        Array.from(state.subscriptions.keys()),
        this.memberKey(state.id),
        expiresAt
      );
    }
  }

  private async sweepExpiredLeases() {
    const expiredKeys = await this.leases.sweepExpired(Date.now());
    for (const subscriptionKey of expiredKeys) {
      const preference = findPreference(subscriptionKey, this.states, this.sockets);
      if (preference) {
        await this.publishControl("unsubscribe", subscriptionKey, preference);
      }
    }
  }

  private broadcastQuote(event: QuoteEvent) {
    const subscribers = this.instrumentSubscribers.get(event.instrumentKey);
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    const payload = JSON.stringify({
      type: "quote",
      data: event.quote,
    });

    for (const socket of subscribers) {
      socket.send(payload);
    }
  }

  private async publishControl(
    action: "subscribe" | "unsubscribe",
    subscriptionKey: string,
    preference: SubscriptionPreference
  ) {
    await this.leases.publishControl(
      JSON.stringify({
        action,
        subscriptionKey,
        subscription: preference,
        source: this.gatewayId,
        timestamp: Date.now(),
      })
    );
  }

  private memberKey(connectionId: string) {
    return `${this.gatewayId}:${connectionId}`;
  }
}

function normalizePreferences(
  input: unknown,
  catalog: CatalogService,
  mode: MarketMode
) {
  if (!Array.isArray(input)) {
    return [];
  }

  const unique = new Map<string, SubscriptionPreference>();

  for (const entry of input) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const preference = catalog.resolvePreference(
      entry as Record<string, unknown>,
      mode
    );
    if (!preference) {
      continue;
    }
    unique.set(buildSubscriptionKey(preference), preference);
  }

  return Array.from(unique.values());
}

function toTextMessage(message: unknown) {
  if (typeof message === "string") {
    return message;
  }
  if (Buffer.isBuffer(message)) {
    return message.toString("utf-8");
  }
  if (message instanceof ArrayBuffer) {
    return Buffer.from(message).toString("utf-8");
  }
  if (message instanceof Uint8Array) {
    return Buffer.from(message).toString("utf-8");
  }
  return null;
}

function findPreference(
  subscriptionKey: string,
  states: WeakMap<ServerWebSocket<unknown>, SocketState>,
  sockets: Set<ServerWebSocket<unknown>>
) {
  for (const socket of sockets) {
    const state = states.get(socket);
    const preference = state?.subscriptions.get(subscriptionKey);
    if (preference) {
      return preference;
    }
  }
  return null;
}
