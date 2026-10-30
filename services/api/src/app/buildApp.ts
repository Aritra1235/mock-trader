import { openapi } from "@elysia/openapi";
import { opentelemetry } from "@elysia/opentelemetry";
import { cors } from "@elysiajs/cors";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { type Context, Elysia } from "elysia";
import { apiVersion } from "../config/const";
import type { AppEnv } from "../config/env";
import { auth } from "../lib/auth";
import { log } from "../lib/log";
import { requestIdFor } from "../lib/requestId";
import type { MarketDataStore } from "../repositories/marketDataStore";
import type { SubscriptionLeaseRepository } from "../repositories/subscriptionLeaseRepository";
import { readDocsFile } from "../routes/docs";
import { registerTradingRoutes } from "../routes/trading";
import {
  type AuthSessionService,
  betterAuthSessionService,
} from "../services/authSessionService";
import type { CatalogService } from "../services/catalogService";
import {
  fetchHistoricalCandles,
  type HistoricalCandles,
  type HistoryRange,
} from "../services/historicalMarketData";
import type { MarketDataService } from "../services/marketDataService";
import {
  DrizzleOnboardingService,
  type OnboardingService,
} from "../services/onboarding/onboardingService";
import type { PaytmSessionService } from "../services/paytmSessionService";
import {
  DrizzleMockTradingService,
  type MockTradingService,
} from "../services/trading/mockTradingService";
import type { MarketGateway } from "../ws/marketGateway";

export interface AppDependencies {
  env: AppEnv;
  catalog: CatalogService;
  marketData: MarketDataService;
  sessionService: PaytmSessionService;
  gateway: MarketGateway;
  store: MarketDataStore;
  leases: SubscriptionLeaseRepository;
  databasePing?: () => Promise<boolean>;
  authSession?: AuthSessionService;
  trading?: MockTradingService;
  onboarding?: OnboardingService;
  history?: (
    instrument: NonNullable<ReturnType<CatalogService["resolve"]>>,
    range: HistoryRange,
  ) => Promise<HistoricalCandles>;
}

const betterAuthView = (context: Context) => {
  const BETTER_AUTH_ACCEPT_METHODS = ["POST", "GET"];
  // validate request method
  if (BETTER_AUTH_ACCEPT_METHODS.includes(context.request.method)) {
    return auth.handler(context.request);
  }

  return context.status(405, "Method not allowed");
};

export function buildApp(deps: AppDependencies) {
  const authSession = deps.authSession ?? betterAuthSessionService;
  const trading =
    deps.trading ??
    new DrizzleMockTradingService(deps.catalog, deps.marketData);
  const onboarding =
    deps.onboarding ?? new DrizzleOnboardingService(deps.catalog, trading);
  const marketPrefix = `/api/${apiVersion}/market/`;

  /** Market data is for onboarded users only; returns an error body otherwise. */
  /**
   * Who is calling and whether they're onboarded. A failed lookup (database
   * down, schema missing) is "unavailable", not "signed out": answering 401
   * there would wrongly tell a signed-in user to log in again.
   */
  const accessFor = async (request: Request) => {
    try {
      const session = await authSession.getSession(request);
      if (!session?.user || session.user.banned) return "signed-out" as const;
      return (await onboarding.isComplete(session.user.id))
        ? ("ok" as const)
        : ("not-onboarded" as const);
    } catch (error) {
      log.error("session lookup failed", {
        path: new URL(request.url).pathname,
        requestId: requestIdFor(request),
        error,
      });
      return "unavailable" as const;
    }
  };

  /** Market data is for onboarded users only; returns an error body otherwise. */
  const requireOnboarded = async (
    request: Request,
    set: { status?: number | string },
  ) => {
    const access = await accessFor(request);
    if (access === "unavailable") {
      set.status = 503;
      return apiError(
        request,
        "SERVICE_UNAVAILABLE",
        "The service is temporarily unavailable. Try again shortly.",
      );
    }
    if (access === "signed-out") {
      set.status = 401;
      return apiError(request, "UNAUTHORIZED", "Authentication is required.");
    }
    if (access === "not-onboarded") {
      set.status = 403;
      return apiError(
        request,
        "ONBOARDING_REQUIRED",
        "Finish onboarding to open your practice account first.",
      );
    }
  };

  const app = new Elysia()
    // One log line per request, written once the response has been sent.
    .onRequest(({ request }) => {
      requestStarts.set(request, performance.now());
    })
    .onAfterResponse({ as: "global" }, ({ request, set, responseValue }) =>
      logRequest(request, statusOf(responseValue, set.status)),
    )
    .onError({ as: "global" }, ({ request, error, code, set }) => {
      // Validation and not-found errors are logged by the request line alone.
      if (code === "NOT_FOUND" || code === "VALIDATION" || code === "PARSE")
        return;
      log.error("http unhandled error", {
        method: request.method,
        path: new URL(request.url).pathname,
        requestId: requestIdFor(request),
        code,
        error,
      });
      set.status = 500;
      return apiError(
        request,
        "INTERNAL_ERROR",
        "An unexpected error occurred.",
      );
    })
    .use(
      cors({
        origin: deps.env.service.allowedOrigins ?? ["http://localhost:3001"],
        credentials: true,
        allowedHeaders: [
          "Content-Type",
          "Idempotency-Key",
          "X-Request-Id",
          "X-Device-Fingerprint",
        ],
        exposeHeaders: ["X-Request-Id"],
        // Cache preflights for 10 minutes instead of the plugin's 5 seconds.
        maxAge: 600,
      }),
    )
    .use(openapi())
    .use(
      opentelemetry({
        spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
      }),
    )
    .onRequest(({ request, set }) => {
      set.headers["x-request-id"] = requestIdFor(request);
    })

    .all(`/api/${apiVersion}/auth/*`, betterAuthView)

    .get("/", async () => ({
      service: deps.env.service.name,
      status: "ok",
      docs: "/docs/index.html",
      websocket: deps.env.websocket.path,
    }))
    .get("/health", async () => ({
      status: "ok",
      service: deps.env.service.name,
    }))
    .get("/openapi.json", async ({ set }) => {
      set.headers["cache-control"] = "no-store";
      return Bun.file(`${deps.env.paths.docs}/../openapi.json`).json();
    })
    .get("/ready", async ({ set }) => {
      const [sessionStatus, redisOk, leasesOk, postgresOk] = await Promise.all([
        deps.sessionService.getStatus(),
        deps.store.ping().catch(() => false),
        deps.leases.ping().catch(() => false),
        deps.databasePing
          ? deps.databasePing().catch(() => false)
          : Promise.resolve(true),
      ]);
      const catalogCount = deps.catalog.count();
      const checks = {
        redis: redisOk,
        subscriptionLeases: leasesOk,
        postgres: postgresOk,
        paytmSession:
          sessionStatus.hasPublicToken === true &&
          sessionStatus.hasReadToken === true,
        catalog: catalogCount > 0,
      };
      const ready = Object.values(checks).every(Boolean);

      if (!ready) {
        set.status = 503;
      }

      return {
        ready,
        checks,
        service: deps.env.service.name,
        catalogCount,
        catalogSyncedAt: deps.catalog.getLastSyncedAt(),
        websocketPath: deps.env.websocket.path,
      };
    })
    .onBeforeHandle(({ request, set }) => {
      if (new URL(request.url).pathname.startsWith(marketPrefix)) {
        return requireOnboarded(request, set);
      }
    })
    .get(`/api/${apiVersion}/market/stats`, async () => ({
      catalogCount: deps.catalog.count(),
      catalogSyncedAt: deps.catalog.getLastSyncedAt(),
      upstreamMode: deps.env.market.upstreamMode,
      websocketPath: deps.env.websocket.path,
    }))
    .get(
      `/api/${apiVersion}/market/instruments/search`,
      async ({ query, request, set }) => {
        const q = typeof query.q === "string" ? query.q.trim() : undefined;
        if (q && q.length > 100) {
          set.status = 400;
          return apiError(request, "INVALID_QUERY", "q is too long.");
        }
        return deps.catalog.search({
          q,
          limit: boundedInteger(query.limit, 20, 1, 100),
          exchange:
            typeof query.exchange === "string" ? query.exchange : undefined,
          scripType:
            typeof query.scripType === "string" ? query.scripType : undefined,
        });
      },
    )
    .get(
      `/api/${apiVersion}/market/instruments/:id`,
      async ({ params, request, set }) => {
        const instrument = deps.catalog.resolve(params.id);
        if (!instrument) {
          set.status = 404;
          return apiError(
            request,
            "INSTRUMENT_NOT_FOUND",
            "Instrument was not found.",
          );
        }
        return instrument;
      },
    )
    .get(
      `/api/${apiVersion}/market/instruments/:id/history`,
      async ({ params, query, request, set }) => {
        const instrument = deps.catalog.resolve(params.id);
        if (!instrument) {
          set.status = 404;
          return apiError(
            request,
            "INSTRUMENT_NOT_FOUND",
            "Instrument was not found.",
          );
        }
        if (
          instrument.scripType !== "EQUITY" ||
          instrument.exchange !== "NSE"
        ) {
          set.status = 422;
          return apiError(
            request,
            "HISTORY_UNSUPPORTED",
            "History is available for NSE equities only.",
          );
        }
        const range = typeof query.range === "string" ? query.range : "5d";
        if (!["5d", "1mo", "6mo", "1y"].includes(range)) {
          set.status = 400;
          return apiError(
            request,
            "INVALID_RANGE",
            "Choose 5d, 1mo, 6mo, or 1y.",
          );
        }
        try {
          const history = await (deps.history ?? fetchHistoricalCandles)(
            instrument,
            range as HistoryRange,
          );
          set.headers["cache-control"] = "public, max-age=300";
          return history;
        } catch {
          set.status = 502;
          return apiError(
            request,
            "HISTORY_UNAVAILABLE",
            "Historical prices are temporarily unavailable.",
          );
        }
      },
    )
    .get(
      `/api/${apiVersion}/market/quotes`,
      async ({ query, request, set }) => {
        const ids =
          typeof query.ids === "string"
            ? query.ids
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean)
            : [];

        if (ids.length === 0) {
          set.status = 400;
          return apiError(
            request,
            "INVALID_QUERY",
            "ids query parameter is required.",
          );
        }
        if (ids.length > 100) {
          set.status = 400;
          return apiError(
            request,
            "INVALID_QUERY",
            "A maximum of 100 instrument IDs is allowed.",
          );
        }

        const mode =
          query.mode === "LTP" ||
          query.mode === "QUOTE" ||
          query.mode === "FULL"
            ? query.mode
            : deps.env.market.upstreamMode;

        try {
          const knownIds = ids.filter((id) => deps.catalog.resolve(id));
          const unknownIds = ids.filter((id) => !deps.catalog.resolve(id));
          return {
            data: sanitizeQuoteEnvelopes(
              await deps.marketData.getQuotes(knownIds, mode),
            ),
            errors: unknownIds.map((id) => ({
              id,
              code: "INSTRUMENT_NOT_FOUND",
              message: "Instrument was not found.",
            })),
          };
        } catch {
          set.status = 502;
          return apiError(
            request,
            "MARKET_DATA_UNAVAILABLE",
            "Quote refresh is temporarily unavailable.",
          );
        }
      },
    );

  return registerTradingRoutes(app, {
    authSession,
    trading,
    onboarding,
  })
    .get("/docs", ({ redirect }) => redirect("/docs/index.html"))
    .get("/docs/", ({ redirect }) => redirect("/docs/index.html"))
    .get("/docs/index.html", async ({ set }) => {
      set.headers["content-type"] = "text/html; charset=utf-8";
      return readDocsFile(deps.env.paths.docs, "index.html");
    })
    .get("/docs/:name", async ({ params, set }) => {
      const mapping: Record<string, string> = {
        api: "../api.html",
        "api.html": "../api.html",
        dev: "dev.html",
        "dev.html": "dev.html",
        deploy: "deploy.html",
        "deploy.html": "deploy.html",
        "index.html": "index.html",
      };
      const fileName = mapping[params.name];
      if (!fileName) {
        set.status = 404;
        return "Not found";
      }
      set.headers["content-type"] = "text/html; charset=utf-8";
      return readDocsFile(deps.env.paths.docs, fileName);
    })
    .get("/docs/md/:name", async ({ params, set }) => {
      const mapping: Record<string, string> = {
        api: "api.md",
        "api.md": "api.md",
        dev: "dev.md",
        "dev.md": "dev.md",
        deploy: "deploy.md",
        "deploy.md": "deploy.md",
        "frontend-handoff": "frontend-handoff.md",
        "frontend-handoff.md": "frontend-handoff.md",
      };
      const fileName = mapping[params.name];
      if (!fileName) {
        set.status = 404;
        return "Not found";
      }
      set.headers["content-type"] = "text/markdown; charset=utf-8";
      return readDocsFile(deps.env.paths.docs, fileName);
    })
    .ws(deps.env.websocket.path, {
      beforeHandle: async ({ request, set }) => {
        const origin = request.headers.get("origin");
        const allowedOrigins = deps.env.service.allowedOrigins ?? [
          "http://localhost:3001",
        ];
        if (origin && !allowedOrigins.includes(origin)) {
          set.status = 403;
          return { error: "WEBSOCKET_ORIGIN_FORBIDDEN" };
        }
        const access = await accessFor(request);
        if (access === "unavailable") {
          set.status = 503;
          return { error: "SERVICE_UNAVAILABLE" };
        }
        if (access === "signed-out") {
          set.status = 401;
          return { error: "WEBSOCKET_UNAUTHORIZED" };
        }
        if (access === "not-onboarded") {
          set.status = 403;
          return { error: "ONBOARDING_REQUIRED" };
        }
      },
      maxPayloadLength: 16 * 1024,
      open: (ws) => {
        log.info("ws open", { path: deps.env.websocket.path, id: ws.id });
        deps.gateway.open(ws);
      },
      message: async (ws, message) => {
        await deps.gateway.message(ws, message);
      },
      close: (ws, code) => {
        log.info("ws close", { id: ws.id, code });
        void deps.gateway.close(ws);
      },
    });
}

const requestStarts = new WeakMap<Request, number>();
// Probes and docs would drown out real traffic at info level.
const quietPaths = /^\/(health|ready|docs|openapi\.json|favicon\.ico)\b/;

function statusOf(response: unknown, status: number | string | undefined) {
  if (response instanceof Response) return response.status;
  return typeof status === "number" ? status : Number(status) || 200;
}

function logRequest(request: Request, status: number) {
  const url = new URL(request.url);
  const started = requestStarts.get(request);
  const fields = {
    method: request.method,
    // Path only: query strings can carry OAuth codes and other secrets.
    path: url.pathname,
    status,
    ms:
      started === undefined
        ? undefined
        : Math.round(performance.now() - started),
    requestId: requestIdFor(request),
    ip:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      undefined,
    origin: request.headers.get("origin") ?? undefined,
  };
  if (status >= 500) log.error("http request", fields);
  else if (request.method === "OPTIONS" || quietPaths.test(url.pathname))
    log.debug("http request", fields);
  else if (status >= 400) log.warn("http request", fields);
  else log.info("http request", fields);
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function apiError(request: Request, code: string, message: string) {
  return {
    error: {
      code,
      message,
      requestId: requestIdFor(request),
    },
  };
}

function sanitizeQuoteEnvelopes(
  envelopes: Awaited<ReturnType<MarketDataService["getQuotes"]>>,
) {
  return envelopes.map((envelope) => {
    if (!envelope.quote) {
      return envelope;
    }
    const { raw: _raw, ...quote } = envelope.quote;
    return { ...envelope, quote };
  });
}
