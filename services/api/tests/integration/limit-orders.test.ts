import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  orderReservations,
  orders,
  positions,
  trades,
  tradingAccounts,
  user,
} from "../../src/db/schemas/schema";
import {
  type CreateOrderInput,
  DrizzleMockTradingService,
} from "../../src/services/trading/mockTradingService";
import type { InstrumentRecord, QuoteEnvelope } from "../../src/types/market";

const databaseTest = process.env.RUN_DATABASE_TESTS === "1" ? test : test.skip;
const instrument: InstrumentRecord = {
  instrumentKey: "NSE:EQUITY:LIMIT_TEST",
  securityId: "LIMIT_TEST",
  symbol: "LIMIT_TEST",
  name: "Limit test",
  series: "EQ",
  exchange: "NSE",
  segment: "EQUITY",
  instrumentType: "EQUITY",
  scripType: "EQUITY",
  tickSize: 0.05,
  lotSize: 1,
  upperLimit: 200,
  lowerLimit: 50,
  expiryDate: null,
  strikePrice: null,
  freezeQuantity: 100_000,
  searchableText: "limit test",
};

async function harness(balance = 1_000) {
  const userId = crypto.randomUUID();
  await db.insert(user).values({
    id: userId,
    name: "Limit test",
    email: `${userId}@example.test`,
    emailVerified: true,
  });
  const state = {
    now: new Date("2026-10-29T05:00:00Z"),
    price: 100,
    stale: false,
    missing: false,
    outage: false,
    tradable: true,
    age: 0,
  };
  const service = new DrizzleMockTradingService(
    {
      resolve: (key: string) =>
        key === instrument.instrumentKey ? instrument : null,
    } as ConstructorParameters<typeof DrizzleMockTradingService>[0],
    {
      getQuotes: async () => {
        if (state.outage) throw new Error("Provider offline");
        const receivedAt = new Date(
          state.now.getTime() - state.age,
        ).toISOString();
        const envelope: QuoteEnvelope = {
          instrument,
          stale: state.stale,
          quote: state.missing
            ? null
            : {
                instrumentKey: instrument.instrumentKey,
                securityId: instrument.securityId,
                exchangeType: "NSE",
                scripType: "EQUITY",
                modeType: "QUOTE",
                found: true,
                tradable: state.tradable,
                lastPrice: state.price,
                changePercent: 0,
                changeAbsolute: 0,
                lastTradeTime: receivedAt,
                lastUpdateTime: receivedAt,
                lastTradedQuantity: 1,
                averageTradedPrice: state.price,
                volumeTraded: 1,
                totalBuyQuantity: 1,
                totalSellQuantity: 1,
                ohlc: { open: 100, high: 200, low: 50, close: 100 },
                week52High: 200,
                week52Low: 50,
                oi: null,
                changeOi: null,
                depth: null,
                providerTs: state.now.getTime(),
                receivedAt,
                raw: {},
              },
        };
        return [envelope];
      },
    } as unknown as ConstructorParameters<typeof DrizzleMockTradingService>[1],
    db,
    () => state.now,
  );
  const provisioned = await service.ensurePracticeAccount(userId, {
    startingBalance: balance,
  });
  const accountId = provisioned.account.id;
  const place = (input: Partial<CreateOrderInput> = {}) =>
    service.placeOrder(
      userId,
      accountId,
      {
        instrumentId: instrument.instrumentKey,
        side: "buy",
        type: "limit",
        limitPrice: 90,
        quantity: 1,
        idempotencyKey: crypto.randomUUID(),
        ...input,
      },
      {},
    );
  const account = async () =>
    (
      await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.id, accountId))
    )[0];
  const order = async (id: string) =>
    (await db.select().from(orders).where(eq(orders.id, id)))[0];
  const fills = () =>
    db.select().from(trades).where(eq(trades.accountId, accountId));
  const reservations = () =>
    db
      .select()
      .from(orderReservations)
      .where(eq(orderReservations.accountId, accountId));
  return {
    state,
    service,
    userId,
    accountId,
    place,
    account,
    order,
    fills,
    reservations,
  };
}

databaseTest(
  "a resting buy reserves cash, retries once, and concurrent matchers fill only once at a better price",
  async () => {
    const h = await harness();
    const placed = await h.place({
      quantity: 5,
      idempotencyKey: "resting-buy",
    });
    expect(placed.filled).toBeFalse();
    expect(placed.order.status).toBe("accepted");
    expect(placed.order.limitPrice).toBe("90.00000000");
    expect(Number((await h.account()).reservedMockCash)).toBe(450);
    expect(Number((await h.account()).mockBuyingPower)).toBe(550);
    const replay = await h.place({
      quantity: 5,
      idempotencyKey: "resting-buy",
    });
    expect(replay.replayed).toBeTrue();
    expect(replay.order.id).toBe(placed.order.id);
    expect(await h.reservations()).toHaveLength(1);
    await expect(
      h.place({ quantity: 6, idempotencyKey: "resting-buy" }),
    ).rejects.toMatchObject({ error: "IDEMPOTENCY_KEY_REUSED" });
    await h.service.processOpenOrders();
    expect(await h.fills()).toHaveLength(0);
    h.state.price = 89;
    await Promise.all([
      h.service.processOpenOrders(),
      h.service.processOpenOrders(),
    ]);
    expect(await h.fills()).toHaveLength(1);
    expect((await h.fills())[0].price).toBe("89.00000000");
    expect((await h.fills())[0].executionReason).toBe(
      "limit_order_price_matched",
    );
    expect((await h.order(placed.order.id)).status).toBe("filled");
    expect(Number((await h.account()).reservedMockCash)).toBe(0);
    expect(Number((await h.account()).mockBuyingPower)).toBe(555);
    expect(
      (await h.place({ quantity: 5, idempotencyKey: "resting-buy" })).filled,
    ).toBeTrue();
  },
);

databaseTest(
  "marketable buy and sell limits fill at the live price instead of the entered limit",
  async () => {
    const h = await harness();
    const buy = await h.place({ quantity: 2, limitPrice: 110 });
    expect(buy.filled).toBeTrue();
    expect(buy.trade?.price).toBe("100.00000000");
    const sell = await h.place({ side: "sell", quantity: 2, limitPrice: 90 });
    expect(sell.filled).toBeTrue();
    expect(sell.trade?.price).toBe("100.00000000");
    expect(Number((await h.account()).mockBuyingPower)).toBe(1_000);
    expect(await h.reservations()).toHaveLength(0);
  },
);

databaseTest(
  "IOC cancels an unmatched order without reservations and fills a matching order immediately",
  async () => {
    const h = await harness();
    const canceled = await h.place({
      timeInForce: "ioc",
      idempotencyKey: "ioc",
    });
    expect(canceled.filled).toBeFalse();
    expect(canceled.order.status).toBe("canceled");
    expect(await h.reservations()).toHaveLength(0);
    expect(Number((await h.account()).mockBuyingPower)).toBe(1_000);
    expect(
      (await h.place({ timeInForce: "ioc", idempotencyKey: "ioc" })).replayed,
    ).toBeTrue();
    expect(
      (await h.place({ timeInForce: "ioc", limitPrice: 105 })).filled,
    ).toBeTrue();
    h.state.missing = true;
    expect(
      (await h.place({ timeInForce: "ioc", limitPrice: 105 })).order.status,
    ).toBe("canceled");
  },
);

databaseTest(
  "Day orders expire during an outage while GTC survives and fills next session",
  async () => {
    const h = await harness();
    const day = await h.place();
    const gtc = await h.place({ timeInForce: "gtc" });
    expect(gtc.order.expiresAt).toBeNull();
    h.state.now = new Date("2026-10-29T10:00:00Z");
    h.state.outage = true;
    await h.service.processOpenOrders();
    expect((await h.order(day.order.id)).status).toBe("expired");
    expect((await h.order(gtc.order.id)).status).toBe("accepted");
    expect(Number((await h.account()).reservedMockCash)).toBe(90);
    h.state.now = new Date("2026-10-30T05:00:00Z");
    h.state.outage = false;
    h.state.price = 89;
    await h.service.processOpenOrders();
    expect((await h.order(gtc.order.id)).status).toBe("filled");
    expect(Number((await h.account()).mockBuyingPower)).toBe(911);
  },
);

databaseTest(
  "cancel releases both held shares and short margin and cannot release them twice",
  async () => {
    const h = await harness();
    const intraday = { product: "intraday" as const };
    await h.place({
      ...intraday,
      type: "market",
      limitPrice: null,
      quantity: 3,
    });
    // 300 spent from cash, only the 20% margin (60) held: 1,000 - 60.
    expect(Number((await h.account()).mockBuyingPower)).toBe(940);
    const sell = await h.place({
      ...intraday,
      side: "sell",
      quantity: 5,
      limitPrice: 120,
    });
    const reservation = (await h.reservations())[0];
    expect(Number(reservation.reservedQuantity)).toBe(3);
    expect(Number(reservation.reservedMockCash)).toBe(48);
    expect(Number((await h.account()).mockBuyingPower)).toBe(892);
    await expect(
      h.place({ ...intraday, type: "market", limitPrice: null, side: "sell" }),
    ).rejects.toMatchObject({ error: "INSUFFICIENT_POSITION" });
    await h.service.cancelOrder(h.userId, sell.order.id, {}, {});
    expect(Number((await h.account()).mockBuyingPower)).toBe(940);
    await expect(
      h.service.cancelOrder(h.userId, sell.order.id, {}, {}),
    ).rejects.toMatchObject({ error: "ORDER_NOT_CANCELABLE" });
    expect(Number((await h.account()).mockBuyingPower)).toBe(940);
    expect((await h.reservations())[0].status).toBe("released");
  },
);

databaseTest(
  "resting short sales and covers use the existing collateral and P&L accounting",
  async () => {
    const h = await harness();
    const intraday = { product: "intraday" as const };
    const sell = await h.place({
      ...intraday,
      side: "sell",
      quantity: 2,
      limitPrice: 120,
    });
    h.state.price = 130;
    await h.service.processOpenOrders();
    expect((await h.order(sell.order.id)).status).toBe("filled");
    // Proceeds stay as collateral plus 20% margin: 1,260 - 1.2 * 260.
    expect(Number((await h.account()).mockBuyingPower)).toBe(948);
    const cover = await h.place({ ...intraday, quantity: 2, limitPrice: 125 });
    expect(Number((await h.account()).mockBuyingPower)).toBe(898);
    h.state.price = 120;
    await h.service.processOpenOrders();
    expect((await h.order(cover.order.id)).status).toBe("filled");
    expect(Number((await h.account()).mockCashBalance)).toBe(1_020);
    expect(Number((await h.account()).mockBuyingPower)).toBe(1_020);
  },
);

databaseTest(
  "a resting sell can close held shares and short the remainder in one fill",
  async () => {
    const h = await harness();
    const intraday = { product: "intraday" as const };
    await h.place({
      ...intraday,
      type: "market",
      limitPrice: null,
      quantity: 3,
    });
    const sell = await h.place({
      ...intraday,
      side: "sell",
      quantity: 5,
      limitPrice: 120,
    });
    h.state.price = 130;
    await h.service.processOpenOrders();
    expect((await h.order(sell.order.id)).status).toBe("filled");
    expect(Number((await h.account()).reservedMockCash)).toBe(0);
    expect(Number((await h.account()).mockCashBalance)).toBe(1_350);
    expect(Number((await h.account()).mockBuyingPower)).toBe(1_038);
    expect(await h.fills()).toHaveLength(2);
  },
);

databaseTest("delivery orders cannot open a short", async () => {
  const h = await harness();
  await expect(
    h.place({ side: "sell", quantity: 2, limitPrice: 120 }),
  ).rejects.toMatchObject({ error: "SHORT_SELL_INTRADAY_ONLY" });
  await h.place({ type: "market", limitPrice: null, quantity: 1 });
  await expect(
    h.place({ type: "market", limitPrice: null, side: "sell", quantity: 2 }),
  ).rejects.toMatchObject({ error: "SHORT_SELL_INTRADAY_ONLY" });
  expect(await h.fills()).toHaveLength(1);
});

databaseTest(
  "resting orders stop trading when their owner becomes restricted",
  async () => {
    const h = await harness();
    const placed = await h.place();
    await db
      .update(user)
      .set({ trading_status: "restricted" })
      .where(eq(user.id, h.userId));
    h.state.price = 80;
    await h.service.processOpenOrders();
    expect((await h.order(placed.order.id)).status).toBe("rejected");
    expect(Number((await h.account()).reservedMockCash)).toBe(0);
    expect(Number((await h.account()).mockBuyingPower)).toBe(1_000);
    expect(await h.fills()).toHaveLength(0);
  },
);

databaseTest(
  "a gap that exceeds short margin rejects the fill and restores every reservation",
  async () => {
    const h = await harness();
    const order = {
      product: "intraday" as const,
      side: "sell" as const,
      quantity: 40,
      limitPrice: 120,
      idempotencyKey: "gap",
    };
    const sell = await h.place(order);
    // 20% of 40 x 120 reserved.
    expect(Number((await h.account()).mockBuyingPower)).toBe(40);
    // Filling at 150 would hold 1.2 x 6,000 against 7,000 of cash.
    h.state.price = 150;
    await h.service.processOpenOrders();
    expect((await h.order(sell.order.id)).status).toBe("rejected");
    expect(Number((await h.account()).mockBuyingPower)).toBe(1_000);
    expect(Number((await h.account()).reservedMockCash)).toBe(0);
    expect(await h.fills()).toHaveLength(0);
    expect((await h.place(order)).order.status).toBe("rejected");
  },
);

databaseTest(
  "missing, stale, nontradable, and old quotes never fill a resting limit",
  async () => {
    const h = await harness();
    h.state.outage = true;
    const placed = await h.place();
    h.state.outage = false;
    h.state.price = 80;
    for (const invalidQuote of [
      { missing: true },
      { stale: true },
      { tradable: false },
      { age: 20_000 },
    ]) {
      Object.assign(h.state, invalidQuote);
      await h.service.processOpenOrders();
      expect((await h.order(placed.order.id)).status).toBe("accepted");
      h.state.missing = false;
      h.state.stale = false;
      h.state.tradable = true;
      h.state.age = 0;
    }
    await h.service.processOpenOrders();
    expect((await h.order(placed.order.id)).status).toBe("filled");
  },
);

databaseTest(
  "concurrent placements cannot reserve the same buying power twice",
  async () => {
    const h = await harness();
    const results = await Promise.allSettled([
      h.place({ quantity: 6 }),
      h.place({ quantity: 6 }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(Number((await h.account()).reservedMockCash)).toBe(540);
    const accepted = results.find((result) => result.status === "fulfilled");
    if (accepted?.status === "fulfilled")
      await h.service.cancelOrder(h.userId, accepted.value.order.id, {}, {});
  },
);

databaseTest(
  "cancel racing a fill leaves one terminal state with no leaked reservations",
  async () => {
    const h = await harness();
    const placed = await h.place({ quantity: 2 });
    h.state.price = 80;
    await Promise.allSettled([
      h.service.processOpenOrders(),
      h.service.cancelOrder(h.userId, placed.order.id, {}, {}),
    ]);
    const order = await h.order(placed.order.id);
    expect(["canceled", "filled"]).toContain(order.status);
    expect(Number((await h.account()).reservedMockCash)).toBe(0);
    expect(await h.fills()).toHaveLength(order.status === "filled" ? 1 : 0);
    expect(Number((await h.account()).mockBuyingPower)).toBe(
      order.status === "filled" ? 840 : 1_000,
    );
  },
);

databaseTest(
  "invalid prices and unsupported fields are rejected before an order can execute",
  async () => {
    const h = await harness();
    for (const limitPrice of [
      null,
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      await expect(h.place({ limitPrice })).rejects.toMatchObject({
        error: "INVALID_LIMIT_PRICE",
      });
    }
    await expect(h.place({ limitPrice: 90.03 })).rejects.toMatchObject({
      error: "INVALID_TICK_SIZE",
    });
    await expect(h.place({ type: "market" })).rejects.toMatchObject({
      error: "UNSUPPORTED_ORDER_FIELDS",
    });
    await expect(h.place({ stopPrice: 85 })).rejects.toMatchObject({
      error: "UNSUPPORTED_ORDER_FIELDS",
    });
    await expect(h.place({ type: "stop" })).rejects.toMatchObject({
      error: "UNSUPPORTED_ORDER_TYPE",
    });
    await expect(h.place({ timeInForce: "fok" })).rejects.toMatchObject({
      error: "UNSUPPORTED_TIME_IN_FORCE",
    });
    expect(await h.fills()).toHaveLength(0);
  },
);

databaseTest(
  "after-hours Day limits wait for the next session even when the quote matches",
  async () => {
    const h = await harness();
    h.state.now = new Date("2026-10-30T11:00:00Z");
    h.state.price = 80;
    const placed = await h.place();
    expect(placed.filled).toBeFalse();
    expect(placed.order.expiresAt?.toISOString()).toBe(
      "2026-11-02T10:00:00.000Z",
    );
    await h.service.processOpenOrders();
    expect((await h.order(placed.order.id)).status).toBe("accepted");
    h.state.now = new Date("2026-11-02T04:00:00Z");
    await h.service.processOpenOrders();
    expect((await h.order(placed.order.id)).status).toBe("filled");
  },
);

const atIst = (time: string, date = "2026-10-29") =>
  new Date(`${date}T${time}:00+05:30`);
const market = { type: "market" as const, limitPrice: null };
const intraday = { product: "intraday" as const };

databaseTest(
  "intraday buys use 5x leverage while delivery needs full cash",
  async () => {
    const h = await harness();
    await expect(h.place({ ...market, quantity: 40 })).rejects.toMatchObject({
      error: "INSUFFICIENT_MOCK_CASH",
    });
    const placed = await h.place({ ...intraday, ...market, quantity: 40 });
    expect(placed.order.product).toBe("intraday");
    // 4,000 of stock on 800 margin.
    expect(Number((await h.account()).mockCashBalance)).toBe(-3_000);
    expect(Number((await h.account()).mockBuyingPower)).toBe(200);
    await h.place({ ...intraday, ...market, quantity: 10 });
    expect(Number((await h.account()).mockBuyingPower)).toBe(0);
    await expect(
      h.place({ ...intraday, ...market, quantity: 1 }),
    ).rejects.toMatchObject({ error: "INSUFFICIENT_MOCK_CASH" });
    // Exits are always allowed.
    await h.place({ ...intraday, ...market, side: "sell", quantity: 50 });
    expect(Number((await h.account()).mockBuyingPower)).toBe(1_000);
  },
);

databaseTest(
  "intraday and delivery positions in one stock stay separate",
  async () => {
    const h = await harness();
    await h.place({ ...market, quantity: 2 });
    await h.place({ ...intraday, ...market, quantity: 3 });
    const rows = await db
      .select()
      .from(positions)
      .where(eq(positions.accountId, h.accountId));
    expect(
      Object.fromEntries(
        rows.map((row) => [row.product, Number(row.quantity)]),
      ),
    ).toEqual({ delivery: 2, intraday: 3 });
    // Selling 3 on delivery would short the delivery side.
    await expect(
      h.place({ ...market, side: "sell", quantity: 3 }),
    ).rejects.toMatchObject({ error: "SHORT_SELL_INTRADAY_ONLY" });
  },
);

databaseTest(
  "intraday entry and validity follow the square-off window",
  async () => {
    const h = await harness();
    await expect(
      h.place({ ...intraday, timeInForce: "gtc" }),
    ).rejects.toMatchObject({ error: "UNSUPPORTED_TIME_IN_FORCE" });
    const resting = await h.place({ ...intraday, quantity: 2 });
    expect(resting.order.expiresAt?.toISOString()).toBe(
      "2026-10-29T09:50:00.000Z",
    );
    await h.service.cancelOrder(h.userId, resting.order.id, {}, {});

    await h.place({ ...intraday, ...market, quantity: 2 });
    h.state.now = atIst("15:16");
    await expect(
      h.place({ ...intraday, ...market, quantity: 1 }),
    ).rejects.toMatchObject({ error: "INTRADAY_ENTRY_CLOSED" });
    await h.place({ ...intraday, ...market, side: "sell", quantity: 1 });
    h.state.now = atIst("15:21");
    await expect(
      h.place({ ...intraday, ...market, side: "sell", quantity: 1 }),
    ).rejects.toMatchObject({ error: "INTRADAY_CLOSED" });
  },
);

databaseTest(
  "square-off closes intraday positions at the latest price and cancels their orders",
  async () => {
    const h = await harness();
    await h.place({ ...market, quantity: 2 });
    await h.place({ ...intraday, ...market, quantity: 10 });
    const exit = await h.place({
      ...intraday,
      side: "sell",
      quantity: 5,
      limitPrice: 150,
    });

    h.state.now = atIst("15:19");
    await h.service.squareOffIntradayPositions();
    expect((await h.order(exit.order.id)).status).toBe("accepted");

    h.state.now = atIst("15:21");
    h.state.price = 110;
    await h.service.squareOffIntradayPositions();
    await h.service.squareOffIntradayPositions();

    expect((await h.order(exit.order.id)).status).toBe("canceled");
    const rows = await db
      .select()
      .from(positions)
      .where(eq(positions.accountId, h.accountId));
    expect(
      Object.fromEntries(
        rows.map((row) => [row.product, Number(row.quantity)]),
      ),
    ).toEqual({ delivery: 2, intraday: 0 });
    const squareOffs = await db
      .select()
      .from(orders)
      .where(eq(orders.source, "auto_square_off"));
    const mine = squareOffs.filter((order) => order.accountId === h.accountId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: "filled", side: "sell" });
    const fill = (await h.fills()).find(
      (trade) => trade.orderId === mine[0].id,
    );
    expect(fill?.executionReason).toBe("intraday_auto_square_off");
    expect(Number(fill?.price)).toBe(110);
    // 1,000 - 200 delivery - 1,000 intraday + 1,100 square-off.
    expect(Number((await h.account()).mockCashBalance)).toBe(900);
    expect(Number((await h.account()).mockBuyingPower)).toBe(900);
    expect(Number((await h.account()).reservedMockCash)).toBe(0);
  },
);

databaseTest(
  "square-off covers an intraday short even on a stale quote",
  async () => {
    const h = await harness();
    await h.place({ ...intraday, ...market, side: "sell", quantity: 4 });
    h.state.now = atIst("16:30");
    h.state.price = 90;
    h.state.stale = true;
    await h.service.squareOffIntradayPositions();
    const [row] = await db
      .select()
      .from(positions)
      .where(eq(positions.accountId, h.accountId));
    expect(Number(row.quantity)).toBe(0);
    expect(Number(row.realizedPnl)).toBe(40);
    expect(Number((await h.account()).mockBuyingPower)).toBe(1_040);
  },
);
