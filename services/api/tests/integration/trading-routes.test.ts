import { expect, test } from "bun:test";
import { join } from "node:path";
import { buildApp } from "../../src/app/buildApp";
import type { AppEnv } from "../../src/config/env";
import type { PaytmHttpClient } from "../../src/providers/paytmHttpClient";
import type {
  AuthSessionResult,
  AuthSessionService,
} from "../../src/services/authSessionService";
import { MarketDataService } from "../../src/services/marketDataService";
import { PaytmSessionService } from "../../src/services/paytmSessionService";
import type {
  CancelOrderInput,
  CreateOrderInput,
  DisqualifyInput,
  EligibilityInput,
  LeaderboardOptions,
  MockTradingService,
  RequestContext,
  ResolveInput,
} from "../../src/services/trading/mockTradingService";
import { MarketGateway } from "../../src/ws/marketGateway";
import { InMemoryLeases, InMemoryStore, makeCatalog } from "../testSupport";

test("authenticated portfolio read uses the Better Auth session identity", async () => {
  const { app, trading } = await buildTradingTestApp({
    user: { id: "user-1", role: "user" },
  });

  const response = await app.handle(
    new Request("http://localhost/api/v1/me/portfolio"),
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.accounts[0].account.id).toBe("account-1");
  expect(trading.calls[0]).toEqual(["getPortfolio", "user-1"]);
});

test("bootstrap and account onboarding routes use the authenticated identity", async () => {
  const { app, trading } = await buildTradingTestApp({
    user: { id: "user-1", role: "user" },
  });

  const bootstrap = await app.handle(new Request("http://localhost/api/v1/me"));
  const provision = await app.handle(
    new Request("http://localhost/api/v1/me/accounts", { method: "POST" }),
  );
  const account = await app.handle(
    new Request("http://localhost/api/v1/accounts/account-1"),
  );
  const activity = await app.handle(
    new Request("http://localhost/api/v1/accounts/account-1/activity"),
  );

  expect(bootstrap.status).toBe(200);
  expect(provision.status).toBe(200);
  expect(account.status).toBe(200);
  expect(activity.status).toBe(200);
  expect(trading.calls).toContainEqual(["getMe", "user-1"]);
  expect(trading.calls).toContainEqual(["ensurePracticeAccount", "user-1"]);
  expect(trading.calls).toContainEqual(["getAccount", "user-1", "account-1"]);
});

test("account list routes pass owned account scopes to the trading service", async () => {
  const { app, trading } = await buildTradingTestApp({
    user: { id: "user-1", role: "user" },
  });

  await app.handle(
    new Request("http://localhost/api/v1/accounts/account-1/positions"),
  );
  await app.handle(
    new Request("http://localhost/api/v1/accounts/account-1/orders"),
  );
  await app.handle(
    new Request("http://localhost/api/v1/accounts/account-1/trades"),
  );

  expect(trading.calls).toContainEqual([
    "listPositions",
    "user-1",
    "account-1",
  ]);
  expect(trading.calls).toContainEqual(["listOrders", "user-1", "account-1"]);
  expect(trading.calls).toContainEqual(["listTrades", "user-1", "account-1"]);
});

test("market buy order endpoint forwards supported execution fields", async () => {
  const { app, trading } = await buildTradingTestApp({
    user: { id: "user-1", role: "user" },
  });

  const response = await app.handle(
    new Request("http://localhost/api/v1/accounts/account-1/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "idem-1",
      },
      body: JSON.stringify({
        instrumentId: "RELIANCE",
        side: "buy",
        type: "market",
        quantity: 4,
      }),
    }),
  );
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.order.status).toBe("filled");
  expect(body.trade.side).toBe("buy");
  expect(body.ledger.type).toBe("trade_buy");
  expect(body.position.quantity).toBe("4.00000000");
  expect(trading.lastOrderInput?.idempotencyKey).toBe("idem-1");
  expect(trading.lastOrderInput?.timeInForce).toBe("day");
});

test("restricted users cannot place new orders", async () => {
  const { app, trading } = await buildTradingTestApp({
    user: {
      id: "user-1",
      role: "user",
      tradingStatus: "restricted",
    },
  });

  const response = await app.handle(
    jsonRequest("http://localhost/api/v1/accounts/account-1/orders", {
      instrumentId: "RELIANCE",
      side: "buy",
      type: "market",
      quantity: 2,
    }),
  );
  const body = await response.json();

  expect(response.status).toBe(403);
  expect(body.error.code).toBe("TRADING_RESTRICTED");
  expect(trading.lastOrderInput).toBeNull();
});

test("market sell works and conditional orders are rejected for the MVP", async () => {
  const { app } = await buildTradingTestApp({
    user: { id: "user-1", role: "user" },
  });

  const sellResponse = await app.handle(
    jsonRequest("http://localhost/api/v1/accounts/account-1/orders", {
      instrumentId: "RELIANCE",
      side: "sell",
      type: "market",
      quantity: 2,
    }),
  );
  const sell = await sellResponse.json();
  expect(sell.trade.side).toBe("sell");
  expect(sell.realizedPnl).toBe(120);

  const limitResponse = await app.handle(
    jsonRequest("http://localhost/api/v1/accounts/account-1/orders", {
      instrumentId: "RELIANCE",
      side: "buy",
      type: "limit",
      quantity: 2,
      limitPrice: 1400,
      timeInForce: "gtc",
    }),
  );
  const limit = await limitResponse.json();
  expect(limitResponse.status).toBe(400);
  expect(limit.error.code).toBe("INVALID_REQUEST");

  const cancelResponse = await app.handle(
    jsonRequest("http://localhost/api/v1/orders/order-limit/cancel", {
      reason: "changed mind",
    }),
  );
  const cancel = await cancelResponse.json();
  expect(cancel.order.status).toBe("canceled");
  expect(cancel.releasedReservations).toBe(1);
});

test("deferred competition routes are disabled for the MVP", async () => {
  const { app } = await buildTradingTestApp({ user: null });

  const competitions = await (
    await app.handle(new Request("http://localhost/api/v1/competitions"))
  ).json();
  const leaderboard = await (
    await app.handle(
      new Request("http://localhost/api/v1/competitions/comp-1/leaderboard"),
    )
  ).json();

  expect(competitions.error.code).toBe("FEATURE_NOT_AVAILABLE");
  expect(leaderboard.error.code).toBe("FEATURE_NOT_AVAILABLE");
});

test("admin moderation routes require an admin Better Auth role", async () => {
  const member = await buildTradingTestApp({
    user: { id: "user-1", role: "user" },
  });
  const denied = await member.app.handle(
    new Request("http://localhost/api/v1/admin/risk-reviews"),
  );
  expect(denied.status).toBe(403);

  const admin = await buildTradingTestApp({
    user: { id: "admin-1", role: "admin" },
  });
  const reviews = await (
    await admin.app.handle(
      new Request("http://localhost/api/v1/admin/risk-reviews"),
    )
  ).json();
  expect(reviews.riskReviews[0].id).toBe("review-1");

  await admin.app.handle(
    jsonRequest("http://localhost/api/v1/admin/fraud-alerts/alert-1/resolve", {
      status: "resolved",
      notes: "manual review complete",
    }),
  );
  await admin.app.handle(
    jsonRequest(
      "http://localhost/api/v1/admin/accounts/account-1/leaderboard-eligibility",
      { eligible: false, reason: "abuse" },
    ),
  );
  await admin.app.handle(
    jsonRequest(
      "http://localhost/api/v1/admin/competition-participants/participant-1/disqualify",
      { reason: "collusion" },
    ),
  );

  expect(admin.trading.calls).toContainEqual([
    "resolveFraudAlert",
    "admin-1",
    "alert-1",
    "resolved",
  ]);
  expect(admin.trading.calls).toContainEqual([
    "setLeaderboardEligibility",
    "account-1",
    false,
  ]);
  expect(admin.trading.calls).toContainEqual([
    "disqualifyParticipant",
    "participant-1",
    "collusion",
  ]);
});

async function buildTradingTestApp(options: {
  user: { id: string; role: string; tradingStatus?: string } | null;
}) {
  const env = testEnv();
  const catalog = await makeCatalog(
    "/tmp/mock-trader-catalog-trading-routes.json",
  );
  const store = new InMemoryStore();
  const leases = new InMemoryLeases();
  const sessionService = new PaytmSessionService(
    {} as unknown as PaytmHttpClient,
    "/tmp/mock-trader-session-trading-routes.json",
  );
  const marketData = new MarketDataService(
    catalog,
    {} as unknown as PaytmHttpClient,
    sessionService,
    store,
    60_000,
  );
  const gateway = new MarketGateway(
    "gateway-trading-routes",
    catalog,
    leases,
    store,
    "QUOTE",
    10,
    60_000,
    60_000,
    60_000,
  );
  const trading = new FakeTradingService();
  const authSession = new FakeAuthSessionService(options.user);

  const app = buildApp({
    env,
    catalog,
    marketData,
    sessionService,
    gateway,
    store,
    leases,
    authSession,
    trading,
  });

  return { app, trading };
}

class FakeAuthSessionService implements AuthSessionService {
  constructor(
    private readonly user: {
      id: string;
      role: string;
      tradingStatus?: string;
    } | null,
  ) {}

  async getSession(): Promise<AuthSessionResult | null> {
    if (!this.user) {
      return null;
    }
    return {
      user: {
        id: this.user.id,
        role: this.user.role,
        banned: false,
        tradingStatus: this.user.tradingStatus,
      },
      session: { id: "session-1" },
    };
  }
}

class FakeTradingService implements MockTradingService {
  calls: unknown[][] = [];
  lastOrderInput: CreateOrderInput | null = null;
  lastLeaderboardOptions: LeaderboardOptions | null = null;

  async getMe(userId: string) {
    this.calls.push(["getMe", userId]);
    return {
      user: { id: userId, emailVerified: true },
      accounts: [{ id: "account-1", currency: "INR" }],
      onboarding: { complete: true },
    };
  }

  async ensurePracticeAccount(userId: string) {
    this.calls.push(["ensurePracticeAccount", userId]);
    return { account: { id: "account-1", currency: "INR" }, created: false };
  }

  async getAccount(userId: string, accountId: string) {
    this.calls.push(["getAccount", userId, accountId]);
    return { account: { id: accountId, currency: "INR" } };
  }

  async listAccountActivity(userId: string, accountId: string) {
    this.calls.push(["listAccountActivity", userId, accountId]);
    return { entries: [] };
  }

  async getPortfolio(userId: string) {
    this.calls.push(["getPortfolio", userId]);
    return {
      accounts: [
        {
          account: { id: "account-1", userId },
          summary: { equity: "100000.00000000" },
          positions: [],
          openOrders: [],
          recentTrades: [],
          latestSnapshot: null,
          leaderboard: { eligible: true },
        },
      ],
    };
  }

  async listPositions(userId: string, accountId: string) {
    this.calls.push(["listPositions", userId, accountId]);
    return { positions: [{ id: "position-1", accountId }] };
  }

  async listOrders(userId: string, accountId: string) {
    this.calls.push(["listOrders", userId, accountId]);
    return { orders: [{ id: "order-1", accountId }] };
  }

  async listTrades(userId: string, accountId: string) {
    this.calls.push(["listTrades", userId, accountId]);
    return { trades: [{ id: "trade-1", accountId }] };
  }

  async placeOrder(
    userId: string,
    accountId: string,
    input: CreateOrderInput,
    context: RequestContext,
  ) {
    this.calls.push(["placeOrder", userId, accountId, input.side, input.type]);
    this.lastOrderInput = input;
    expect(context.sessionId).toBe("session-1");

    if (input.type === "limit") {
      return {
        order: { id: "order-limit", status: "accepted" },
        reservation: { reservedMockCash: "2800.00000000" },
      };
    }
    if (input.side === "sell") {
      return {
        order: { id: "order-sell", status: "filled" },
        trade: { id: "trade-sell", side: "sell" },
        position: { id: "position-1", quantity: "2.00000000" },
        realizedPnl: 120,
        filled: true,
      };
    }
    return {
      order: { id: "order-buy", status: "filled" },
      trade: { id: "trade-buy", side: "buy" },
      ledger: { type: "trade_buy" },
      position: { id: "position-1", quantity: "4.00000000" },
      filled: true,
    };
  }

  async cancelOrder(userId: string, orderId: string, input: CancelOrderInput) {
    this.calls.push(["cancelOrder", userId, orderId, input.reason]);
    return {
      order: { id: orderId, status: "canceled" },
      releasedReservations: 1,
    };
  }

  async listCompetitions() {
    this.calls.push(["listCompetitions"]);
    return { competitions: [{ id: "comp-1", status: "active" }] };
  }

  async getLeaderboard(competitionId: string, options: LeaderboardOptions) {
    this.calls.push(["getLeaderboard", competitionId]);
    this.lastLeaderboardOptions = options;
    return {
      competitionId,
      entries: [
        {
          accountId: "account-1",
          rank: 1,
          eligibility: { eligible: true, riskScore: 0 },
        },
      ],
    };
  }

  async listRiskReviews() {
    this.calls.push(["listRiskReviews"]);
    return { riskReviews: [{ id: "review-1" }] };
  }

  async resolveRiskReview(
    reviewerUserId: string,
    reviewId: string,
    input: ResolveInput,
  ) {
    this.calls.push([
      "resolveRiskReview",
      reviewerUserId,
      reviewId,
      input.status,
    ]);
    return { riskReview: { id: reviewId, status: "approved" } };
  }

  async listFraudAlerts() {
    this.calls.push(["listFraudAlerts"]);
    return { fraudAlerts: [{ id: "alert-1" }], recentSignals: [] };
  }

  async resolveFraudAlert(
    resolverUserId: string,
    alertId: string,
    input: ResolveInput,
  ) {
    this.calls.push([
      "resolveFraudAlert",
      resolverUserId,
      alertId,
      input.status,
    ]);
    return { fraudAlert: { id: alertId, status: "resolved" } };
  }

  async setLeaderboardEligibility(accountId: string, input: EligibilityInput) {
    this.calls.push(["setLeaderboardEligibility", accountId, input.eligible]);
    return { account: { id: accountId, leaderboardEligible: input.eligible } };
  }

  async disqualifyParticipant(participantId: string, input: DisqualifyInput) {
    this.calls.push(["disqualifyParticipant", participantId, input.reason]);
    return { participant: { id: participantId, status: "disqualified" } };
  }
}

function jsonRequest(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `test-${crypto.randomUUID()}`,
    },
    body: JSON.stringify(body),
  });
}

function testEnv(): AppEnv {
  return {
    service: {
      name: "mock-trader-api",
      port: 3000,
    },
    redis: {
      url: "redis://localhost:6379",
      database: 2,
    },
    db: {
      url: "postgres://postgres:postgres@localhost:5432/mock_trader",
      poolMax: 10,
    },
    paths: {
      docs: join(import.meta.dir, "..", "..", "docs"),
      data: "/tmp/mock-trader-data",
      session: "/tmp/mock-trader-session-app.json",
      catalogSnapshot: "/tmp/mock-trader-catalog-app.json",
    },
    catalog: {
      files: ["security_master.csv"],
      refreshMs: 12 * 60 * 60 * 1000,
    },
    websocket: {
      path: "/ws/market",
    },
    market: {
      upstreamMode: "QUOTE",
      reconnectAttempts: 10,
      quoteStaleMs: 60_000,
      redis: {
        controlChannel: "market:control",
        eventsChannel: "market:events:quotes",
        latestQuotePrefix: "market:quote:latest",
        candlePrefix: "market:candles:1m",
      },
      candleRetentionMs: 14 * 24 * 60 * 60 * 1000,
    },
    subscriptions: {
      maxClients: 10,
      leasePrefix: "market:subscription:leases",
      leaseMs: 60_000,
      heartbeatMs: 60_000,
      sweepMs: 60_000,
    },
    paytm: {
      apiKey: "test-api-key",
      apiSecret: "test-secret-key",
    },
  };
}
