import { openapi } from "@elysia/openapi";
import { opentelemetry } from "@elysia/opentelemetry";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { type Context, Elysia } from "elysia";
import type { AppEnv } from "../config/env";
import { auth } from "../lib/auth";
import type { MarketDataStore } from "../repositories/marketDataStore";
import type { SubscriptionLeaseRepository } from "../repositories/subscriptionLeaseRepository";
import { readDocsFile } from "../routes/docs";
import type { CatalogService } from "../services/catalogService";
import type { MarketDataService } from "../services/marketDataService";
import type { PaytmSessionService } from "../services/paytmSessionService";
import type { MarketGateway } from "../ws/marketGateway";
import { apiVersion } from "../config/const";


export interface AppDependencies {
  env: AppEnv;
  catalog: CatalogService;
  marketData: MarketDataService;
  sessionService: PaytmSessionService;
  gateway: MarketGateway;
  store: MarketDataStore;
  leases: SubscriptionLeaseRepository;
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
  return new Elysia()
    .use(openapi())
    .use(
      opentelemetry({
        spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
      }),
    )

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
    .get("/ready", async ({ set }) => {
      const [sessionStatus, redisOk, leasesOk] = await Promise.all([
        deps.sessionService.getStatus(),
        deps.store.ping().catch(() => false),
        deps.leases.ping().catch(() => false),
      ]);
      const catalogCount = deps.catalog.count();
      const checks = {
        redis: redisOk,
        subscriptionLeases: leasesOk,
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
    .get(`/${apiVersion}/market/instruments/search`, async ({ query }) =>
      deps.catalog.search({
        q: typeof query.q === "string" ? query.q : undefined,
        limit:
          typeof query.limit === "string" ? Number(query.limit) : undefined,
        exchange:
          typeof query.exchange === "string" ? query.exchange : undefined,
        scripType:
          typeof query.scripType === "string" ? query.scripType : undefined,
      }),
    )
    .get(`/api/${apiVersion}/market/instruments/:id`, async ({ params, set }) => {
      const instrument = deps.catalog.resolve(params.id);
      if (!instrument) {
        set.status = 404;
        return { error: "instrument not found" };
      }
      return instrument;
    })
    .get(`/api/${apiVersion}/market/quotes`, async ({ query, set }) => {
      const ids =
        typeof query.ids === "string"
          ? query.ids
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)
          : [];

      if (ids.length === 0) {
        set.status = 400;
        return { error: "ids query parameter is required" };
      }

      const mode =
        query.mode === "LTP" || query.mode === "QUOTE" || query.mode === "FULL"
          ? query.mode
          : deps.env.market.upstreamMode;

      return {
        data: await deps.marketData.getQuotes(ids, mode),
      };
    })
    .get(`/api/${apiVersion}/market/candles/:id`, async ({ params, query, set }) => {
      const fromMs =
        typeof query.from === "string"
          ? Date.parse(query.from)
          : Date.now() - 6 * 60 * 60 * 1000;
      const toMs =
        typeof query.to === "string" ? Date.parse(query.to) : Date.now();
      const interval =
        typeof query.interval === "string" && query.interval.trim()
          ? query.interval.trim()
          : "1m";
      const limit =
        typeof query.limit === "string" ? Number(query.limit) : 1000;

      const result = await deps.marketData.listCandles(
        params.id,
        interval,
        Number.isNaN(fromMs) ? Date.now() - 6 * 60 * 60 * 1000 : fromMs,
        Number.isNaN(toMs) ? Date.now() : toMs,
        Number.isFinite(limit) ? limit : 1000,
      );

      if (!result) {
        set.status = 404;
        return { error: "instrument not found" };
      }

      return {
        instrument: result.instrument,
        interval,
        candles: result.candles,
      };
    })
    .get(`/api/${apiVersion}/market/provider/chart`, async ({ query, set }) => {
      const params = Object.fromEntries(
        Object.entries(query).flatMap(([key, value]) =>
          typeof value === "string" ? [[key, value]] : [],
        ),
      );

      if (Object.keys(params).length === 0) {
        set.status = 400;
        return { error: "provider chart query parameters are required" };
      }

      try {
        return await deps.marketData.getProviderChart(params);
      } catch (error) {
        set.status = 502;
        return {
          error: "provider chart request failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    })
    .get("/docs", ({ redirect }) => redirect("/docs/index.html"))
    .get("/docs/", ({ redirect }) => redirect("/docs/index.html"))
    .get("/docs/index.html", async ({ set }) => {
      set.headers["content-type"] = "text/html; charset=utf-8";
      return readDocsFile(deps.env.paths.docs, "index.html");
    })
    .get("/docs/:name", async ({ params, set }) => {
      const mapping: Record<string, string> = {
        api: "api.html",
        "api.html": "api.html",
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
