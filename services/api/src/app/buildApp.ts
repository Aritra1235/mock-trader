import { openapi } from "@elysia/openapi";
import { opentelemetry } from "@elysia/opentelemetry";
import { cors } from "@elysiajs/cors";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { type Context, Elysia } from "elysia";
import { apiVersion } from "../config/const";
import type { AppEnv } from "../config/env";
import { auth } from "../lib/auth";
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
import type { MarketDataService } from "../services/marketDataService";
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
  const app = new Elysia()
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
        const session = await authSession.getSession(request);
        if (!session?.user || session.user.banned) {
          set.status = 401;
          return { error: "WEBSOCKET_UNAUTHORIZED" };
        }
      },
      maxPayloadLength: 16 * 1024,
      open: (ws) => {
        deps.gateway.open(ws);
      },
      message: async (ws, message) => {
        await deps.gateway.message(ws, message);
      },
      close: (ws) => {
        void deps.gateway.close(ws);
      },
    });
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
