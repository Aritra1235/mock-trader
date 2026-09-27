import { Buffer } from "node:buffer";
import { buildSubscriptionKey, normalizeMode } from "../lib/market";
import type { MarketDataStore } from "../repositories/marketDataStore";
import type { SubscriptionLeaseRepository } from "../repositories/subscriptionLeaseRepository";
import type { CatalogService } from "../services/catalogService";
import type {
  MarketMode,
  QuoteEvent,
  SubscriptionPreference,
} from "../types/market";

type SocketState = {
  id: string;
  subscriptions: Map<string, SubscriptionPreference>;
  messageWindowStartedAt: number;
  messagesInWindow: number;
};

type ClientMessage = {
  type?: string;
  symbols?: unknown;
  modeType?: unknown;
  requestId?: unknown;
};

type GatewaySocket = {
  raw?: object;
  send(payload: string): unknown;
};

type SocketIdentity = object;

export class MarketGateway {
  private readonly states = new WeakMap<SocketIdentity, SocketState>();
  private readonly sockets = new Set<SocketIdentity>();
  private readonly socketHandles = new Map<SocketIdentity, GatewaySocket>();
  private readonly subscriptionSubscribers = new Map<
    string,
    Set<SocketIdentity>
  >();
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
    private readonly sweepMs: number,
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

  open(ws: GatewaySocket) {
    const identity = socketIdentity(ws);
    this.sockets.add(identity);
    this.socketHandles.set(identity, ws);
    this.states.set(identity, {
      id: crypto.randomUUID(),
      subscriptions: new Map(),
      messageWindowStartedAt: Date.now(),
      messagesInWindow: 0,
    });

    ws.send(
      JSON.stringify({
        type: "connected",
        gatewayId: this.gatewayId,
        upstreamMode: this.defaultMode,
        maxSubscriptions: this.maxSubscriptions,
      }),
    );
  }

  async message(ws: GatewaySocket, message: unknown) {
    const identity = socketIdentity(ws);
    this.socketHandles.set(identity, ws);
    const state = this.states.get(identity);
    if (!state) {
      return;
    }
    const now = Date.now();
    if (now - state.messageWindowStartedAt >= 1_000) {
      state.messageWindowStartedAt = now;
      state.messagesInWindow = 0;
    }
    state.messagesInWindow += 1;
    if (state.messagesInWindow > 30) {
      sendError(ws, "MESSAGE_RATE_EXCEEDED", "Too many messages.");
      return;
    }

    let payload: ClientMessage;
    if (isClientMessage(message)) {
      payload = message;
    } else {
      const text = toTextMessage(message);
      if (!text) {
        sendError(ws, "UNSUPPORTED_PAYLOAD", "Unsupported payload.");
        return;
      }
      if (Buffer.byteLength(text, "utf8") > 16 * 1024) {
        sendError(ws, "PAYLOAD_TOO_LARGE", "Payload exceeds 16 KiB.");
        return;
      }

      try {
        payload = JSON.parse(text) as ClientMessage;
      } catch {
        sendError(ws, "INVALID_JSON", "Invalid JSON.");
        return;
      }
    }

    if (payload.type === "ping") {
      ws.send(JSON.stringify({ type: "pong", requestId: requestId(payload) }));
      return;
    }

    if (payload.type === "subscribe") {
      await this.subscribe(
        ws,
        payload.symbols,
        payload.modeType,
        requestId(payload),
      );
      return;
    }

    if (payload.type === "unsubscribe") {
      await this.unsubscribe(
        ws,
        payload.symbols,
        payload.modeType,
        requestId(payload),
      );
      return;
    }

    sendError(
      ws,
      "UNKNOWN_MESSAGE_TYPE",
      "Unknown message type.",
      requestId(payload),
    );
  }

  async close(ws: GatewaySocket) {
    const identity = socketIdentity(ws);
    const state = this.states.get(identity);
    this.sockets.delete(identity);
    this.socketHandles.delete(identity);
    if (!state) {
      return;
    }

    const now = Date.now();
    for (const [subscriptionKey, preference] of state.subscriptions.entries()) {
      const remaining = await this.leases.removeLease(
        subscriptionKey,
        this.memberKey(state.id),
        now,
      );
      this.subscriptionSubscribers.get(subscriptionKey)?.delete(identity);
      if (remaining === 0) {
        await this.publishControl("unsubscribe", subscriptionKey, preference);
      }
    }
  }

  private async subscribe(
    ws: GatewaySocket,
    symbols: unknown,
    modeInput: unknown,
    messageRequestId: string | null,
  ) {
    const identity = socketIdentity(ws);
    const state = this.states.get(identity);
    if (!state) {
      return;
    }

    const mode = normalizeMode(modeInput, this.defaultMode);
    const preferences = normalizePreferences(symbols, this.catalog, mode);
    if (preferences.length === 0) {
      sendError(
        ws,
        "NO_VALID_SYMBOLS",
        "No valid symbols supplied.",
        messageRequestId,
      );
      return;
    }

    if (state.subscriptions.size + preferences.length > this.maxSubscriptions) {
      sendError(
        ws,
        "SUBSCRIPTION_LIMIT_EXCEEDED",
        `Subscription limit exceeded (${this.maxSubscriptions}).`,
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
        expiresAt,
      );

      state.subscriptions.set(subscriptionKey, preference);
      const bucket =
        this.subscriptionSubscribers.get(subscriptionKey) ??
        new Set<SocketIdentity>();
      bucket.add(identity);
      this.subscriptionSubscribers.set(subscriptionKey, bucket);
      subscribed.push(preference);

      if (activeCount === 1) {
        await this.publishControl("subscribe", subscriptionKey, preference);
      }
    }

    ws.send(
      JSON.stringify({
        type: "subscribed",
        requestId: messageRequestId,
        count: subscribed.length,
        symbols: subscribed,
      }),
    );
  }

  private async unsubscribe(
    ws: GatewaySocket,
    symbols: unknown,
    modeInput: unknown,
    messageRequestId: string | null,
  ) {
    const identity = socketIdentity(ws);
    const state = this.states.get(identity);
    if (!state) {
      return;
    }

    const mode = normalizeMode(modeInput, this.defaultMode);
    const preferences = normalizePreferences(symbols, this.catalog, mode);
    if (preferences.length === 0) {
      sendError(
        ws,
        "NO_VALID_SYMBOLS",
        "No valid symbols supplied.",
        messageRequestId,
      );
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
        now,
      );

      state.subscriptions.delete(subscriptionKey);
      this.subscriptionSubscribers.get(subscriptionKey)?.delete(identity);
      removed.push(preference);

      if (remaining === 0) {
        await this.publishControl("unsubscribe", subscriptionKey, preference);
      }
    }

    ws.send(
      JSON.stringify({
        type: "unsubscribed",
        requestId: messageRequestId,
        count: removed.length,
        symbols: removed,
      }),
    );
  }

  private async refreshLeases() {
    const expiresAt = Date.now() + this.leaseMs;
    for (const identity of this.sockets) {
      const state = this.states.get(identity);
      if (!state || state.subscriptions.size === 0) {
        continue;
      }
      await this.leases.refreshLeases(
        Array.from(state.subscriptions.keys()),
        this.memberKey(state.id),
        expiresAt,
      );
    }
  }

  private async sweepExpiredLeases() {
    const expiredKeys = await this.leases.sweepExpired(Date.now());
    for (const subscriptionKey of expiredKeys) {
      const preference = findPreference(
        subscriptionKey,
        this.states,
        this.sockets,
      );
      if (preference) {
        await this.publishControl("unsubscribe", subscriptionKey, preference);
      }
    }
  }

  private broadcastQuote(event: QuoteEvent) {
    const subscribers = this.subscriptionSubscribers.get(event.subscriptionKey);
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    const payload = JSON.stringify({
      type: "quote",
      data: publicQuote(event.quote),
    });

    for (const identity of subscribers) {
      this.socketHandles.get(identity)?.send(payload);
    }
  }

  private async publishControl(
    action: "subscribe" | "unsubscribe",
    subscriptionKey: string,
    preference: SubscriptionPreference,
  ) {
    await this.leases.publishControl(
      JSON.stringify({
        action,
        subscriptionKey,
        subscription: preference,
        source: this.gatewayId,
        timestamp: Date.now(),
      }),
    );
  }

  private memberKey(connectionId: string) {
    return `${this.gatewayId}:${connectionId}`;
  }
}

function normalizePreferences(
  input: unknown,
  catalog: CatalogService,
  mode: MarketMode,
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
      mode,
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

function isClientMessage(message: unknown): message is ClientMessage {
  return Boolean(
    message &&
      typeof message === "object" &&
      !Array.isArray(message) &&
      !(message instanceof ArrayBuffer) &&
      !(message instanceof Uint8Array) &&
      !Buffer.isBuffer(message),
  );
}

function requestId(message: ClientMessage) {
  return typeof message.requestId === "string" && message.requestId.trim()
    ? message.requestId.trim()
    : null;
}

function sendError(
  ws: GatewaySocket,
  code: string,
  message: string,
  messageRequestId: string | null = null,
) {
  ws.send(
    JSON.stringify({
      type: "error",
      error: { code, message },
      requestId: messageRequestId,
    }),
  );
}

function publicQuote(quote: QuoteEvent["quote"]) {
  const { raw: _raw, ...publicFields } = quote;
  return publicFields;
}

function findPreference(
  subscriptionKey: string,
  states: WeakMap<SocketIdentity, SocketState>,
  sockets: Set<SocketIdentity>,
) {
  for (const identity of sockets) {
    const state = states.get(identity);
    const preference = state?.subscriptions.get(subscriptionKey);
    if (preference) {
      return preference;
    }
  }
  return null;
}

function socketIdentity(socket: GatewaySocket): SocketIdentity {
  return socket.raw ?? socket;
}
