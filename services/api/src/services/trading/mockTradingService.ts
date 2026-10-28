import { Buffer } from "node:buffer";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
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
import type { InstrumentRecord, QuoteEnvelope } from "../../types/market";
import type { CatalogService } from "../catalogService";
import type { MarketDataService } from "../marketDataService";

type OrderSide = "buy" | "sell";

/**
 * A short sale credits its proceeds to cash, but buying power drops by the
 * sale value: the proceeds stay as collateral and the same amount again is
 * held as margin (2x the entry value in total). Covering releases it.
 */
const SHORT_HOLD_FACTOR = 2;
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
    const quoteEnvelope = await this.readQuote(instrument.instrumentKey);
    const quotePrice = quoteEnvelope.quote?.lastPrice ?? null;
    if (quoteEnvelope.stale) {
      throw new HttpError(
        409,
        "STALE_QUOTE",
        "The latest quote is stale; retry when live market data is available.",
      );
    }
    if (
      quoteEnvelope.quote?.found !== true ||
      quoteEnvelope.quote.tradable !== true
    ) {
      throw new HttpError(
        422,
        "INSTRUMENT_NOT_TRADABLE",
        "The instrument is not currently tradable.",
      );
    }
    if (
      quotePrice === null ||
      !Number.isFinite(quotePrice) ||
      quotePrice <= 0
    ) {
      throw new HttpError(422, "QUOTE_UNAVAILABLE", "No usable latest quote.");
    }
    assertPriceBand(
      instrument,
      quotePrice,
      quoteEnvelope.quote.ohlc?.close ?? null,
    );
    const referencePrice = quotePrice;

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

      const orderId = randomId();
      const clientOrderId = input.clientOrderId?.trim() || orderId;
      const notional = input.quantity * referencePrice;
      const now = new Date();

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
          status: "queued",
          timeInForce: "day",
          quantity: money(input.quantity),
          limitPrice: null,
          stopPrice: null,
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
        message: "Market order accepted for immediate mock execution.",
        context,
      });

      const result = await this.executeMarketOrder(tx, {
        account,
        order: createdOrder,
        input,
        instrument,
        quoteEnvelope,
        referencePrice,
        context,
      });
      return publicExecutionResult(result, false);
    });
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

  private async executeMarketOrder(
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
    const current = await this.readPosition(
      tx,
      args.account.id,
      args.instrument.instrumentKey,
    );
    const shortQty = Math.max(0, -num(current?.quantity));
    const coverQty = Math.min(args.input.quantity, shortQty);
    const longQty = args.input.quantity - coverQty;
    const released = SHORT_HOLD_FACTOR * coverQty * num(current?.averageCost);
    if (num(args.account.mockBuyingPower) + released < net) {
      throw new HttpError(
        409,
        "INSUFFICIENT_MOCK_CASH",
        "Mock buying power is insufficient.",
      );
    }

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
        executionReason: "market_order_immediate_fill",
        executionVenue: "mock_internal",
        executedAt: now,
        metadata: { mock: true },
      })
      .returning();

    const realizedPnl =
      coverQty > 0
        ? await this.consumeLots(
            tx,
            args.account.id,
            args.instrument.instrumentKey,
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
      args.account.userId,
      args.instrument.instrumentKey,
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
        metadata: { source: "market_order", direction: "long" },
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
          ? "Mock market buy fill (short cover)."
          : "Mock market buy fill.",
    });

    const [account] = await tx
      .update(tradingAccounts)
      .set({
        mockCashBalance: money(newCash),
        mockBuyingPower: money(
          newCash -
            num(args.account.reservedMockCash) -
            (await this.shortHold(tx, args.account.id)),
        ),
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
      message: "Market buy filled from latest quote.",
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
    const position = await this.readPosition(
      tx,
      args.account.id,
      args.instrument.instrumentKey,
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
    // Opening a short costs buying power equal to its value (see SHORT_HOLD_FACTOR).
    const buyingPowerAfterClose =
      num(args.account.mockBuyingPower) + closeQty * args.referencePrice;
    if (
      shortQty > 0 &&
      buyingPowerAfterClose < shortQty * args.referencePrice
    ) {
      throw new HttpError(
        409,
        "INSUFFICIENT_MOCK_CASH",
        "Not enough buying power to cover the margin for this short sale.",
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
        executionReason: "market_order_immediate_fill",
        executionVenue: "mock_internal",
        executedAt: now,
        metadata: { mock: true },
      })
      .returning();

    const realizedPnl =
      closeQty > 0
        ? await this.consumeLots(
            tx,
            args.account.id,
            args.instrument.instrumentKey,
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
        metadata: { source: "market_order", direction: "short" },
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
          ? "Mock market sell fill (short sale)."
          : "Mock market sell fill.",
    });

    const [account] = await tx
      .update(tradingAccounts)
      .set({
        mockCashBalance: money(newCash),
        mockBuyingPower: money(
          newCash -
            num(args.account.reservedMockCash) -
            (await this.shortHold(tx, args.account.id)),
        ),
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
      message: "Market sell filled from latest quote.",
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

  async reserveForOpenOrder(
    tx: Tx,
    args: {
      account: typeof tradingAccounts.$inferSelect;
      order: typeof orders.$inferSelect;
      input: CreateOrderInput;
      instrument: InstrumentRecord;
      referencePrice: number | null;
    },
  ) {
    if (args.input.side === "buy") {
      if (args.referencePrice === null) {
        throw new HttpError(
          422,
          "PRICE_REQUIRED",
          "Limit or stop price is required.",
        );
      }
      const reservedCash = args.input.quantity * args.referencePrice;
      if (num(args.account.mockBuyingPower) < reservedCash) {
        throw new HttpError(
          409,
          "INSUFFICIENT_MOCK_CASH",
          "Mock buying power is insufficient.",
        );
      }
      await tx.insert(orderReservations).values({
        id: randomId(),
        orderId: args.order.id,
        accountId: args.account.id,
        userId: args.account.userId,
        instrumentId: args.instrument.instrumentKey,
        reservationType: "mock_cash",
        reservedMockCash: money(reservedCash),
        idempotencyKey: `${args.order.id}:reservation:cash`,
      });
      await tx
        .update(tradingAccounts)
        .set({
          reservedMockCash: money(
            num(args.account.reservedMockCash) + reservedCash,
          ),
          mockBuyingPower: money(
            num(args.account.mockBuyingPower) - reservedCash,
          ),
          updatedAt: new Date(),
        })
        .where(eq(tradingAccounts.id, args.account.id));
      return;
    }

    const [position] = await tx
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.accountId, args.account.id),
          eq(positions.instrumentId, args.instrument.instrumentKey),
        ),
      )
      .limit(1);
    if (!position || num(position.availableQuantity) < args.input.quantity) {
      throw new HttpError(
        409,
        "INSUFFICIENT_POSITION",
        "Available mock position is insufficient.",
      );
    }

    await tx.insert(orderReservations).values({
      id: randomId(),
      orderId: args.order.id,
      accountId: args.account.id,
      userId: args.account.userId,
      instrumentId: args.instrument.instrumentKey,
      reservationType: "quantity",
      reservedQuantity: money(args.input.quantity),
      idempotencyKey: `${args.order.id}:reservation:quantity`,
    });
    await tx
      .update(positions)
      .set({
        availableQuantity: money(
          num(position.availableQuantity) - args.input.quantity,
        ),
        updatedAt: new Date(),
      })
      .where(eq(positions.id, position.id));
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
      const [position] = await tx
        .select()
        .from(positions)
        .where(
          and(
            eq(positions.accountId, reservation.accountId),
            eq(positions.instrumentId, reservation.instrumentId),
          ),
        )
        .limit(1);
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
    _userId: string,
    instrumentId: string,
    quantity: number,
    price: number,
    realizedPnl = 0,
  ) {
    const current = await this.readPosition(tx, accountId, instrumentId);
    const now = new Date();

    if (!current) {
      const [created] = await tx
        .insert(positions)
        .values({
          id: randomId(),
          accountId,
          instrumentId,
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

  private async readPosition(tx: Tx, accountId: string, instrumentId: string) {
    const [position] = await tx
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.accountId, accountId),
          eq(positions.instrumentId, instrumentId),
        ),
      )
      .limit(1);
    return position;
  }

  /** Buying power held against the account's open short positions. */
  private async shortHold(tx: Tx, accountId: string) {
    const shorts = await tx
      .select({
        quantity: positions.quantity,
        averageCost: positions.averageCost,
      })
      .from(positions)
      .where(
        and(eq(positions.accountId, accountId), lt(positions.quantity, "0")),
      );
    return shorts.reduce(
      (total, row) =>
        total + SHORT_HOLD_FACTOR * -num(row.quantity) * num(row.averageCost),
      0,
    );
  }

  private async consumeLots(
    tx: Tx,
    accountId: string,
    instrumentId: string,
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
          eq(positionLots.accountId, accountId),
          eq(positionLots.instrumentId, instrumentId),
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
  if (input.type !== "market") {
    throw new HttpError(
      400,
      "UNSUPPORTED_ORDER_TYPE",
      "The MVP supports market orders only.",
    );
  }
  if (input.timeInForce && input.timeInForce !== "day") {
    throw new HttpError(
      400,
      "UNSUPPORTED_TIME_IN_FORCE",
      "The MVP supports day time-in-force only.",
    );
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new HttpError(
      400,
      "INVALID_ORDER",
      "quantity must be greater than zero.",
    );
  }
  if (input.limitPrice != null || input.stopPrice != null) {
    throw new HttpError(
      400,
      "UNSUPPORTED_ORDER_FIELDS",
      "limitPrice and stopPrice are not accepted for market orders.",
    );
  }
}

function assertInstrumentRules(
  instrument: InstrumentRecord,
  input: CreateOrderInput,
) {
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
