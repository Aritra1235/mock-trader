import { Elysia } from "elysia";
import { openapi } from "@elysia/openapi";
import { opentelemetry } from "@elysia/opentelemetry";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import type { AppEnv } from "../config/env";
import { readDocsFile } from "../routes/docs";
import { CatalogService } from "../services/catalogService";
import { MarketDataService } from "../services/marketDataService";
import { PaytmSessionService } from "../services/paytmSessionService";
import { MarketGateway } from "../ws/marketGateway";
import type { MarketDataStore } from "../repositories/marketDataStore";
import type { SubscriptionLeaseRepository } from "../repositories/subscriptionLeaseRepository";

export interface AppDependencies {
  env: AppEnv;
  catalog: CatalogService;
  marketData: MarketDataService;
  sessionService: PaytmSessionService;
  gateway: MarketGateway;
  store: MarketDataStore;
  leases: SubscriptionLeaseRepository;
}

export function buildApp(deps: AppDependencies) {
  return new Elysia()
    .use(openapi())
    .use(
      opentelemetry({
        spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
      }),
    )

    .get("/", async () => ({
      service: deps.env.serviceName,
      status: "ok",
      docs: "/docs/index.html",
      websocket: deps.env.priceWsPath,
    }))
    .get("/health", async () => ({
      status: "ok",
      service: deps.env.serviceName,
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
        service: deps.env.serviceName,
        catalogCount,
        catalogSyncedAt: deps.catalog.getLastSyncedAt(),
        websocketPath: deps.env.priceWsPath,
      };
    })
    .get("/v1/market/stats", async () => ({
      catalogCount: deps.catalog.count(),
      catalogSyncedAt: deps.catalog.getLastSyncedAt(),
      upstreamMode: deps.env.upstreamMode,
      websocketPath: deps.env.priceWsPath,
    }))
    .get("/v1/market/instruments/search", async ({ query }) =>
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
    .get("/v1/market/instruments/:id", async ({ params, set }) => {
      const instrument = deps.catalog.resolve(params.id);
      if (!instrument) {
        set.status = 404;
        return { error: "instrument not found" };
      }
      return instrument;
    })
    .get("/v1/market/quotes", async ({ query, set }) => {
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
          : deps.env.upstreamMode;

      return {
        data: await deps.marketData.getQuotes(ids, mode),
      };
    })
    .get("/v1/market/candles/:id", async ({ params, query, set }) => {
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
    .get("/v1/market/provider/chart", async ({ query, set }) => {
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
      return readDocsFile(deps.env.docsDir, "index.html");
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
      return readDocsFile(deps.env.docsDir, fileName);
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
      return readDocsFile(deps.env.docsDir, fileName);
    })
    .ws(deps.env.priceWsPath, {
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
