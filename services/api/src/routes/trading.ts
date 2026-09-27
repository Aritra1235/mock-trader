import { apiVersion } from "../config/const";
import { MVP_PRODUCT } from "../config/product";
import { requestIdFor } from "../lib/requestId";
import type {
  AuthSessionResult,
  AuthSessionService,
} from "../services/authSessionService";
import {
  type CancelOrderInput,
  type CreateOrderInput,
  type DisqualifyInput,
  type EligibilityInput,
  HttpError,
  type MockTradingService,
  type ResolveInput,
} from "../services/trading/mockTradingService";

export interface TradingRouteDependencies {
  authSession: AuthSessionService;
  trading: MockTradingService;
}

export function registerTradingRoutes<T>(
  app: T,
  deps: TradingRouteDependencies,
): T {
  const route = `/api/${apiVersion}`;
  const router = app as RouteRegistrar;

  router
    .get(`${route}/me`, async (context: RouteContext) =>
      handleAuthenticated(context, deps, async (session) =>
        deps.trading.getMe(session.user.id),
      ),
    )
    .post(`${route}/me/accounts`, async (context: RouteContext) =>
      handleAuthenticated(context, deps, async (session) =>
        deps.trading.ensurePracticeAccount(session.user.id),
      ),
    )
    .get(`${route}/me/portfolio`, async (context: RouteContext) =>
      handleAuthenticated(context, deps, async (session) =>
        deps.trading.getPortfolio(session.user.id),
      ),
    )
    .get(`${route}/accounts/:id`, async (context: RouteContext) =>
      handleAuthenticated(context, deps, async (session) =>
        deps.trading.getAccount(session.user.id, context.params.id),
      ),
    )
    .get(`${route}/accounts/:id/activity`, async (context: RouteContext) =>
      handleAuthenticated(context, deps, async (session) =>
        deps.trading.listAccountActivity(
          session.user.id,
          context.params.id,
          paginationOptions(context.query),
        ),
      ),
    )
    .get(`${route}/accounts/:id/positions`, async (context: RouteContext) =>
      handleAuthenticated(context, deps, async (session) =>
        deps.trading.listPositions(session.user.id, context.params.id),
      ),
    )
    .get(`${route}/accounts/:id/orders`, async (context: RouteContext) =>
      handleAuthenticated(context, deps, async (session) =>
        deps.trading.listOrders(
          session.user.id,
          context.params.id,
          paginationOptions(context.query),
        ),
      ),
    )
    .get(`${route}/accounts/:id/trades`, async (context: RouteContext) =>
      handleAuthenticated(context, deps, async (session) =>
        deps.trading.listTrades(
          session.user.id,
          context.params.id,
          paginationOptions(context.query),
        ),
      ),
    )
    .post(`${route}/accounts/:id/orders`, async (context: RouteContext) =>
      handleTrading(context, deps, async (session) =>
        deps.trading.placeOrder(
          session.user.id,
          context.params.id,
          normalizeCreateOrderBody(context.body, context.request),
          requestContext(context.request, session),
        ),
      ),
    )
    .post(`${route}/orders/:id/cancel`, async (context: RouteContext) =>
      handleAuthenticated(context, deps, async (session) =>
        deps.trading.cancelOrder(
          session.user.id,
          context.params.id,
          normalizeCancelBody(context.body),
          requestContext(context.request, session),
        ),
      ),
    )
    .get(`${route}/competitions`, async (context: RouteContext) => {
      if (!MVP_PRODUCT.features.competitions) {
        context.set.status = 404;
        return errorResponse(
          context.request,
          "FEATURE_NOT_AVAILABLE",
          "Competitions are not part of the MVP.",
        );
      }
      return deps.trading.listCompetitions();
    })
    .get(
      `${route}/competitions/:id/leaderboard`,
      async (context: RouteContext) => {
        if (!MVP_PRODUCT.features.competitions) {
          context.set.status = 404;
          return errorResponse(
            context.request,
            "FEATURE_NOT_AVAILABLE",
            "Competitions are not part of the MVP.",
          );
        }
        return deps.trading.getLeaderboard(context.params.id, {
          includeIneligible: context.query.includeIneligible === "true",
        });
      },
    )
    .get(`${route}/admin/risk-reviews`, async (context: RouteContext) =>
      handleAdmin(context, deps, () => deps.trading.listRiskReviews()),
    )
    .post(
      `${route}/admin/risk-reviews/:id/resolve`,
      async (context: RouteContext) =>
        handleAdmin(context, deps, (session) =>
          deps.trading.resolveRiskReview(
            session.user.id,
            context.params.id,
            normalizeResolveBody(context.body),
          ),
        ),
    )
    .get(`${route}/admin/fraud-alerts`, async (context: RouteContext) =>
      handleAdmin(context, deps, () => deps.trading.listFraudAlerts()),
    )
    .post(
      `${route}/admin/fraud-alerts/:id/resolve`,
      async (context: RouteContext) =>
        handleAdmin(context, deps, (session) =>
          deps.trading.resolveFraudAlert(
            session.user.id,
            context.params.id,
            normalizeResolveBody(context.body),
          ),
        ),
    )
    .post(
      `${route}/admin/accounts/:id/leaderboard-eligibility`,
      async (context: RouteContext) =>
        handleAdmin(context, deps, () =>
          deps.trading.setLeaderboardEligibility(
            context.params.id,
            normalizeEligibilityBody(context.body),
          ),
        ),
    )
    .post(
      `${route}/admin/competition-participants/:id/disqualify`,
      async (context: RouteContext) =>
        handleAdmin(context, deps, () =>
          deps.trading.disqualifyParticipant(
            context.params.id,
            normalizeDisqualifyBody(context.body),
          ),
        ),
    );

  return app;
}

async function handleAuthenticated<T>(
  context: RouteContext,
  deps: TradingRouteDependencies,
  action: (session: AuthSessionResult) => Promise<T>,
) {
  try {
    const session = await deps.authSession.getSession(context.request);
    if (!session?.user || session.user.banned) {
      context.set.status = 401;
      return errorResponse(
        context.request,
        "UNAUTHORIZED",
        "Authentication is required.",
      );
    }
    return await action(session);
  } catch (error) {
    return handleRouteError(context, error);
  }
}

async function handleAdmin<T>(
  context: RouteContext,
  deps: TradingRouteDependencies,
  action: (session: AuthSessionResult) => Promise<T>,
) {
  return handleAuthenticated(context, deps, async (session) => {
    if (session.user.role !== "admin") {
      context.set.status = 403;
      return errorResponse(
        context.request,
        "FORBIDDEN",
        "Admin access is required.",
      );
    }
    return action(session);
  });
}

async function handleTrading<T>(
  context: RouteContext,
  deps: TradingRouteDependencies,
  action: (session: AuthSessionResult) => Promise<T>,
) {
  return handleAuthenticated(context, deps, async (session) => {
    if (session.user.tradingStatus && session.user.tradingStatus !== "active") {
      context.set.status = 403;
      return errorResponse(
        context.request,
        "TRADING_RESTRICTED",
        "Trading is not available for this user.",
      );
    }
    return action(session);
  });
}

function handleRouteError(context: RouteContext, error: unknown) {
  if (error instanceof HttpError) {
    context.set.status = error.status;
    return errorResponse(context.request, error.error, error.message);
  }

  context.set.status = 500;
  return errorResponse(
    context.request,
    "INTERNAL_ERROR",
    "An unexpected error occurred.",
  );
}

function errorResponse(request: Request, code: string, message: string) {
  return {
    error: {
      code,
      message,
      requestId: requestIdFor(request),
    },
  };
}

function requestContext(request: Request, session: AuthSessionResult) {
  return {
    sessionId: session.session.id,
    ipAddress:
      request.headers.get("x-forwarded-for") ??
      request.headers.get("x-real-ip"),
    userAgent: request.headers.get("user-agent"),
    deviceFingerprint: request.headers.get("x-device-fingerprint"),
    requestId: requestIdFor(request),
  };
}

function normalizeCreateOrderBody(
  body: unknown,
  request: Request,
): CreateOrderInput {
  const input = objectBody(body);
  const type = enumValue(input.type, ["market"], "type");
  const timeInForce =
    input.timeInForce === undefined || input.timeInForce === null
      ? "day"
      : enumValue(input.timeInForce, ["day"], "timeInForce");
  const idempotencyKey =
    optionalString(input.idempotencyKey) ??
    optionalString(request.headers.get("idempotency-key"));
  if (!idempotencyKey) {
    throw new HttpError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "Send an Idempotency-Key header for every order.",
    );
  }

  return {
    instrumentId: stringValue(input.instrumentId),
    side: enumValue(input.side, ["buy", "sell"], "side"),
    type,
    quantity: numberValue(input.quantity, "quantity"),
    limitPrice:
      input.limitPrice === undefined || input.limitPrice === null
        ? null
        : numberValue(input.limitPrice, "limitPrice"),
    stopPrice:
      input.stopPrice === undefined || input.stopPrice === null
        ? null
        : numberValue(input.stopPrice, "stopPrice"),
    timeInForce,
    clientOrderId: optionalString(input.clientOrderId),
    idempotencyKey,
    metadata: objectOrNull(input.metadata),
  };
}

function normalizeCancelBody(body: unknown): CancelOrderInput {
  const input = body === undefined || body === null ? {} : objectBody(body);
  return { reason: optionalString(input.reason) };
}

function paginationOptions(query: Record<string, unknown>) {
  const parsedLimit =
    typeof query.limit === "string" ? Number(query.limit) : undefined;
  if (
    parsedLimit !== undefined &&
    (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100)
  ) {
    throw new HttpError(
      400,
      "INVALID_PAGINATION",
      "limit must be an integer from 1 to 100.",
    );
  }
  return {
    limit: parsedLimit,
    cursor: optionalString(query.cursor),
  };
}

function normalizeResolveBody(body: unknown): ResolveInput {
  const input = body === undefined || body === null ? {} : objectBody(body);
  return {
    status: optionalString(input.status) ?? undefined,
    notes: optionalString(input.notes),
  };
}

function normalizeEligibilityBody(body: unknown): EligibilityInput {
  const input = objectBody(body);
  if (typeof input.eligible !== "boolean") {
    throw new HttpError(400, "INVALID_REQUEST", "eligible must be boolean.");
  }
  return {
    eligible: input.eligible,
    reason: optionalString(input.reason),
  };
}

function normalizeDisqualifyBody(body: unknown): DisqualifyInput {
  const input = objectBody(body);
  const reason = optionalString(input.reason);
  if (!reason) {
    throw new HttpError(400, "INVALID_REQUEST", "reason is required.");
  }
  return { reason };
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(
      400,
      "INVALID_REQUEST",
      "JSON object body is required.",
    );
  }
  return value as Record<string, unknown>;
}

function objectOrNull(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "INVALID_REQUEST", "metadata must be an object.");
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown) {
  const text = optionalString(value);
  if (!text) {
    throw new HttpError(400, "INVALID_REQUEST", "instrumentId is required.");
  }
  return text;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown, field: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, "INVALID_REQUEST", `${field} must be a number.`);
  }
  return parsed;
}

function enumValue<const T extends string>(
  value: unknown,
  values: readonly T[],
  field: string,
): T {
  if (typeof value === "string" && values.includes(value as T)) {
    return value as T;
  }
  throw new HttpError(400, "INVALID_REQUEST", `${field} is invalid.`);
}

type RouteContext = {
  request: Request;
  set: { status?: number | string };
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  body?: unknown;
};

type RouteRegistrar = {
  get: (
    path: string,
    handler: (context: RouteContext) => unknown,
  ) => RouteRegistrar;
  post: (
    path: string,
    handler: (context: RouteContext) => unknown,
  ) => RouteRegistrar;
};
