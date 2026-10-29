import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  mockCashLedgerEntries,
  orders,
  tradingAccounts,
  user,
} from "../../src/db/schemas/schema";
import {
  DrizzleMockTradingService,
  HttpError,
} from "../../src/services/trading/mockTradingService";
import type { InstrumentRecord, QuoteEnvelope } from "../../src/types/market";

const databaseTest = process.env.RUN_DATABASE_TESTS === "1" ? test : test.skip;

const instrument: InstrumentRecord = {
  instrumentKey: "NSE:EQUITY:3456",
  securityId: "3456",
  symbol: "RELIANCE",
  name: "Reliance Industries",
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
  searchableText: "reliance industries",
};

databaseTest(
  "verified onboarding and order retries are idempotent in PostgreSQL",
  async () => {
    const runId = crypto.randomUUID();
    const userId = `db-user-${runId}`;
    await db.insert(user).values({
      id: userId,
      name: "Database Test User",
      email: `${runId}@example.test`,
      emailVerified: true,
    });

    const quote: QuoteEnvelope = {
      instrument,
      stale: false,
      quote: {
        instrumentKey: instrument.instrumentKey,
        securityId: instrument.securityId,
        exchangeType: instrument.exchange,
        scripType: instrument.scripType,
        modeType: "QUOTE",
        found: true,
        tradable: true,
        lastPrice: 100,
        changePercent: 0,
        changeAbsolute: 0,
        lastTradeTime: new Date().toISOString(),
        lastUpdateTime: new Date().toISOString(),
        lastTradedQuantity: 1,
        averageTradedPrice: 100,
        volumeTraded: 1,
        totalBuyQuantity: 1,
        totalSellQuantity: 1,
        ohlc: { open: 100, high: 100, low: 100, close: 100 },
        week52High: 100,
        week52Low: 100,
        oi: null,
        changeOi: null,
        depth: null,
        providerTs: Date.now(),
        receivedAt: new Date().toISOString(),
        raw: { mustNotLeak: true },
      },
    };
    const service = new DrizzleMockTradingService(
      {
        resolve: () => instrument,
      } as unknown as ConstructorParameters<
        typeof DrizzleMockTradingService
      >[0],
      {
        getQuotes: async () => [quote],
      } as unknown as ConstructorParameters<
        typeof DrizzleMockTradingService
      >[1],
    );

    const [firstProvision, secondProvision] = (await Promise.all([
      service.ensurePracticeAccount(userId),
      service.ensurePracticeAccount(userId),
    ])) as Array<{ account: { id: string }; created: boolean }>;
    expect([firstProvision.created, secondProvision.created].sort()).toEqual([
      false,
      true,
    ]);

    const accountRows = await db
      .select()
      .from(tradingAccounts)
      .where(eq(tradingAccounts.userId, userId));
    expect(accountRows).toHaveLength(1);
    expect(accountRows[0]?.baseCurrency).toBe("INR");
    expect(accountRows[0]?.mockCashBalance).toBe("1000000.00000000");

    const ledgerRows = await db
      .select()
      .from(mockCashLedgerEntries)
      .where(eq(mockCashLedgerEntries.accountId, firstProvision.account.id));
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]?.type).toBe("initial_credit");

    const orderInput = {
      instrumentId: "RELIANCE",
      side: "buy" as const,
      type: "market" as const,
      quantity: 2,
      idempotencyKey: "db-retry-key",
    };
    const placed = (await service.placeOrder(
      userId,
      firstProvision.account.id,
      orderInput,
      { requestId: runId },
    )) as { replayed: boolean; order: { id: string } };
    const replayed = (await service.placeOrder(
      userId,
      firstProvision.account.id,
      orderInput,
      { requestId: runId },
    )) as { replayed: boolean; order: { id: string } };
    expect(placed.replayed).toBeFalse();
    expect(replayed.replayed).toBeTrue();
    expect(replayed.order.id).toBe(placed.order.id);

    const orderRows = await db
      .select()
      .from(orders)
      .where(eq(orders.accountId, firstProvision.account.id));
    expect(orderRows).toHaveLength(1);

    try {
      await service.placeOrder(
        userId,
        firstProvision.account.id,
        { ...orderInput, quantity: 3 },
        { requestId: runId },
      );
      throw new Error("Expected conflicting idempotency reuse to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).error).toBe("IDEMPOTENCY_KEY_REUSED");
    }

    if (!quote.quote) throw new Error("Expected a quote payload.");
    quote.quote.lastPrice = 110;
    quote.quote.receivedAt = new Date().toISOString();
    quote.quote.lastTradeTime = quote.quote.receivedAt;
    const sold = (await service.placeOrder(
      userId,
      firstProvision.account.id,
      {
        instrumentId: "RELIANCE",
        side: "sell",
        type: "market",
        quantity: 1,
        idempotencyKey: "db-sell-key",
      },
      { requestId: runId },
    )) as { realizedPnl: number; trade: { side: string } };
    expect(sold.trade.side).toBe("sell");
    expect(sold.realizedPnl).toBe(10);

    const activity = (await service.listAccountActivity(
      userId,
      firstProvision.account.id,
      { limit: 2 },
    )) as { entries: unknown[]; nextCursor: string | null };
    expect(activity.entries).toHaveLength(2);
    expect(activity.nextCursor).not.toBeNull();

    quote.quote.lastPrice = 100;
    quote.quote.receivedAt = new Date().toISOString();
    quote.quote.lastTradeTime = quote.quote.receivedAt;
    const concurrentBuys = await Promise.allSettled(
      ["concurrent-buy-a", "concurrent-buy-b"].map((idempotencyKey) =>
        service.placeOrder(
          userId,
          firstProvision.account.id,
          {
            instrumentId: "RELIANCE",
            side: "buy",
            type: "market",
            quantity: 6_000,
            idempotencyKey,
          },
          { requestId: runId },
        ),
      ),
    );
    expect(
      concurrentBuys.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejectedBuy = concurrentBuys.find(
      (result) => result.status === "rejected",
    );
    expect(rejectedBuy?.status).toBe("rejected");
    if (rejectedBuy?.status === "rejected") {
      expect((rejectedBuy.reason as HttpError).error).toBe(
        "INSUFFICIENT_MOCK_CASH",
      );
    }

    quote.quote.receivedAt = new Date().toISOString();
    quote.quote.lastTradeTime = quote.quote.receivedAt;
    const concurrentSells = await Promise.allSettled(
      ["concurrent-sell-a", "concurrent-sell-b"].map((idempotencyKey) =>
        service.placeOrder(
          userId,
          firstProvision.account.id,
          {
            instrumentId: "RELIANCE",
            side: "sell",
            type: "market",
            quantity: 4_000,
            idempotencyKey,
          },
          { requestId: runId },
        ),
      ),
    );
    // Sells are serialized on the account row: the first closes 4,000 of the
    // 6,001 held; the second would short 1,999 on delivery, which is refused.
    expect(
      concurrentSells.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejectedSell = concurrentSells.find(
      (result) => result.status === "rejected",
    );
    if (rejectedSell?.status === "rejected") {
      expect((rejectedSell.reason as HttpError).error).toBe(
        "SHORT_SELL_INTRADAY_ONLY",
      );
    }
    const [soldAccount] = await db
      .select()
      .from(tradingAccounts)
      .where(eq(tradingAccounts.id, firstProvision.account.id));
    expect(Number(soldAccount?.mockCashBalance)).toBe(799_910);
    expect(Number(soldAccount?.mockBuyingPower)).toBe(799_910);

    quote.quote.receivedAt = new Date().toISOString();
    quote.quote.lastTradeTime = quote.quote.receivedAt;
    quote.quote.lastPrice = 90;
    const closed = (await service.placeOrder(
      userId,
      firstProvision.account.id,
      {
        instrumentId: "RELIANCE",
        side: "sell",
        type: "market",
        quantity: 2_001,
        idempotencyKey: "close-long",
      },
      { requestId: runId },
    )) as { realizedPnl: number; position: { quantity: string } };
    expect(closed.realizedPnl).toBe(-20_010);
    expect(Number(closed.position.quantity)).toBe(0);
    const [flatAccount] = await db
      .select()
      .from(tradingAccounts)
      .where(eq(tradingAccounts.id, firstProvision.account.id));
    expect(Number(flatAccount?.mockCashBalance)).toBe(980_000);
    expect(Number(flatAccount?.mockBuyingPower)).toBe(980_000);
  },
);
