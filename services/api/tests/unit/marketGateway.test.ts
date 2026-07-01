import { expect, test } from "bun:test";
import { MarketGateway } from "../../src/ws/marketGateway";
import { makeCatalog, InMemoryLeases, InMemoryStore } from "../testSupport";
import type { ServerWebSocket } from "bun";

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
    60_000
  );
  await gateway.start();

  const { socket, messages } = createFakeSocket();
  gateway.open(socket);
  await gateway.message(
    socket,
    JSON.stringify({
      type: "subscribe",
      symbols: [{ symbol: "RELIANCE" }],
    })
  );

  expect(messages.some((message) => message.includes('"type":"subscribed"'))).toBeTrue();
  expect(leases.published).toHaveLength(1);

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

  expect(messages.some((message) => message.includes('"type":"quote"'))).toBeTrue();
});
