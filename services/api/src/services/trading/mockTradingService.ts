import { Buffer } from "node:buffer";
import { and, desc, eq, inArray, lt, ne, or } from "drizzle-orm";
import { MVP_PRODUCT } from "../../config/product";
import { type Database, db } from "../../db";
import {
  accountRiskReviews,
  competitionParticipants,
  competitions,
  fraudAlerts,
  fraudSignals,
  instruments,
  leaderboardEntries,
  marketQuotes,
  mockCashLedgerEntries,
  orderEvents,
  orderReservations,
  orders,
  portfolioSnapshots,
  positionLots,
  positions,
  trades,
  tradingAccounts,
  user,
} from "../../db/schemas/schema";
import { log } from "../../lib/log";
import type { InstrumentRecord, QuoteEnvelope } from "../../types/market";
import type { CatalogService } from "../catalogService";
import type { MarketDataService } from "../marketDataService";
import {
  dayOrderExpiry,
  INTRADAY_MARGIN_RATE,
  intradayOrderExpiry,
  isIntradayEntryOpen,
  isIntradaySquareOffDue,
  isOrderSessionOpen,
  limitPriceMatches,
} from "./orderPolicy";

type OrderSide = "buy" | "sell";

/**
 * A short sale credits its proceeds to cash, but buying power drops by the
 * sale value: the proceeds stay as collateral and the same amount again is
 * held as margin (2x the entry value in total). Covering releases it.
 * Only legacy delivery shorts use this; new shorts must be intraday.
 */
const SHORT_HOLD_FACTOR = 2;
type OrderProduct = "delivery" | "intraday";
const AUTO_SQUARE_OFF_SOURCE = "auto_square_off";
type OrderType = "market" | "limit" | "stop" | "stop_limit";
type TimeInForce = "day" | "gtc" | "ioc" | "fok";

export interface RequestContext {
  sessionId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceFingerprint?: string | null;
  requestId?: string | null;
}

export interface PageOptions {
  cursor?: string | null;
  limit?: number;
}

export interface CreateOrderInput {
  instrumentId: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  limitPrice?: number | null;
  stopPrice?: number | null;
  timeInForce?: TimeInForce;
  product?: OrderProduct;
  clientOrderId?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CancelOrderInput {
  reason?: string | null;
}

export interface LeaderboardOptions {
  includeIneligible?: boolean;
}

export interface EligibilityInput {
  eligible: boolean;
  reason?: string | null;
}

export interface DisqualifyInput {
  reason: string;
}

export interface ResolveInput {
  status?: string;
  notes?: string | null;
}

export interface MockTradingService {
  getMe(userId: string): Promise<unknown>;
  ensurePracticeAccount(
    userId: string,
    options?: { startingBalance?: number },
  ): Promise<unknown>;
  getAccount(userId: string, accountId: string): Promise<unknown>;
  listAccountActivity(
    userId: string,
    accountId: string,
    options?: PageOptions,
  ): Promise<unknown>;
  getPortfolio(userId: string): Promise<unknown>;
  listPositions(userId: string, accountId: string): Promise<unknown>;
  listOrders(
    userId: string,
    accountId: string,
    options?: PageOptions,
  ): Promise<unknown>;
  listTrades(
    userId: string,
    accountId: string,
    options?: PageOptions,
  ): Promise<unknown>;
  placeOrder(
    userId: string,
    accountId: string,
    input: CreateOrderInput,
    context: RequestContext,
  ): Promise<unknown>;
  cancelOrder(
    userId: string,
    orderId: string,
    input: CancelOrderInput,
    context: RequestContext,
  ): Promise<unknown>;
  listCompetitions(): Promise<unknown>;
  getLeaderboard(
    competitionId: string,
    options: LeaderboardOptions,
  ): Promise<unknown>;
  listRiskReviews(): Promise<unknown>;
  resolveRiskReview(
    reviewerUserId: string,
    reviewId: string,
    input: ResolveInput,
  ): Promise<unknown>;
  listFraudAlerts(): Promise<unknown>;
  resolveFraudAlert(
    resolverUserId: string,
    alertId: string,
    input: ResolveInput,
  ): Promise<unknown>;
  setLeaderboardEligibility(
    accountId: string,
    input: EligibilityInput,
  ): Promise<unknown>;
  disqualifyParticipant(
    participantId: string,
    input: DisqualifyInput,
  ): Promise<unknown>;
}

type TradingDb = Database;
type Tx = Parameters<Parameters<TradingDb["transaction"]>[0]>[0];
type ExecutionResult = {
  order: typeof orders.$inferSelect;
  trade: typeof trades.$inferSelect;
  account: typeof tradingAccounts.$inferSelect;
  position: typeof positions.$inferSelect;
  filled: true;
  realizedPnl?: number;
};

export class DrizzleMockTradingService implements MockTradingService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly marketData: MarketDataService,
    private readonly database: TradingDb = db,
    private readonly now: () => Date = () => new Date(),
    private readonly quoteStaleMs = 15_000,
  ) {}

  async getMe(userId: string) {
    const [profile] = await this.database
      .select()
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!profile) {
      throw new HttpError(404, "USER_NOT_FOUND", "User was not found.");
    }

    // Accounts are opened by onboarding, never implicitly here.
    const accounts = await this.database
      .select()
      .from(tradingAccounts)
      .where(eq(tradingAccounts.userId, userId));

    return {
      user: {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        emailVerified: profile.emailVerified,
        image: profile.image,
      },
      roles: [profile.role ?? "user"],
      capabilities: {
        canTrade: profile.trading_status === "active" && !profile.banned,
        canUseAdmin: profile.role === "admin",
      },
      accounts: accounts.map(publicAccount),
      currency: MVP_PRODUCT.currency,
      features: MVP_PRODUCT.features,
      executionPolicy: MVP_PRODUCT.execution,
    };
  }

  async ensurePracticeAccount(
    userId: string,
    options: { startingBalance?: number } = {},
  ) {
    const balance = (
      options.startingBalance ?? MVP_PRODUCT.initialPracticeBalance
    ).toFixed(8);
    const [profile] = await this.database
      .select({ id: user.id, emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!profile) {
      throw new HttpError(404, "USER_NOT_FOUND", "User was not found.");
    }
    if (!profile.emailVerified) {
      throw new HttpError(
        403,
        "EMAIL_NOT_VERIFIED",
        "Verify your email before creating a practice account.",
      );
    }

    return this.database.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(tradingAccounts)
        .where(
          and(
            eq(tradingAccounts.userId, userId),
            eq(tradingAccounts.type, "practice"),
          ),
        )
        .limit(1);
      if (existing) {
        return { account: publicAccount(existing), created: false };
      }

      const accountId = randomId();
      const [created] = await tx
        .insert(tradingAccounts)
        .values({
          id: accountId,
          userId,
          accountNumber: `MT-${accountId.replaceAll("-", "").slice(0, 12).toUpperCase()}`,
          type: "practice",
          status: "active",
          baseCurrency: MVP_PRODUCT.currency,
          startingBalance: balance,
          mockCashBalance: balance,
          mockBuyingPower: balance,
          openedAt: new Date(),
          metadata: { product: "mvp", provisionedBy: "onboarding" },
        })
        .onConflictDoNothing()
        .returning();

      const account =
        created ??
        (
          await tx
            .select()
            .from(tradingAccounts)
            .where(
              and(
                eq(tradingAccounts.userId, userId),
                eq(tradingAccounts.type, "practice"),
              ),
            )
            .limit(1)
        )[0];
      if (!account) {
        throw new HttpError(
          500,
          "ACCOUNT_PROVISIONING_FAILED",
          "Practice account provisioning failed.",
        );
      }

      if (created) {
        await tx.insert(mockCashLedgerEntries).values({
          id: randomId(),
          accountId: account.id,
          userId,
          type: "initial_credit",
          status: "posted",
          amount: balance,
          currency: MVP_PRODUCT.currency,
          balanceAfter: balance,
          referenceType: "account",
          referenceId: account.id,
          idempotencyKey: `${account.id}:initial-credit`,
          description: "Opening practice balance.",
          postedAt: new Date(),
        });
      }

      return { account: publicAccount(account), created: Boolean(created) };
    });
  }

  async getAccount(userId: string, accountId: string) {
    const account = await this.requireOwnedAccount(userId, accountId);
    const accountPositions = await this.readPositions(accountId);
    return {
      account: publicAccount(account),
      summary: buildAccountSummary(account, accountPositions),
    };
  }

  async listAccountActivity(
    userId: string,
    accountId: string,
    options: PageOptions = {},
  ) {
    await this.requireOwnedAccount(userId, accountId);
    const limit = pageLimit(options.limit);
    const cursor = decodeCursor(options.cursor, "activity");
    const filters = [eq(mockCashLedgerEntries.accountId, accountId)];
    if (cursor) {
      const cursorFilter = or(
        lt(mockCashLedgerEntries.occurredAt, cursor.at),
        and(
          eq(mockCashLedgerEntries.occurredAt, cursor.at),
          lt(mockCashLedgerEntries.id, cursor.id),
        ),
      );
      if (cursorFilter) filters.push(cursorFilter);
    }
    const entries = await this.database
      .select()
      .from(mockCashLedgerEntries)
      .where(and(...filters))
      .orderBy(
        desc(mockCashLedgerEntries.occurredAt),
        desc(mockCashLedgerEntries.id),
      )
      .limit(limit + 1);
    const page = entries.slice(0, limit);
    const lastEntry = page.at(-1);
    return {
      entries: page.map((entry) => ({
        id: entry.id,
        type: entry.type,
        status: entry.status,
        amount: entry.amount,
        currency: entry.currency,
        balanceAfter: entry.balanceAfter,
        description: entry.description,
        occurredAt: entry.occurredAt,
        postedAt: entry.postedAt,
      })),
      nextCursor:
        entries.length > limit && lastEntry
          ? encodeCursor("activity", lastEntry.occurredAt, lastEntry.id)
          : null,
    };
  }

  async getPortfolio(userId: string) {
    await this.ensurePracticeAccount(userId);
    const accounts = await this.database
      .select()
      .from(tradingAccounts)
      .where(eq(tradingAccounts.userId, userId))
      .orderBy(desc(tradingAccounts.createdAt));

    const items = await Promise.all(
      accounts.map(async (account) => {
        const [accountPositions, openOrders, recentTrades, latestSnapshot] =
          await Promise.all([
            this.readPositions(account.id),
            this.database
              .select()
              .from(orders)
              .where(
                and(
                  eq(orders.accountId, account.id),
                  inArray(orders.status, [
                    "queued",
                    "accepted",
                    "partially_filled",
                  ]),
                ),
              )
              .orderBy(desc(orders.createdAt)),
            this.database
              .select()
              .from(trades)
              .where(eq(trades.accountId, account.id))
              .orderBy(desc(trades.executedAt))
              .limit(25),
            this.database
              .select()
              .from(portfolioSnapshots)
              .where(eq(portfolioSnapshots.accountId, account.id))
              .orderBy(desc(portfolioSnapshots.snapshotAt))
              .limit(1),
          ]);

        return {
          account: publicAccount(account),
          summary: buildAccountSummary(account, accountPositions),
          positions: accountPositions,
          openOrders: openOrders.map(publicOrder),
          recentTrades: recentTrades.map(publicTrade),
          latestSnapshot: latestSnapshot[0]
            ? publicPortfolioSnapshot(latestSnapshot[0])
            : null,
          leaderboard: {
            eligible: account.leaderboardEligible,
            riskTier: account.riskTier,
            restrictionReason: account.restrictionReason,
          },
        };
      }),
    );

    return { accounts: items };
  }

  async listPositions(userId: string, accountId: string) {
    await this.requireOwnedAccount(userId, accountId);
    return { positions: await this.readPositions(accountId) };
  }

  async listOrders(
    userId: string,
    accountId: string,
    options: PageOptions = {},
  ) {
    await this.requireOwnedAccount(userId, accountId);
    const limit = pageLimit(options.limit);
    const cursor = decodeCursor(options.cursor, "orders");
    const filters = [eq(orders.accountId, accountId)];
    if (cursor) {
      const cursorFilter = or(
        lt(orders.createdAt, cursor.at),
        and(eq(orders.createdAt, cursor.at), lt(orders.id, cursor.id)),
      );
      if (cursorFilter) filters.push(cursorFilter);
    }
    const rows = await this.database
      .select()
      .from(orders)
      .where(and(...filters))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const lastOrder = page.at(-1);
    return {
      orders: page.map(publicOrder),
      nextCursor:
        rows.length > limit && lastOrder
          ? encodeCursor("orders", lastOrder.createdAt, lastOrder.id)
          : null,
    };
  }

  async listTrades(
    userId: string,
    accountId: string,
    options: PageOptions = {},
  ) {
    await this.requireOwnedAccount(userId, accountId);
    const limit = pageLimit(options.limit);
    const cursor = decodeCursor(options.cursor, "trades");
    const filters = [eq(trades.accountId, accountId)];
    if (cursor) {
      const cursorFilter = or(
        lt(trades.executedAt, cursor.at),
        and(eq(trades.executedAt, cursor.at), lt(trades.id, cursor.id)),
      );
      if (cursorFilter) filters.push(cursorFilter);
    }
    const rows = await this.database
      .select()
      .from(trades)
      .where(and(...filters))
      .orderBy(desc(trades.executedAt), desc(trades.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const lastTrade = page.at(-1);
    return {
      trades: page.map(publicTrade),
      nextCursor:
        rows.length > limit && lastTrade
          ? encodeCursor("trades", lastTrade.executedAt, lastTrade.id)
          : null,
    };
  }

  async placeOrder(
    userId: string,
    accountId: string,
    input: CreateOrderInput,
    context: RequestContext,
  ) {
    assertOrderInput(input);
    await this.requireOwnedAccount(userId, accountId);
    const idempotencyKey =
      input.idempotencyKey?.trim() || input.clientOrderId?.trim();
    if (!idempotencyKey) {
      throw new HttpError(
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        "Send an Idempotency-Key header for every order.",
      );
    }
    const requestFingerprint = orderRequestFingerprint(input);
    const [priorOrder] = await this.database
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.accountId, accountId),
          eq(orders.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (priorOrder) {
      return this.replayOrder(this.database, priorOrder, requestFingerprint);
    }

    const instrument = await this.ensureInstrument(input.instrumentId);
    assertInstrumentRules(instrument, input);
    let quoteEnvelope: QuoteEnvelope | null = null;
    try {
      quoteEnvelope = await this.readQuote(instrument.instrumentKey);
    } catch (error) {
      // A resting limit order needs a limit price, not a working quote feed.
      if (input.type === "market") throw error;
      log.debug("limit order accepted without quote", {
        instrumentId: input.instrumentId,
      });
    }
    const rawQuotePrice = quoteEnvelope?.quote?.lastPrice;
    const quotePrice =
      rawQuotePrice != null &&
      Number.isFinite(rawQuotePrice) &&
      rawQuotePrice > 0
        ? rawQuotePrice
        : null;
    if (input.type === "market" && quoteEnvelope?.stale) {
      throw new HttpError(
        409,
        "STALE_QUOTE",
        "The latest quote is stale; retry when live market data is available.",
      );
    }
    if (
      input.type === "market" &&
      (quoteEnvelope?.quote?.found !== true ||
        quoteEnvelope.quote.tradable !== true)
    ) {
      throw new HttpError(
        422,
        "INSTRUMENT_NOT_TRADABLE",
        "The instrument is not currently tradable.",
      );
    }
    if (
      input.type === "market" &&
      (quotePrice === null || !Number.isFinite(quotePrice) || quotePrice <= 0)
    ) {
      throw new HttpError(422, "QUOTE_UNAVAILABLE", "No usable latest quote.");
    }
    const limitPrice = input.limitPrice ?? 0;
    const referencePrice =
      input.type === "limit"
        ? input.side === "buy"
          ? limitPrice
          : Math.max(limitPrice, quotePrice ?? 0)
        : (quotePrice ?? 0);
    if (input.type === "market") {
      assertPriceBand(
        instrument,
        referencePrice,
        quoteEnvelope?.quote?.ohlc?.close ?? null,
      );
    }

    return this.database.transaction(async (tx) => {
      const account = await this.requireOwnedAccountForUpdate(
        userId,
        accountId,
        tx,
      );
      if (account.status !== "active") {
        throw new HttpError(
          409,
          "ACCOUNT_RESTRICTED",
          "Account is not active.",
        );
      }

      const [concurrentOrder] = await tx
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.accountId, accountId),
            eq(orders.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (concurrentOrder) {
        return this.replayOrder(tx, concurrentOrder, requestFingerprint);
      }

      const product = input.product ?? "delivery";
      const opening = openingQuantity(
        await this.readPosition(
          tx,
          accountId,
          instrument.instrumentKey,
          product,
        ),
        input.side,
        input.quantity,
      );
      assertProductRules(product, input.side, opening, this.now());

      const orderId = randomId();
      const clientOrderId = input.clientOrderId?.trim() || orderId;
      const notional = input.quantity * referencePrice;
      const now = this.now();

      const [createdOrder] = await tx
        .insert(orders)
        .values({
          id: orderId,
          accountId,
          userId,
          instrumentId: instrument.instrumentKey,
          sessionId: context.sessionId ?? null,
          clientOrderId,
          idempotencyKey,
          side: input.side,
          type: input.type,
          status: input.type === "limit" ? "accepted" : "queued",
          timeInForce: input.timeInForce ?? "day",
          product,
          quantity: money(input.quantity),
          limitPrice: input.type === "limit" ? money(limitPrice) : null,
          stopPrice: null,
          expiresAt:
            input.type !== "limit"
              ? null
              : product === "intraday"
                ? intradayOrderExpiry(now)
                : (input.timeInForce ?? "day") === "day"
                  ? dayOrderExpiry(now)
                  : null,
          notionalEstimate: money(notional),
          requestIpAddress: context.ipAddress ?? null,
          requestUserAgent: context.userAgent ?? null,
          requestDeviceFingerprint: context.deviceFingerprint ?? null,
          placedAt: now,
          metadata: {
            requestFingerprint,
            client: input.metadata ?? null,
          },
        })
        .returning();

      await this.writeOrderEvent(tx, {
        orderId,
        eventType: "accepted",
        fromStatus: "draft",
        toStatus: createdOrder.status,
        actorUserId: userId,
        message: `${input.type === "market" ? "Market" : "Limit"} order accepted.`,
        context,
      });

      const executableEnvelope = this.hasExecutableQuote(quoteEnvelope)
        ? quoteEnvelope
        : null;
      const canFill =
        executableEnvelope &&
        (input.type === "market" ||
          (isOrderSessionOpen(this.now()) &&
            limitPriceMatches(
              input.side,
              limitPrice,
              executableEnvelope.quote.lastPrice,
            )));
      if (canFill && executableEnvelope) {
        assertPriceBand(
          instrument,
          executableEnvelope.quote.lastPrice,
          executableEnvelope.quote.ohlc?.close ?? null,
        );
        const result = await this.executeOrder(tx, {
          account,
          order: createdOrder,
          input,
          instrument,
          quoteEnvelope: executableEnvelope,
          referencePrice: executableEnvelope.quote.lastPrice,
          context,
        });
        return publicExecutionResult(result, false);
      }
      if (input.type === "market") {
        throw new HttpError(
          409,
          "STALE_QUOTE",
          "A fresh live quote is required to execute this order.",
        );
      }
      if (input.timeInForce === "ioc") {
        const canceled = await this.finishOpenOrder(
          tx,
          createdOrder,
          "canceled",
          "IOC order could not fill immediately at the limit price.",
          context,
        );
        return this.publicUnfilledResult(tx, canceled);
      }
      await this.reserveForOpenOrder(tx, {
        account,
        order: createdOrder,
        input,
        instrument,
        referencePrice,
      });
      return this.publicUnfilledResult(tx, createdOrder);
    });
  }

  private hasExecutableQuote(
    envelope: QuoteEnvelope | null,
  ): envelope is QuoteEnvelope & {
    quote: NonNullable<QuoteEnvelope["quote"]> & { lastPrice: number };
  } {
    const quote = envelope?.quote;
    if (!quote || envelope?.stale || !quote.found || quote.tradable !== true)
      return false;
    const age = this.now().getTime() - Date.parse(quote.receivedAt);
    return (
      Number.isFinite(age) &&
      age >= -5_000 &&
      age <= this.quoteStaleMs &&
      quote.lastPrice !== null &&
      Number.isFinite(quote.lastPrice) &&
      quote.lastPrice > 0
    );
  }

  private async publicUnfilledResult(
    database: TradingDb | Tx,
    order: typeof orders.$inferSelect,
    replayed = false,
  ) {
    const [account] = await database
      .select()
      .from(tradingAccounts)
      .where(eq(tradingAccounts.id, order.accountId))
      .limit(1);
    return {
      order: publicOrder(order),
      account: publicAccount(account),
      trade: null,
      position: null,
      filled: false as const,
      replayed,
    };
  }

  private async releaseOrderReservations(
    tx: Tx,
    orderId: string,
    reason: string,
  ) {
    const reservations = await tx
      .select()
      .from(orderReservations)
      .where(
        and(
          eq(orderReservations.orderId, orderId),
          eq(orderReservations.status, "active"),
        ),
      );
    for (const reservation of reservations)
      await this.releaseReservation(tx, reservation, reason);
    return reservations.length;
  }

  private async finishOpenOrder(
    tx: Tx,
    order: typeof orders.$inferSelect,
    status: "canceled" | "expired" | "rejected",
    reason: string,
    context: RequestContext = {},
  ) {
    await this.releaseOrderReservations(tx, order.id, reason);
    const [updated] = await tx
      .update(orders)
      .set({
        status,
        canceledReason:
          status === "canceled" || status === "expired" ? reason : null,
        rejectedReason: status === "rejected" ? reason : null,
        updatedAt: this.now(),
      })
      .where(eq(orders.id, order.id))
      .returning();
    await this.writeOrderEvent(tx, {
      orderId: order.id,
      eventType: status,
      fromStatus: order.status,
      toStatus: status,
      message: reason,
      context,
    });
    return updated;
  }

  /** Runs in the API runtime, independently of browser subscriptions. */
  async processOpenOrders() {
    const candidates = await this.database
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.type, "limit"),
          inArray(orders.status, ["queued", "accepted"]),
        ),
      )
      .orderBy(orders.createdAt, orders.id);
    for (const candidate of candidates) {
      try {
        // Expiry must work even when the market-data provider is unavailable.
        let envelope: QuoteEnvelope | null = null;
        if (
          (!candidate.expiresAt || candidate.expiresAt > this.now()) &&
          isOrderSessionOpen(this.now())
        ) {
          try {
            envelope = await this.readQuote(candidate.instrumentId);
          } catch {
            /* Retry next pass. */
          }
        }
        await this.database.transaction(async (tx) => {
          const account = await this.requireOwnedAccountForUpdate(
            candidate.userId,
            candidate.accountId,
            tx,
          );
          const [order] = await tx
            .select()
            .from(orders)
            .where(eq(orders.id, candidate.id))
            .limit(1);
          // All place/cancel/match mutations use the same account lock.
          if (!order || !["queued", "accepted"].includes(order.status)) return;
          if (order.expiresAt && order.expiresAt <= this.now()) {
            await this.finishOpenOrder(
              tx,
              order,
              "expired",
              order.product === "intraday"
                ? "Intraday order expired at the square-off time."
                : "Day order expired at the end of its trading session.",
            );
            return;
          }
          const [profile] = await tx
            .select()
            .from(user)
            .where(eq(user.id, order.userId))
            .limit(1);
          if (
            account.status !== "active" ||
            !profile ||
            profile.banned ||
            profile.trading_status !== "active"
          ) {
            await this.finishOpenOrder(
              tx,
              order,
              "rejected",
              "Trading is no longer active for this account.",
            );
            return;
          }
          const fillEnvelope = envelope;
          if (
            !isOrderSessionOpen(this.now()) ||
            !this.hasExecutableQuote(fillEnvelope) ||
            !limitPriceMatches(
              order.side,
              num(order.limitPrice),
              fillEnvelope.quote.lastPrice,
            )
          )
            return;
          const instrument = this.catalog.resolve(order.instrumentId);
          if (!instrument) {
            await this.finishOpenOrder(
              tx,
              order,
              "rejected",
              "Instrument is no longer available.",
            );
            return;
          }
          const input: CreateOrderInput = {
            instrumentId: order.instrumentId,
            side: order.side,
            type: "limit",
            quantity: num(order.quantity),
            limitPrice: num(order.limitPrice),
            timeInForce: order.timeInForce,
            product: order.product,
          };
          try {
            // A risk failure rolls back the release and any fill writes before
            // rejecting the order and returning its reservations exactly once.
            await tx.transaction(async (fillTx) => {
              assertInstrumentRules(instrument, input);
              assertPriceBand(
                instrument,
                fillEnvelope.quote.lastPrice,
                fillEnvelope.quote.ohlc?.close ?? null,
              );
              await this.releaseOrderReservations(fillTx, order.id, "filled");
              const releasedAccount = await this.requireOwnedAccountForUpdate(
                order.userId,
                order.accountId,
                fillTx,
              );
              await this.executeOrder(fillTx, {
                account: releasedAccount,
                order,
                input,
                instrument,
                quoteEnvelope: fillEnvelope,
                referencePrice: fillEnvelope.quote.lastPrice,
                context: {},
              });
            });
          } catch (error) {
            if (!(error instanceof HttpError) || error.status >= 500)
              throw error;
            await this.finishOpenOrder(tx, order, "rejected", error.message);
          }
        });
      } catch (error) {
        log.error("open order processing failed", {
          orderId: candidate.id,
          error,
        });
      }
    }
  }

  /**
   * Closes every intraday position that is due (see isIntradaySquareOffDue) at
   * the latest known price, after canceling its resting intraday orders. Uses
   * the last price even if stale: an intraday position must not carry over.
   */
  async squareOffIntradayPositions() {
    const now = this.now();
    const open = await this.database
      .select({ position: positions, userId: tradingAccounts.userId })
      .from(positions)
      .innerJoin(tradingAccounts, eq(tradingAccounts.id, positions.accountId))
      .where(
        and(eq(positions.product, "intraday"), ne(positions.quantity, "0")),
      );
    for (const { position: candidate, userId } of open) {
      if (!isIntradaySquareOffDue(now, candidate.updatedAt)) continue;
      try {
        let envelope: QuoteEnvelope | null = null;
        try {
          envelope = await this.readQuote(candidate.instrumentId);
        } catch {
          /* Retry next pass. */
        }
        const price = envelope?.quote?.lastPrice;
        const instrument = this.catalog.resolve(candidate.instrumentId);
        if (
          !envelope?.quote ||
          price == null ||
          !Number.isFinite(price) ||
          price <= 0 ||
          !instrument
        ) {
          log.warn("intraday square-off waiting for a price", {
            positionId: candidate.id,
            instrumentId: candidate.instrumentId,
          });
          continue;
        }
        const quoteEnvelope = envelope;
        await this.database.transaction(async (tx) => {
          await this.requireOwnedAccountForUpdate(
            userId,
            candidate.accountId,
            tx,
          );
          const resting = await tx
            .select()
            .from(orders)
            .where(
              and(
                eq(orders.accountId, candidate.accountId),
                eq(orders.instrumentId, candidate.instrumentId),
                eq(orders.product, "intraday"),
                inArray(orders.status, ["queued", "accepted"]),
              ),
            );
          for (const order of resting) {
            await this.finishOpenOrder(
              tx,
              order,
              "canceled",
              "Canceled for the intraday auto square-off.",
            );
          }
          const account = await this.requireOwnedAccountForUpdate(
            userId,
            candidate.accountId,
            tx,
          );
          const position = await this.readPosition(
            tx,
            candidate.accountId,
            candidate.instrumentId,
            "intraday",
          );
          const quantity = num(position?.quantity);
          if (!position || quantity === 0) return;

          const side: OrderSide = quantity > 0 ? "sell" : "buy";
          const input: CreateOrderInput = {
            instrumentId: candidate.instrumentId,
            side,
            type: "market",
            quantity: Math.abs(quantity),
            timeInForce: "day",
            product: "intraday",
          };
          const orderId = randomId();
          const [order] = await tx
            .insert(orders)
            .values({
              id: orderId,
              accountId: account.id,
              userId,
              instrumentId: candidate.instrumentId,
              clientOrderId: orderId,
              idempotencyKey: `${AUTO_SQUARE_OFF_SOURCE}:${orderId}`,
              side,
              type: "market",
              status: "queued",
              timeInForce: "day",
              product: "intraday",
              quantity: money(input.quantity),
              notionalEstimate: money(input.quantity * price),
              source: AUTO_SQUARE_OFF_SOURCE,
              placedAt: now,
              metadata: { autoSquareOff: true, positionId: position.id },
            })
            .returning();
          await this.writeOrderEvent(tx, {
            orderId,
            eventType: "accepted",
            fromStatus: "draft",
            toStatus: "queued",
            message: `Intraday auto square-off at ${MVP_PRODUCT.intraday.squareOffAt} IST.`,
            context: {},
          });
          await this.executeOrder(tx, {
            account,
            order,
            input,
            instrument,
            quoteEnvelope,
            referencePrice: price,
            context: {},
          });
        });
        log.info("intraday position squared off", {
          positionId: candidate.id,
          instrumentId: candidate.instrumentId,
          price,
        });
      } catch (error) {
        log.error("intraday square-off failed", {
          positionId: candidate.id,
          error,
        });
      }
    }
  }

  private async replayOrder(
    database: TradingDb | Tx,
    order: typeof orders.$inferSelect,
    requestFingerprint: string,
  ) {
    const metadata = objectValue(order.metadata);
    if (metadata.requestFingerprint !== requestFingerprint) {
      throw new HttpError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "This idempotency key was already used for a different order.",
      );
    }

    if (order.status !== "filled") {
      return this.publicUnfilledResult(database, order, true);
    }

    const [[trade], [account], [position]] = await Promise.all([
      database
        .select()
        .from(trades)
        .where(eq(trades.orderId, order.id))
        .limit(1),
      database
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.id, order.accountId))
        .limit(1),
      database
        .select()
        .from(positions)
        .where(
          and(
            eq(positions.accountId, order.accountId),
            eq(positions.instrumentId, order.instrumentId),
            eq(positions.product, order.product),
          ),
        )
        .limit(1),
    ]);
    if (!trade || !account || !position || order.status !== "filled") {
      throw new HttpError(
        409,
        "ORDER_REPLAY_UNAVAILABLE",
        "The original order has not reached a replayable terminal state.",
      );
    }

    const tradeMetadata = objectValue(trade.metadata);
    return publicExecutionResult(
      {
        order,
        trade,
        account,
        position,
        filled: true,
        realizedPnl:
          typeof tradeMetadata.realizedPnl === "number"
            ? tradeMetadata.realizedPnl
            : undefined,
      },
      true,
    );
  }

  async cancelOrder(
    userId: string,
    orderId: string,
    input: CancelOrderInput,
    context: RequestContext,
  ) {
    return this.database.transaction(async (tx) => {
      const [candidateOrder] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
        .limit(1);
      if (!candidateOrder) {
        throw new HttpError(404, "ORDER_NOT_FOUND", "Order was not found.");
      }

      await this.requireOwnedAccountForUpdate(
        userId,
        candidateOrder.accountId,
        tx,
      );

      const [order] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
        .limit(1);
      if (!order) {
        throw new HttpError(404, "ORDER_NOT_FOUND", "Order was not found.");
      }
      if (!["queued", "accepted", "partially_filled"].includes(order.status)) {
        throw new HttpError(
          409,
          "ORDER_NOT_CANCELABLE",
          "Order cannot be canceled.",
        );
      }

      const activeReservations = await tx
        .select()
        .from(orderReservations)
        .where(
          and(
            eq(orderReservations.orderId, order.id),
            eq(orderReservations.status, "active"),
          ),
        );

      for (const reservation of activeReservations) {
        await this.releaseReservation(
          tx,
          reservation,
          input.reason ?? "canceled",
        );
      }

      const [updatedOrder] = await tx
        .update(orders)
        .set({
          status: "canceled",
          canceledReason: input.reason ?? "User canceled order.",
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id))
        .returning();

      await this.writeOrderEvent(tx, {
        orderId: order.id,
        eventType: "canceled",
        fromStatus: order.status,
        toStatus: "canceled",
        actorUserId: userId,
        message: input.reason ?? "User canceled order.",
        context,
      });

      return {
        order: publicOrder(updatedOrder),
        releasedReservations: activeReservations.length,
      };
    });
  }

  async listCompetitions() {
    const rows = await this.database
      .select()
      .from(competitions)
      .orderBy(desc(competitions.startsAt));
    return { competitions: rows };
  }

  async getLeaderboard(
    competitionId: string,
    options: LeaderboardOptions = {},
  ) {
    const filters = [eq(leaderboardEntries.competitionId, competitionId)];
    if (!options.includeIneligible) {
      filters.push(eq(leaderboardEntries.eligible, true));
    }

    const rows = await this.database
      .select({
        entry: leaderboardEntries,
        account: tradingAccounts,
        participant: competitionParticipants,
      })
      .from(leaderboardEntries)
      .innerJoin(
        tradingAccounts,
        eq(tradingAccounts.id, leaderboardEntries.accountId),
      )
      .leftJoin(
        competitionParticipants,
        and(
          eq(
            competitionParticipants.competitionId,
            leaderboardEntries.competitionId,
          ),
          eq(competitionParticipants.accountId, leaderboardEntries.accountId),
        ),
      )
      .where(and(...filters))
      .orderBy(leaderboardEntries.rank);

    return {
      competitionId,
      entries: rows.map((row) => ({
        ...row.entry,
        eligibility: {
          eligible: row.entry.eligible && row.account.leaderboardEligible,
          accountEligible: row.account.leaderboardEligible,
          participantStatus: row.participant?.status ?? null,
          riskScore: row.entry.riskScore,
          ineligibleReason:
            row.entry.ineligibleReason ?? row.account.restrictionReason,
        },
      })),
    };
  }

  async listRiskReviews() {
    const rows = await this.database
      .select()
      .from(accountRiskReviews)
      .orderBy(desc(accountRiskReviews.createdAt));
    return { riskReviews: rows };
  }

  async resolveRiskReview(
    reviewerUserId: string,
    reviewId: string,
    input: ResolveInput,
  ) {
    const [review] = await this.database
      .update(accountRiskReviews)
      .set({
        status: input.status === "rejected" ? "rejected" : "approved",
        reviewerUserId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(accountRiskReviews.id, reviewId))
      .returning();
    if (!review) {
      throw new HttpError(
        404,
        "RISK_REVIEW_NOT_FOUND",
        "Risk review was not found.",
      );
    }
    return { riskReview: review };
  }

  async listFraudAlerts() {
    const [alerts, signals] = await Promise.all([
      this.database
        .select()
        .from(fraudAlerts)
        .orderBy(desc(fraudAlerts.createdAt)),
      this.database
        .select()
        .from(fraudSignals)
        .orderBy(desc(fraudSignals.observedAt))
        .limit(100),
    ]);
    return { fraudAlerts: alerts, recentSignals: signals };
  }

  async resolveFraudAlert(
    resolverUserId: string,
    alertId: string,
    input: ResolveInput,
  ) {
    const [alert] = await this.database
      .update(fraudAlerts)
      .set({
        status:
          input.status === "false_positive" ? "false_positive" : "resolved",
        resolvedAt: new Date(),
        resolvedBy: resolverUserId,
        resolutionNotes: input.notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(fraudAlerts.id, alertId))
      .returning();
    if (!alert) {
      throw new HttpError(
        404,
        "FRAUD_ALERT_NOT_FOUND",
        "Fraud alert was not found.",
      );
    }
    return { fraudAlert: alert };
  }

  async setLeaderboardEligibility(accountId: string, input: EligibilityInput) {
    const [account] = await this.database
      .update(tradingAccounts)
      .set({
        leaderboardEligible: input.eligible,
        restrictionReason: input.eligible
          ? null
          : (input.reason ?? "Restricted by admin."),
        updatedAt: new Date(),
      })
      .where(eq(tradingAccounts.id, accountId))
      .returning();
    if (!account) {
      throw new HttpError(404, "ACCOUNT_NOT_FOUND", "Account was not found.");
    }
    return { account };
  }

  async disqualifyParticipant(participantId: string, input: DisqualifyInput) {
    const [participant] = await this.database
      .update(competitionParticipants)
      .set({
        status: "disqualified",
        disqualifiedReason: input.reason,
        updatedAt: new Date(),
      })
      .where(eq(competitionParticipants.id, participantId))
      .returning();
    if (!participant) {
      throw new HttpError(
        404,
        "PARTICIPANT_NOT_FOUND",
        "Participant was not found.",
      );
    }
    return { participant };
  }

  private async readPositions(accountId: string) {
    const rows = await this.database
      .select({
        position: positions,
        instrument: instruments,
      })
      .from(positions)
      .innerJoin(instruments, eq(instruments.id, positions.instrumentId))
      .where(eq(positions.accountId, accountId));

    let quoteByInstrument = new Map<string, QuoteEnvelope>();
    try {
      const quotes = await this.marketData.getQuotes(
        rows.map((row) => row.position.instrumentId),
        "QUOTE",
      );
      quoteByInstrument = new Map(
        quotes.map((quote) => [quote.instrument.instrumentKey, quote]),
      );
    } catch {
      // Portfolio reads remain available during an upstream outage and clearly
      // mark their cost-basis fallback as stale below.
    }

    return rows.map((row) => ({
      ...publicPosition(row.position),
      instrument: publicInstrument(row.instrument),
      ...positionValuation(
        row.position,
        quoteByInstrument.get(row.position.instrumentId),
      ),
    }));
  }

  private async requireOwnedAccount(
    userId: string,
    accountId: string,
    tx: TradingDb | Tx = this.database,
  ) {
    const [account] = await tx
      .select()
      .from(tradingAccounts)
      .where(
        and(
          eq(tradingAccounts.id, accountId),
          eq(tradingAccounts.userId, userId),
        ),
      )
      .limit(1);
    if (!account) {
      throw new HttpError(404, "ACCOUNT_NOT_FOUND", "Account was not found.");
    }
    return account;
  }

  private async requireOwnedAccountForUpdate(
    userId: string,
    accountId: string,
    tx: Tx,
  ) {
    const [account] = await tx
      .select()
      .from(tradingAccounts)
      .where(
        and(
          eq(tradingAccounts.id, accountId),
          eq(tradingAccounts.userId, userId),
        ),
      )
      .for("update")
      .limit(1);
    if (!account) {
      throw new HttpError(404, "ACCOUNT_NOT_FOUND", "Account was not found.");
    }
    return account;
  }

  private async ensureInstrument(input: string) {
    const instrument = this.catalog.resolve(input);
    if (!instrument) {
      throw new HttpError(
        404,
        "INSTRUMENT_NOT_FOUND",
        "Instrument was not found.",
      );
    }

    await this.database
      .insert(instruments)
      .values({
        id: instrument.instrumentKey,
        symbol: instrument.symbol,
        exchange: instrument.exchange,
        name: instrument.name,
        type: mapInstrumentType(instrument),
        securityId: instrument.securityId,
        lotSize: instrument.lotSize ?? 1,
        tickSize:
          instrument.tickSize === null ? null : money(instrument.tickSize),
        priceBand: {
          upperLimit: instrument.upperLimit,
          lowerLimit: instrument.lowerLimit,
        },
        metadata: {
          segment: instrument.segment,
          series: instrument.series,
          providerInstrumentType: instrument.instrumentType,
          scripType: instrument.scripType,
        },
      })
      .onConflictDoUpdate({
        target: instruments.id,
        set: {
          symbol: instrument.symbol,
          exchange: instrument.exchange,
          name: instrument.name,
          status: "active",
          updatedAt: new Date(),
        },
      });

    return instrument;
  }

  private async readQuote(instrumentId: string): Promise<QuoteEnvelope> {
    const [envelope] = await this.marketData.getQuotes([instrumentId], "QUOTE");
    if (!envelope) {
      throw new HttpError(
        404,
        "INSTRUMENT_NOT_FOUND",
        "Instrument was not found.",
      );
    }
    return envelope;
  }

  private async executeOrder(
    tx: Tx,
    args: {
      account: typeof tradingAccounts.$inferSelect;
      order: typeof orders.$inferSelect;
      input: CreateOrderInput;
      instrument: InstrumentRecord;
      quoteEnvelope: QuoteEnvelope;
      referencePrice: number;
      context: RequestContext;
    },
  ): Promise<ExecutionResult> {
    const gross = args.input.quantity * args.referencePrice;
    const fees = 0;
    const net = args.input.side === "buy" ? gross + fees : gross - fees;
    const observedAt = parseDate(
      args.quoteEnvelope.quote?.lastTradeTime ??
        args.quoteEnvelope.quote?.lastUpdateTime ??
        args.quoteEnvelope.quote?.receivedAt,
    );
    const quoteId = await this.writeMarketQuote(
      tx,
      args.instrument.instrumentKey,
      args.quoteEnvelope,
      observedAt,
    );

    if (args.input.side === "buy") {
      return this.executeBuy(tx, args, gross, fees, net, quoteId, observedAt);
    }

    return this.executeSell(tx, args, gross, fees, net, quoteId, observedAt);
  }

  private async executeBuy(
    tx: Tx,
    args: {
      account: typeof tradingAccounts.$inferSelect;
      order: typeof orders.$inferSelect;
      input: CreateOrderInput;
      instrument: InstrumentRecord;
      referencePrice: number;
      context: RequestContext;
    },
    gross: number,
    fees: number,
    net: number,
    quoteId: string | null,
    observedAt: Date | null,
  ) {
    const product = args.order.product;
    const current = await this.readPosition(
      tx,
      args.account.id,
      args.instrument.instrumentKey,
      product,
    );
    const shortQty = Math.max(0, -num(current?.quantity));
    const coverQty = Math.min(args.input.quantity, shortQty);
    const longQty = args.input.quantity - coverQty;

    const newCash = num(args.account.mockCashBalance) - net;
    const tradeId = randomId();
    const now = new Date();

    const [trade] = await tx
      .insert(trades)
      .values({
        id: tradeId,
        orderId: args.order.id,
        accountId: args.account.id,
        userId: args.account.userId,
        instrumentId: args.instrument.instrumentKey,
        side: "buy",
        quantity: money(args.input.quantity),
        price: money(args.referencePrice),
        grossAmount: money(gross),
        fees: money(fees),
        netAmount: money(net),
        marketQuoteId: quoteId,
        quoteObservedAt: observedAt,
        executionReason: executionReason(args.order),
        executionVenue: "mock_internal",
        executedAt: now,
        metadata: { mock: true },
      })
      .returning();

    const realizedPnl =
      coverQty > 0 && current
        ? await this.consumeLots(
            tx,
            current.id,
            coverQty,
            args.referencePrice,
            tradeId,
            now,
            num(current?.averageCost),
            "short",
          )
        : 0;
    const position = await this.upsertBoughtPosition(
      tx,
      args.account.id,
      args.instrument.instrumentKey,
      product,
      args.input.quantity,
      args.referencePrice,
      realizedPnl,
    );

    if (longQty > 0) {
      await tx.insert(positionLots).values({
        id: randomId(),
        accountId: args.account.id,
        userId: args.account.userId,
        instrumentId: args.instrument.instrumentKey,
        positionId: position.id,
        openingTradeId: tradeId,
        status: "open",
        openedQuantity: money(longQty),
        remainingQuantity: money(longQty),
        costBasisPrice: money(args.referencePrice),
        costBasisAmount: money(longQty * args.referencePrice),
        openedAt: now,
        metadata: {
          source: `${args.order.type}_order`,
          direction: "long",
          product,
        },
      });
    }
    let finalTrade = trade;
    if (coverQty > 0) {
      [finalTrade] = await tx
        .update(trades)
        .set({ metadata: { mock: true, realizedPnl } })
        .where(eq(trades.id, tradeId))
        .returning();
    }

    await this.writeLedger(tx, {
      account: args.account,
      type: "trade_buy",
      amount: -net,
      balanceAfter: newCash,
      referenceType: "trade",
      referenceId: tradeId,
      idempotencyKey: `${args.order.id}:cash:buy`,
      description:
        coverQty > 0
          ? `Mock ${args.order.type} buy fill (short cover).`
          : `Mock ${args.order.type} buy fill.`,
    });

    const buyingPower =
      newCash -
      num(args.account.reservedMockCash) -
      (await this.positionsHold(tx, args.account.id));
    // Closing trades always go through; new exposure must fit buying power.
    if (longQty > 0 && buyingPower < 0) {
      throw new HttpError(
        409,
        "INSUFFICIENT_MOCK_CASH",
        product === "intraday"
          ? "Not enough buying power for the intraday margin."
          : "Mock buying power is insufficient.",
      );
    }
    const [account] = await tx
      .update(tradingAccounts)
      .set({
        mockCashBalance: money(newCash),
        mockBuyingPower: money(buyingPower),
        updatedAt: now,
      })
      .where(eq(tradingAccounts.id, args.account.id))
      .returning();

    const [order] = await tx
      .update(orders)
      .set({
        status: "filled",
        filledQuantity: money(args.input.quantity),
        averageFillPrice: money(args.referencePrice),
        updatedAt: now,
      })
      .where(eq(orders.id, args.order.id))
      .returning();

    await this.writeOrderEvent(tx, {
      orderId: args.order.id,
      eventType: "filled",
      fromStatus: args.order.status,
      toStatus: "filled",
      actorUserId: args.account.userId,
      message: `${args.order.type === "limit" ? "Limit" : "Market"} buy filled from latest quote.`,
      context: args.context,
    });

    return {
      order,
      trade: finalTrade ?? trade,
      account,
      position,
      realizedPnl,
      filled: true as const,
    };
  }

  private async executeSell(
    tx: Tx,
    args: {
      account: typeof tradingAccounts.$inferSelect;
      order: typeof orders.$inferSelect;
      input: CreateOrderInput;
      instrument: InstrumentRecord;
      referencePrice: number;
      context: RequestContext;
    },
    gross: number,
    fees: number,
    net: number,
    quoteId: string | null,
    observedAt: Date | null,
  ) {
    const product = args.order.product;
    const position = await this.readPosition(
      tx,
      args.account.id,
      args.instrument.instrumentKey,
      product,
    );
    const currentQty = num(position?.quantity);
    const longQty = Math.max(0, currentQty);
    const closeQty = Math.min(args.input.quantity, longQty);
    const shortQty = args.input.quantity - closeQty;
    // Shares held back by open sell orders can't be sold again, and a short
    // can't be opened on top of them either.
    if (closeQty > 0 && num(position?.availableQuantity) < closeQty) {
      throw new HttpError(
        409,
        "INSUFFICIENT_POSITION",
        "Shares are reserved by open sell orders. Cancel them first.",
      );
    }
    if (shortQty > 0 && product !== "intraday") {
      throw new HttpError(
        409,
        "SHORT_SELL_INTRADAY_ONLY",
        "Short selling is only allowed as an intraday order.",
      );
    }

    const now = new Date();
    const tradeId = randomId();
    await tx
      .insert(trades)
      .values({
        id: tradeId,
        orderId: args.order.id,
        accountId: args.account.id,
        userId: args.account.userId,
        instrumentId: args.instrument.instrumentKey,
        side: "sell",
        quantity: money(args.input.quantity),
        price: money(args.referencePrice),
        grossAmount: money(gross),
        fees: money(fees),
        netAmount: money(net),
        marketQuoteId: quoteId,
        quoteObservedAt: observedAt,
        executionReason: executionReason(args.order),
        executionVenue: "mock_internal",
        executedAt: now,
        metadata: { mock: true },
      })
      .returning();

    const realizedPnl =
      closeQty > 0 && position
        ? await this.consumeLots(
            tx,
            position.id,
            closeQty,
            args.referencePrice,
            tradeId,
            now,
            num(position?.averageCost),
            "long",
          )
        : 0;
    const [trade] = await tx
      .update(trades)
      .set({ metadata: { mock: true, realizedPnl } })
      .where(eq(trades.id, tradeId))
      .returning();
    if (!trade) {
      throw new HttpError(
        500,
        "TRADE_EXECUTION_FAILED",
        "Trade could not be finalized.",
      );
    }

    const newQuantity = currentQty - args.input.quantity;
    // A short's average cost is its average entry price.
    const priorShort = Math.max(0, -currentQty);
    const newAverage =
      newQuantity > 0
        ? num(position?.averageCost)
        : newQuantity === 0
          ? 0
          : (priorShort * num(position?.averageCost) +
              shortQty * args.referencePrice) /
            (priorShort + shortQty);
    const values = {
      quantity: money(newQuantity),
      availableQuantity: money(
        num(position?.availableQuantity) - args.input.quantity,
      ),
      averageCost: money(newAverage),
      realizedPnl: money(num(position?.realizedPnl) + realizedPnl),
      unrealizedPnl: "0",
      updatedAt: now,
    };
    const [updatedPosition] = position
      ? await tx
          .update(positions)
          .set(values)
          .where(eq(positions.id, position.id))
          .returning()
      : await tx
          .insert(positions)
          .values({
            id: randomId(),
            accountId: args.account.id,
            instrumentId: args.instrument.instrumentKey,
            product,
            openedAt: now,
            ...values,
          })
          .returning();

    if (shortQty > 0) {
      await tx.insert(positionLots).values({
        id: randomId(),
        accountId: args.account.id,
        userId: args.account.userId,
        instrumentId: args.instrument.instrumentKey,
        positionId: updatedPosition.id,
        openingTradeId: tradeId,
        status: "open",
        openedQuantity: money(shortQty),
        remainingQuantity: money(shortQty),
        costBasisPrice: money(args.referencePrice),
        costBasisAmount: money(shortQty * args.referencePrice),
        openedAt: now,
        metadata: {
          source: `${args.order.type}_order`,
          direction: "short",
          product,
        },
      });
    }

    const newCash = num(args.account.mockCashBalance) + net;
    await this.writeLedger(tx, {
      account: args.account,
      type: "trade_sell",
      amount: net,
      balanceAfter: newCash,
      referenceType: "trade",
      referenceId: tradeId,
      idempotencyKey: `${args.order.id}:cash:sell`,
      description:
        shortQty > 0
          ? `Mock ${args.order.type} sell fill (short sale).`
          : `Mock ${args.order.type} sell fill.`,
    });

    const buyingPower =
      newCash -
      num(args.account.reservedMockCash) -
      (await this.positionsHold(tx, args.account.id));
    // Closing trades always go through; new exposure must fit buying power.
    if (shortQty > 0 && buyingPower < 0) {
      throw new HttpError(
        409,
        "INSUFFICIENT_MOCK_CASH",
        product === "intraday"
          ? "Not enough buying power for the intraday margin."
          : "Not enough buying power to cover the margin for this short sale.",
      );
    }
    const [account] = await tx
      .update(tradingAccounts)
      .set({
        mockCashBalance: money(newCash),
        mockBuyingPower: money(buyingPower),
        updatedAt: now,
      })
      .where(eq(tradingAccounts.id, args.account.id))
      .returning();

    const [order] = await tx
      .update(orders)
      .set({
        status: "filled",
        filledQuantity: money(args.input.quantity),
        averageFillPrice: money(args.referencePrice),
        updatedAt: now,
      })
      .where(eq(orders.id, args.order.id))
      .returning();

    await this.writeOrderEvent(tx, {
      orderId: args.order.id,
      eventType: "filled",
      fromStatus: args.order.status,
      toStatus: "filled",
      actorUserId: args.account.userId,
      message: `${args.order.type === "limit" ? "Limit" : "Market"} sell filled from latest quote.`,
      context: args.context,
    });

    return {
      order,
      trade,
      account,
      position: updatedPosition,
      realizedPnl,
      filled: true as const,
    };
  }

  private async reserveForOpenOrder(
    tx: Tx,
    args: {
      account: typeof tradingAccounts.$inferSelect;
      order: typeof orders.$inferSelect;
      input: CreateOrderInput;
      instrument: InstrumentRecord;
      referencePrice: number;
    },
  ) {
    const product = args.order.product;
    const position = await this.readPosition(
      tx,
      args.account.id,
      args.instrument.instrumentKey,
      product,
    );
    const closing =
      args.input.side === "sell"
        ? Math.min(args.input.quantity, Math.max(0, num(position?.quantity)))
        : 0;
    if (closing > Math.max(0, num(position?.availableQuantity))) {
      throw new HttpError(
        409,
        "INSUFFICIENT_POSITION",
        "Shares are reserved by open sell orders. Cancel them first.",
      );
    }
    // Resting buys reserve their full limit value. Resting shorts reserve
    // margin without spending sale proceeds that have not been earned yet.
    // Intraday orders only reserve the intraday margin on that value.
    const cashQuantity =
      args.input.side === "buy"
        ? args.input.quantity
        : args.input.quantity - closing;
    const reservedCash =
      cashQuantity *
      args.referencePrice *
      (product === "intraday" ? INTRADAY_MARGIN_RATE : 1);
    if (
      !Number.isFinite(reservedCash) ||
      num(args.account.mockBuyingPower) < reservedCash
    ) {
      throw new HttpError(
        409,
        "INSUFFICIENT_MOCK_CASH",
        "Not enough buying power to reserve this order.",
      );
    }
    await tx.insert(orderReservations).values({
      id: randomId(),
      orderId: args.order.id,
      accountId: args.account.id,
      userId: args.account.userId,
      instrumentId: args.instrument.instrumentKey,
      reservationType:
        closing > 0 && reservedCash > 0
          ? "quantity_and_mock_cash"
          : closing > 0
            ? "quantity"
            : "mock_cash",
      reservedMockCash: money(reservedCash),
      reservedQuantity: money(closing),
      idempotencyKey: `${args.order.id}:reservation`,
    });
    if (reservedCash > 0) {
      await tx
        .update(tradingAccounts)
        .set({
          reservedMockCash: money(
            num(args.account.reservedMockCash) + reservedCash,
          ),
          mockBuyingPower: money(
            num(args.account.mockBuyingPower) - reservedCash,
          ),
          updatedAt: this.now(),
        })
        .where(eq(tradingAccounts.id, args.account.id));
    }
    if (closing > 0 && position) {
      await tx
        .update(positions)
        .set({
          availableQuantity: money(num(position.availableQuantity) - closing),
          updatedAt: this.now(),
        })
        .where(eq(positions.id, position.id));
    }
  }

  private async releaseReservation(
    tx: Tx,
    reservation: typeof orderReservations.$inferSelect,
    reason: string,
  ) {
    const now = new Date();
    await tx
      .update(orderReservations)
      .set({
        status: "released",
        releasedMockCash: reservation.reservedMockCash,
        releasedQuantity: reservation.reservedQuantity,
        releaseReason: reason,
        releasedAt: now,
      })
      .where(eq(orderReservations.id, reservation.id));

    if (num(reservation.reservedMockCash) > 0) {
      const [account] = await tx
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.id, reservation.accountId))
        .limit(1);
      if (account) {
        await tx
          .update(tradingAccounts)
          .set({
            reservedMockCash: money(
              Math.max(
                0,
                num(account.reservedMockCash) -
                  num(reservation.reservedMockCash),
              ),
            ),
            mockBuyingPower: money(
              num(account.mockBuyingPower) + num(reservation.reservedMockCash),
            ),
            updatedAt: now,
          })
          .where(eq(tradingAccounts.id, account.id));
      }
    }

    if (num(reservation.reservedQuantity) > 0) {
      const [order] = await tx
        .select({ product: orders.product })
        .from(orders)
        .where(eq(orders.id, reservation.orderId))
        .limit(1);
      const position = await this.readPosition(
        tx,
        reservation.accountId,
        reservation.instrumentId,
        order?.product ?? "delivery",
      );
      if (position) {
        await tx
          .update(positions)
          .set({
            availableQuantity: money(
              num(position.availableQuantity) +
                num(reservation.reservedQuantity),
            ),
            updatedAt: now,
          })
          .where(eq(positions.id, position.id));
      }
    }
  }

  private async upsertBoughtPosition(
    tx: Tx,
    accountId: string,
    instrumentId: string,
    product: OrderProduct,
    quantity: number,
    price: number,
    realizedPnl = 0,
  ) {
    const current = await this.readPosition(
      tx,
      accountId,
      instrumentId,
      product,
    );
    const now = new Date();

    if (!current) {
      const [created] = await tx
        .insert(positions)
        .values({
          id: randomId(),
          accountId,
          instrumentId,
          product,
          quantity: money(quantity),
          availableQuantity: money(quantity),
          averageCost: money(price),
          openedAt: now,
        })
        .returning();
      return created;
    }

    const currentQty = num(current.quantity);
    const newQty = currentQty + quantity;
    // Covering keeps a remaining short at its entry price; flipping to long
    // starts a fresh cost basis at this fill.
    const newAverage =
      newQty === 0
        ? 0
        : newQty < 0
          ? num(current.averageCost)
          : currentQty <= 0
            ? price
            : (currentQty * num(current.averageCost) + quantity * price) /
              newQty;
    const [updated] = await tx
      .update(positions)
      .set({
        quantity: money(newQty),
        availableQuantity: money(num(current.availableQuantity) + quantity),
        averageCost: money(newAverage),
        realizedPnl: money(num(current.realizedPnl) + realizedPnl),
        updatedAt: now,
      })
      .where(eq(positions.id, current.id))
      .returning();
    return updated;
  }

  private async readPosition(
    tx: Tx | TradingDb,
    accountId: string,
    instrumentId: string,
    product: OrderProduct,
  ) {
    const [position] = await tx
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.accountId, accountId),
          eq(positions.instrumentId, instrumentId),
          eq(positions.product, product),
        ),
      )
      .limit(1);
    return position;
  }

  /**
   * Buying power = cash - reserved cash - this hold. Cash always moves by the
   * full trade value, so the hold turns that into the margin each position
   * actually needs (see positionHold).
   */
  private async positionsHold(tx: Tx, accountId: string) {
    const open = await tx
      .select({
        product: positions.product,
        quantity: positions.quantity,
        averageCost: positions.averageCost,
      })
      .from(positions)
      .where(
        and(eq(positions.accountId, accountId), ne(positions.quantity, "0")),
      );
    return open.reduce(
      (total, row) =>
        total +
        positionHold(row.product, num(row.quantity), num(row.averageCost)),
      0,
    );
  }

  private async consumeLots(
    tx: Tx,
    positionId: string,
    quantity: number,
    sellPrice: number,
    closingTradeId: string,
    closedAt: Date,
    fallbackCost: number,
    direction: "long" | "short",
  ) {
    const pnlPerShare = (cost: number) =>
      direction === "long" ? sellPrice - cost : cost - sellPrice;
    const lots = await tx
      .select()
      .from(positionLots)
      .where(
        and(
          eq(positionLots.positionId, positionId),
          eq(positionLots.status, "open"),
        ),
      )
      .orderBy(positionLots.openedAt);
    let remaining = quantity;
    let realizedPnl = 0;

    for (const lot of lots) {
      if (remaining <= 0) {
        break;
      }
      const consumed = Math.min(remaining, num(lot.remainingQuantity));
      const lotPnl = consumed * pnlPerShare(num(lot.costBasisPrice));
      const nextRemaining = num(lot.remainingQuantity) - consumed;
      realizedPnl += lotPnl;
      remaining -= consumed;

      await tx
        .update(positionLots)
        .set({
          remainingQuantity: money(nextRemaining),
          realizedPnl: money(num(lot.realizedPnl) + lotPnl),
          closingTradeId,
          status: nextRemaining <= 0 ? "closed" : "open",
          closedAt: nextRemaining <= 0 ? closedAt : null,
        })
        .where(eq(positionLots.id, lot.id));
    }

    if (remaining > 0) {
      realizedPnl += remaining * pnlPerShare(fallbackCost);
    }

    return realizedPnl;
  }

  private async writeMarketQuote(
    tx: Tx,
    instrumentId: string,
    envelope: QuoteEnvelope,
    observedAt: Date | null,
  ) {
    if (!envelope.quote) {
      return null;
    }
    const id = randomId();
    await tx.insert(marketQuotes).values({
      id,
      instrumentId,
      source: "paytm",
      lastPrice:
        envelope.quote.lastPrice === null
          ? null
          : money(envelope.quote.lastPrice),
      dayVolume: envelope.quote.volumeTraded,
      rawPayload: envelope.quote.raw,
      observedAt: observedAt ?? new Date(),
    });
    return id;
  }

  private async writeLedger(
    tx: Tx,
    input: {
      account: typeof tradingAccounts.$inferSelect;
      type: "trade_buy" | "trade_sell";
      amount: number;
      balanceAfter: number;
      referenceType: string;
      referenceId: string;
      idempotencyKey: string;
      description: string;
    },
  ) {
    await tx.insert(mockCashLedgerEntries).values({
      id: randomId(),
      accountId: input.account.id,
      userId: input.account.userId,
      type: input.type,
      status: "posted",
      amount: money(input.amount),
      currency: input.account.baseCurrency,
      balanceAfter: money(input.balanceAfter),
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey,
      description: input.description,
      postedAt: new Date(),
    });
  }

  private async writeOrderEvent(
    tx: Tx,
    input: {
      orderId: string;
      eventType: string;
      fromStatus?: typeof orders.$inferSelect.status;
      toStatus?: typeof orders.$inferSelect.status;
      actorUserId?: string;
      message?: string;
      context: RequestContext;
    },
  ) {
    await tx.insert(orderEvents).values({
      id: randomId(),
      orderId: input.orderId,
      eventType: input.eventType,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      actorUserId: input.actorUserId ?? null,
      message: input.message ?? null,
      requestId: input.context.requestId ?? null,
      ipAddress: input.context.ipAddress ?? null,
    });
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    message: string,
  ) {
    super(message);
  }
}

function assertOrderInput(input: CreateOrderInput) {
  if (!input.instrumentId?.trim()) {
    throw new HttpError(400, "INVALID_ORDER", "instrumentId is required.");
  }
  if (!["buy", "sell"].includes(input.side)) {
    throw new HttpError(400, "INVALID_ORDER", "side must be buy or sell.");
  }
  if (!(MVP_PRODUCT.orderTypes as readonly string[]).includes(input.type)) {
    throw new HttpError(
      400,
      "UNSUPPORTED_ORDER_TYPE",
      "Choose a market or limit order.",
    );
  }
  if (
    input.timeInForce &&
    !(MVP_PRODUCT.timeInForce as readonly string[]).includes(input.timeInForce)
  ) {
    throw new HttpError(
      400,
      "UNSUPPORTED_TIME_IN_FORCE",
      "Choose Day, GTC, or IOC validity.",
    );
  }
  if (
    input.product &&
    !(MVP_PRODUCT.products as readonly string[]).includes(input.product)
  ) {
    throw new HttpError(
      400,
      "UNSUPPORTED_PRODUCT",
      "Choose a delivery or intraday order.",
    );
  }
  if (input.product === "intraday" && input.timeInForce === "gtc") {
    throw new HttpError(
      400,
      "UNSUPPORTED_TIME_IN_FORCE",
      "Intraday orders are valid for the day only; choose Day or IOC.",
    );
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new HttpError(
      400,
      "INVALID_ORDER",
      "quantity must be greater than zero.",
    );
  }
  if (
    input.stopPrice != null ||
    (input.type === "market" && input.limitPrice != null)
  ) {
    throw new HttpError(
      400,
      "UNSUPPORTED_ORDER_FIELDS",
      "Stop prices are unsupported; limitPrice is only accepted for limit orders.",
    );
  }
  if (
    input.type === "limit" &&
    (input.limitPrice == null ||
      !Number.isFinite(input.limitPrice) ||
      input.limitPrice <= 0)
  ) {
    throw new HttpError(
      400,
      "INVALID_LIMIT_PRICE",
      "Enter a positive limit price.",
    );
  }
  if (!Number.isFinite(input.quantity * (input.limitPrice ?? 1))) {
    throw new HttpError(400, "INVALID_ORDER", "Order value is too large.");
  }
}

function assertProductRules(
  product: OrderProduct,
  side: OrderSide,
  opening: number,
  now: Date,
) {
  if (product === "delivery" && side === "sell" && opening > 0) {
    throw new HttpError(
      409,
      "SHORT_SELL_INTRADAY_ONLY",
      "Short selling is only allowed as an intraday order.",
    );
  }
  if (product !== "intraday") return;
  if (isIntradaySquareOffDue(now, now)) {
    throw new HttpError(
      409,
      "INTRADAY_CLOSED",
      `Intraday trading runs until ${MVP_PRODUCT.intraday.squareOffAt} IST on weekdays.`,
    );
  }
  if (opening > 0 && !isIntradayEntryOpen(now)) {
    throw new HttpError(
      409,
      "INTRADAY_ENTRY_CLOSED",
      `New intraday positions close at ${MVP_PRODUCT.intraday.entryCutoff} IST; you can still exit open ones.`,
    );
  }
}

function executionReason(order: typeof orders.$inferSelect) {
  if (order.source === AUTO_SQUARE_OFF_SOURCE)
    return "intraday_auto_square_off";
  return order.type === "limit"
    ? "limit_order_price_matched"
    : "market_order_immediate_fill";
}

function assertInstrumentRules(
  instrument: InstrumentRecord,
  input: CreateOrderInput,
) {
  if (
    input.limitPrice != null &&
    instrument.tickSize &&
    instrument.tickSize > 0
  ) {
    const ticks = input.limitPrice / instrument.tickSize;
    if (Math.abs(ticks - Math.round(ticks)) > 1e-6) {
      throw new HttpError(
        400,
        "INVALID_TICK_SIZE",
        `Price must be a multiple of ${instrument.tickSize}.`,
      );
    }
  }
  const lotSize = instrument.lotSize ?? 1;
  const lots = input.quantity / lotSize;
  if (Math.abs(lots - Math.round(lots)) > 1e-8) {
    throw new HttpError(
      400,
      "INVALID_LOT_SIZE",
      `quantity must be a multiple of ${lotSize}.`,
    );
  }
  if (
    instrument.freezeQuantity != null &&
    input.quantity > instrument.freezeQuantity
  ) {
    throw new HttpError(
      400,
      "FREEZE_QUANTITY_EXCEEDED",
      `quantity cannot exceed ${instrument.freezeQuantity}.`,
    );
  }
}

function assertPriceBand(
  instrument: InstrumentRecord,
  price: number,
  previousClose: number | null,
) {
  // Circuit limits come from the catalog snapshot and are set around the
  // previous close. If that close is outside them, the snapshot is from an
  // older session and its band would wrongly block today's prices.
  const { lowerLimit, upperLimit } = instrument;
  if (
    previousClose != null &&
    ((lowerLimit != null && previousClose < lowerLimit) ||
      (upperLimit != null && previousClose > upperLimit))
  ) {
    return;
  }
  if (instrument.lowerLimit != null && price < instrument.lowerLimit) {
    throw new HttpError(
      409,
      "PRICE_OUTSIDE_BAND",
      "The latest price is below the instrument price band.",
    );
  }
  if (instrument.upperLimit != null && price > instrument.upperLimit) {
    throw new HttpError(
      409,
      "PRICE_OUTSIDE_BAND",
      "The latest price is above the instrument price band.",
    );
  }
}

function orderRequestFingerprint(input: CreateOrderInput) {
  return JSON.stringify({
    instrumentId: input.instrumentId.trim(),
    side: input.side,
    type: input.type,
    quantity: money(input.quantity),
    timeInForce: input.timeInForce ?? "day",
    product: input.product ?? "delivery",
    limitPrice: input.limitPrice ?? null,
    stopPrice: input.stopPrice ?? null,
    clientOrderId: input.clientOrderId?.trim() || null,
  });
}

function objectValue(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function pageLimit(input: number | undefined) {
  return Number.isInteger(input) && input && input >= 1 && input <= 100
    ? input
    : 50;
}

function encodeCursor(kind: string, at: Date, id: string) {
  return Buffer.from(
    JSON.stringify({ kind, at: at.toISOString(), id }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(input: string | null | undefined, expectedKind: string) {
  if (!input) {
    return null;
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(input, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (
      decoded.kind !== expectedKind ||
      typeof decoded.at !== "string" ||
      typeof decoded.id !== "string"
    ) {
      throw new Error("cursor shape");
    }
    const at = new Date(decoded.at);
    if (Number.isNaN(at.getTime())) {
      throw new Error("cursor date");
    }
    return { at, id: decoded.id };
  } catch {
    throw new HttpError(
      400,
      "INVALID_CURSOR",
      "The pagination cursor is invalid.",
    );
  }
}

function publicAccount(account: typeof tradingAccounts.$inferSelect) {
  return {
    id: account.id,
    accountNumber: account.accountNumber,
    type: account.type,
    status: account.status,
    currency: account.baseCurrency,
    startingBalance: account.startingBalance,
    mockCashBalance: account.mockCashBalance,
    mockBuyingPower: account.mockBuyingPower,
    reservedMockCash: account.reservedMockCash,
    openedAt: account.openedAt,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function publicOrder(order: typeof orders.$inferSelect) {
  return {
    id: order.id,
    accountId: order.accountId,
    clientOrderId: order.clientOrderId,
    instrumentId: order.instrumentId,
    side: order.side,
    type: order.type,
    status: order.status,
    timeInForce: order.timeInForce,
    product: order.product,
    source: order.source,
    limitPrice: order.limitPrice,
    stopPrice: order.stopPrice,
    expiresAt: order.expiresAt,
    quantity: order.quantity,
    filledQuantity: order.filledQuantity,
    averageFillPrice: order.averageFillPrice,
    notionalEstimate: order.notionalEstimate,
    placedAt: order.placedAt,
    rejectedReason: order.rejectedReason,
    canceledReason: order.canceledReason,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

function publicTrade(trade: typeof trades.$inferSelect) {
  return {
    id: trade.id,
    orderId: trade.orderId,
    accountId: trade.accountId,
    instrumentId: trade.instrumentId,
    side: trade.side,
    quantity: trade.quantity,
    price: trade.price,
    grossAmount: trade.grossAmount,
    fees: trade.fees,
    netAmount: trade.netAmount,
    priceSource: trade.priceSource,
    quoteObservedAt: trade.quoteObservedAt,
    executionReason: trade.executionReason,
    executedAt: trade.executedAt,
  };
}

function publicPosition(position: typeof positions.$inferSelect) {
  return {
    id: position.id,
    accountId: position.accountId,
    instrumentId: position.instrumentId,
    product: position.product,
    quantity: position.quantity,
    availableQuantity: position.availableQuantity,
    averageCost: position.averageCost,
    realizedPnl: position.realizedPnl,
    unrealizedPnl: position.unrealizedPnl,
    openedAt: position.openedAt,
    updatedAt: position.updatedAt,
  };
}

function publicInstrument(instrument: typeof instruments.$inferSelect) {
  return {
    id: instrument.id,
    symbol: instrument.symbol,
    exchange: instrument.exchange,
    name: instrument.name,
    type: instrument.type,
    status: instrument.status,
    currency: instrument.currency,
    lotSize: instrument.lotSize,
    tickSize: instrument.tickSize,
  };
}

function publicPortfolioSnapshot(
  snapshot: typeof portfolioSnapshots.$inferSelect,
) {
  return {
    id: snapshot.id,
    accountId: snapshot.accountId,
    equity: snapshot.equity,
    mockCashBalance: snapshot.mockCashBalance,
    positionsValue: snapshot.positionsValue,
    realizedPnl: snapshot.realizedPnl,
    unrealizedPnl: snapshot.unrealizedPnl,
    returnPct: snapshot.returnPct,
    snapshotAt: snapshot.snapshotAt,
  };
}

function positionValuation(
  position: typeof positions.$inferSelect,
  envelope: QuoteEnvelope | undefined,
) {
  const currentPrice = envelope?.quote?.lastPrice ?? num(position.averageCost);
  const marketValue = num(position.quantity) * currentPrice;
  const unrealizedPnl =
    num(position.quantity) * (currentPrice - num(position.averageCost));
  return {
    currentPrice: money(currentPrice),
    marketValue,
    unrealizedPnl: money(unrealizedPnl),
    valuation: {
      source: envelope?.quote ? "latest_quote" : "average_cost_fallback",
      stale: envelope?.stale ?? true,
      observedAt:
        envelope?.quote?.lastTradeTime ??
        envelope?.quote?.lastUpdateTime ??
        envelope?.quote?.receivedAt ??
        null,
    },
  };
}

function publicExecutionResult(result: ExecutionResult, replayed: boolean) {
  return {
    order: publicOrder(result.order),
    trade: publicTrade(result.trade),
    account: publicAccount(result.account),
    position: publicPosition(result.position),
    realizedPnl: result.realizedPnl,
    filled: true,
    replayed,
  };
}

/**
 * Buying power held for one position, on top of the cash its trades moved.
 * - Delivery long: none; the full cost already left cash.
 * - Delivery short (legacy): proceeds stay as collateral, plus the same again.
 * - Intraday long: the full cost left cash, but only the margin is required,
 *   so the rest is handed back (a negative hold).
 * - Intraday short: proceeds stay as collateral, plus the margin.
 */
export function positionHold(
  product: OrderProduct,
  quantity: number,
  averageCost: number,
) {
  const value = Math.abs(quantity) * averageCost;
  if (product === "intraday") {
    return quantity < 0
      ? (1 + INTRADAY_MARGIN_RATE) * value
      : (INTRADAY_MARGIN_RATE - 1) * value;
  }
  return quantity < 0 ? SHORT_HOLD_FACTOR * value : 0;
}

/** Shares of an order that add exposure rather than close an existing position. */
function openingQuantity(
  position: { quantity: string } | undefined,
  side: OrderSide,
  quantity: number,
) {
  const current = num(position?.quantity);
  const closable =
    side === "buy" ? Math.max(0, -current) : Math.max(0, current);
  return Math.max(0, quantity - closable);
}

function buildAccountSummary(
  account: typeof tradingAccounts.$inferSelect,
  accountPositions: Array<{
    marketValue: number;
    realizedPnl: string;
    unrealizedPnl: string;
  }>,
) {
  const positionsValue = accountPositions.reduce(
    (total, position) => total + position.marketValue,
    0,
  );
  const realizedPnl = accountPositions.reduce(
    (total, position) => total + num(position.realizedPnl),
    0,
  );
  const unrealizedPnl = accountPositions.reduce(
    (total, position) => total + num(position.unrealizedPnl),
    0,
  );
  const equity = num(account.mockCashBalance) + positionsValue;
  return {
    currency: account.baseCurrency,
    mockCashBalance: account.mockCashBalance,
    mockBuyingPower: account.mockBuyingPower,
    reservedMockCash: account.reservedMockCash,
    positionsValue: money(positionsValue),
    equity: money(equity),
    realizedPnl: money(realizedPnl),
    unrealizedPnl: money(unrealizedPnl),
    returnPct:
      num(account.startingBalance) === 0
        ? "0.000000"
        : (
            (equity - num(account.startingBalance)) /
            num(account.startingBalance)
          ).toFixed(6),
  };
}

function mapInstrumentType(instrument: InstrumentRecord) {
  const value =
    `${instrument.instrumentType} ${instrument.scripType}`.toLowerCase();
  if (value.includes("index")) return "index";
  if (value.includes("future")) return "future";
  if (value.includes("option")) return "option";
  if (value.includes("mutual")) return "mutual_fund";
  if (value.includes("currency")) return "currency";
  if (value.includes("crypto")) return "crypto";
  if (value.includes("etf")) return "etf";
  return "equity";
}

function parseDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

function num(value: string | number | null | undefined) {
  if (typeof value === "number") return value;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number) {
  return value.toFixed(8);
}

function randomId() {
  return crypto.randomUUID();
}
