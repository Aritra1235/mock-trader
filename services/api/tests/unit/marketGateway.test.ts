import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { MarketGateway } from "../../src/ws/marketGateway";
import { InMemoryLeases, InMemoryStore, makeCatalog } from "../testSupport";

function createFakeSocket() {
  const messages: string[] = [];
  return {
    socket: {
      send(payload: string) {
        messages.push(payload);
      },
    } as unknown as ServerWebSocket<unknown>,
    messages,
  };
}

test("gateway subscribes once and fans out quote events", async () => {
  const catalog = await makeCatalog("/tmp/mock-trader-catalog-gateway.json");
  const leases = new InMemoryLeases();
  const store = new InMemoryStore();
  const gateway = new MarketGateway(
    "gateway-test",
    catalog,
    leases,
    store,
    "QUOTE",
    10,
    60_000,
    60_000,
    60_000,
  );
  await gateway.start();

  const { socket, messages } = createFakeSocket();
  gateway.open(socket);
  await gateway.message(
    socket,
    JSON.stringify({
      type: "subscribe",
      symbols: [{ symbol: "RELIANCE" }],
    }),
  );

  expect(
    messages.some((message) => message.includes('"type":"subscribed"')),
  ).toBeTrue();
  expect(leases.published).toHaveLength(1);

  const fullClient = createFakeSocket();
  gateway.open(fullClient.socket);
  await gateway.message(fullClient.socket, {
    type: "subscribe",
    modeType: "FULL",
    symbols: [{ symbol: "RELIANCE" }],
  });

  await store.publishQuoteEvent({
    type: "quote",
    instrumentKey: "NSE:EQUITY:3456",
    subscriptionKey: "NSE:EQUITY:3456:QUOTE",
    quote: {
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
    },
  });

  expect(
    messages.some((message) => message.includes('"type":"quote"')),
  ).toBeTrue();
  expect(
    fullClient.messages.some((message) => message.includes('"type":"quote"')),
  ).toBeFalse();
});

test("gateway unsubscribes using the requested market mode", async () => {
  const catalog = await makeCatalog(
    "/tmp/mock-trader-catalog-gateway-unsubscribe.json",
  );
  const leases = new InMemoryLeases();
  const store = new InMemoryStore();
  const gateway = new MarketGateway(
    "gateway-test",
    catalog,
    leases,
    store,
    "QUOTE",
    10,
    60_000,
    60_000,
    60_000,
  );
  await gateway.start();

  const { socket, messages } = createFakeSocket();
  gateway.open(socket);
  await gateway.message(
    socket,
    JSON.stringify({
      type: "subscribe",
      modeType: "FULL",
      symbols: [{ symbol: "RELIANCE" }],
    }),
  );
  await gateway.message(
    socket,
    JSON.stringify({
      type: "unsubscribe",
      modeType: "FULL",
      symbols: [{ symbol: "RELIANCE" }],
    }),
  );

  const acknowledgement = messages.find((message) =>
    message.includes('"type":"unsubscribed"'),
  );
  expect(acknowledgement).toContain('"count":1');
  expect(leases.published).toHaveLength(2);
});

test("gateway accepts JSON objects parsed by the Elysia websocket layer", async () => {
  const catalog = await makeCatalog(
    "/tmp/mock-trader-catalog-gateway-parsed-message.json",
  );
  const leases = new InMemoryLeases();
  const store = new InMemoryStore();
  const gateway = new MarketGateway(
    "gateway-test",
    catalog,
    leases,
    store,
    "QUOTE",
    10,
    60_000,
    60_000,
    60_000,
  );
  await gateway.start();

  const { socket, messages } = createFakeSocket();
  gateway.open(socket);
  await gateway.message(socket, { type: "ping" });
  await gateway.message(socket, {
    type: "subscribe",
    modeType: "QUOTE",
    symbols: [{ symbol: "RELIANCE" }],
  });

  expect(
    messages.some((message) => message.includes('"type":"pong"')),
  ).toBeTrue();
  expect(
    messages.some((message) => message.includes('"type":"subscribed"')),
  ).toBeTrue();
});

test("gateway keeps connection state across Elysia websocket wrappers", async () => {
  const catalog = await makeCatalog(
    "/tmp/mock-trader-catalog-gateway-wrapper-identity.json",
  );
  const leases = new InMemoryLeases();
  const store = new InMemoryStore();
  const gateway = new MarketGateway(
    "gateway-test",
    catalog,
    leases,
    store,
    "QUOTE",
    10,
    60_000,
    60_000,
    60_000,
  );
  await gateway.start();

  const raw = {};
  const openMessages: string[] = [];
  const messageMessages: string[] = [];
  const openSocket = {
    raw,
    send(payload: string) {
      openMessages.push(payload);
    },
  };
  const messageSocket = {
    raw,
    send(payload: string) {
      messageMessages.push(payload);
    },
  };

  gateway.open(openSocket);
  await gateway.message(messageSocket, {
    type: "subscribe",
    modeType: "QUOTE",
    symbols: [{ symbol: "RELIANCE" }],
  });

  expect(openMessages[0]).toContain('"type":"connected"');
  expect(
    messageMessages.some((message) => message.includes('"type":"subscribed"')),
  ).toBeTrue();
  expect(leases.published).toHaveLength(1);
});

test("gateway re-announces active subscriptions on each heartbeat", async () => {
  const catalog = await makeCatalog("/tmp/mock-trader-catalog-reannounce.json");
  const leases = new InMemoryLeases();
  const gateway = new MarketGateway(
    "gateway-test",
    catalog,
    leases,
    new InMemoryStore(),
    "QUOTE",
    10,
    60_000,
    20,
    60_000,
  );
  await gateway.start();

  const { socket } = createFakeSocket();
  gateway.open(socket);
  await gateway.message(socket, {
    type: "subscribe",
    symbols: [{ symbol: "RELIANCE" }],
  });
  // Simulate the worker having missed the original subscribe.
  leases.published = [];

  await Bun.sleep(60);
  gateway.stop();

  const control = leases.published.map(
    (message) =>
      JSON.parse(message) as { action: string; subscriptionKey: string },
  );
  expect(control.length).toBeGreaterThan(0);
  expect(
    control.every(
      (message) =>
        message.action === "subscribe" &&
        message.subscriptionKey === "NSE:EQUITY:3456:QUOTE",
    ),
  ).toBeTrue();
});
