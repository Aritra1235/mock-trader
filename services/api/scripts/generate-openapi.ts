import { writeFile } from "node:fs/promises";
import { auth } from "../src/lib/auth";

type OpenApiDocument = {
  openapi?: string;
  paths?: Record<string, unknown>;
  components?: Record<string, Record<string, unknown>>;
};

const authSpec = (await auth.api.generateOpenAPISchema()) as OpenApiDocument;
const authPaths = Object.fromEntries(
  Object.entries(authSpec.paths ?? {}).map(([path, operation]) => [
    `/api/v1/auth${path}`,
    operation,
  ]),
);
const authComponents = authSpec.components ?? {};

const errorResponses = {
  "400": { $ref: "#/components/responses/InvalidRequest" },
  "401": { $ref: "#/components/responses/Unauthorized" },
  "404": { $ref: "#/components/responses/NotFound" },
  "409": { $ref: "#/components/responses/Conflict" },
  "422": { $ref: "#/components/responses/Unprocessable" },
};
const security = [{ sessionCookie: [] }];
const jsonResponse = (schema: string, description = "Successful response") => ({
  description,
  content: {
    "application/json": { schema: { $ref: `#/components/schemas/${schema}` } },
  },
});

const document = {
  openapi: "3.1.0",
  info: {
    title: "Mock Trader API",
    version: "2.0.0",
    description:
      "Frozen frontend contract for the INR, market-orders-only Mock Trader MVP.",
  },
  servers: [{ url: process.env.API_PUBLIC_URL ?? "http://localhost:3000" }],
  tags: [
    { name: "Authentication" },
    { name: "Onboarding" },
    { name: "Trading" },
    { name: "Market Data" },
    { name: "Operations" },
  ],
  paths: {
    ...authPaths,
    "/health": {
      get: {
        tags: ["Operations"],
        operationId: "health",
        responses: { "200": jsonResponse("HealthResponse") },
      },
    },
    "/ready": {
      get: {
        tags: ["Operations"],
        operationId: "readiness",
        responses: {
          "200": jsonResponse("ReadinessResponse"),
          "503": jsonResponse(
            "ReadinessResponse",
            "A dependency is unavailable",
          ),
        },
      },
    },
    "/api/v1/me": {
      get: {
        tags: ["Onboarding"],
        operationId: "getMe",
        security,
        responses: {
          "200": jsonResponse("BootstrapResponse"),
          "401": errorResponses["401"],
          "403": { $ref: "#/components/responses/Forbidden" },
        },
      },
    },
    "/api/v1/me/accounts": {
      post: {
        tags: ["Onboarding"],
        operationId: "ensurePracticeAccount",
        security,
        responses: {
          "200": jsonResponse("ProvisionAccountResponse"),
          "401": errorResponses["401"],
          "403": { $ref: "#/components/responses/Forbidden" },
        },
      },
    },
    "/api/v1/me/portfolio": {
      get: {
        tags: ["Trading"],
        operationId: "getMyPortfolio",
        security,
        responses: {
          "200": jsonResponse("PortfolioResponse"),
          "401": errorResponses["401"],
        },
      },
    },
    "/api/v1/accounts/{accountId}": {
      get: {
        tags: ["Trading"],
        operationId: "getAccount",
        security,
        parameters: [{ $ref: "#/components/parameters/AccountId" }],
        responses: {
          "200": jsonResponse("AccountResponse"),
          "401": errorResponses["401"],
          "404": errorResponses["404"],
        },
      },
    },
    "/api/v1/accounts/{accountId}/activity": {
      get: {
        tags: ["Trading"],
        operationId: "listAccountActivity",
        security,
        parameters: [
          { $ref: "#/components/parameters/AccountId" },
          query("limit", { type: "integer", minimum: 1, maximum: 100 }),
          query("cursor", { type: "string" }),
        ],
        responses: {
          "200": jsonResponse("ActivityResponse"),
          "401": errorResponses["401"],
          "404": errorResponses["404"],
        },
      },
    },
    "/api/v1/accounts/{accountId}/positions": listPath(
      "listPositions",
      "PositionsResponse",
      false,
    ),
    "/api/v1/accounts/{accountId}/orders": {
      get: listOperation("listOrders", "OrdersResponse"),
      post: {
        tags: ["Trading"],
        operationId: "placeOrder",
        security,
        parameters: [
          { $ref: "#/components/parameters/AccountId" },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateOrderRequest" },
            },
          },
        },
        responses: {
          "200": jsonResponse("PlaceOrderResponse"),
          ...errorResponses,
        },
      },
    },
    "/api/v1/accounts/{accountId}/trades": listPath(
      "listTrades",
      "TradesResponse",
    ),
    "/api/v1/market/stats": publicGet("marketStats", "MarketStatsResponse"),
    "/api/v1/market/instruments/search": publicGet(
      "searchInstruments",
      "InstrumentSearchResponse",
      [
        query("q", { type: "string", maxLength: 100 }),
        query("limit", { type: "integer", minimum: 1, maximum: 100 }),
        query("exchange", { type: "string" }),
        query("scripType", { type: "string" }),
      ],
    ),
    "/api/v1/market/instruments/{id}": publicGet(
      "getInstrument",
      "Instrument",
      [{ $ref: "#/components/parameters/InstrumentId" }],
    ),
    "/api/v1/market/quotes": publicGet("getQuotes", "QuotesResponse", [
      query("ids", { type: "string" }, true),
      query("mode", { enum: ["LTP", "QUOTE", "FULL"] }),
    ]),
    "/ws/market": {
      get: {
        tags: ["Market Data"],
        operationId: "connectMarketWebSocket",
        security,
        responses: { "101": { description: "Switching Protocols" } },
        "x-websocket-contract": {
          authenticated: true,
          maxPayloadBytes: 16384,
          maxMessagesPerSecond: 30,
          reconnect: "Reconnect with backoff and resubscribe.",
        },
      },
    },
  },
  components: {
    ...authComponents,
    securitySchemes: {
      ...(authComponents.securitySchemes ?? {}),
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "better-auth.session_token",
      },
    },
    parameters: {
      ...(authComponents.parameters ?? {}),
      AccountId: pathParameter("accountId"),
      InstrumentId: pathParameter("id"),
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string", minLength: 1, maxLength: 255 },
      },
    },
    responses: {
      ...(authComponents.responses ?? {}),
      InvalidRequest: errorResponse("Request validation failed"),
      Unauthorized: errorResponse("Authentication is required"),
      Forbidden: errorResponse("The operation is forbidden"),
      NotFound: errorResponse("The resource was not found"),
      Conflict: errorResponse("The request conflicts with current state"),
      Unprocessable: errorResponse("The order cannot be executed"),
    },
    schemas: {
      ...(authComponents.schemas ?? {}),
      ApiError: {
        type: "object",
        additionalProperties: false,
        required: ["error"],
        properties: {
          error: {
            type: "object",
            additionalProperties: false,
            required: ["code", "message", "requestId"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: ["string", "null"] },
            },
          },
        },
      },
      Decimal: { type: "string", pattern: "^-?\\d+(?:\\.\\d+)?$" },
      PublicAccount: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "accountNumber",
          "type",
          "status",
          "currency",
          "startingBalance",
          "mockCashBalance",
          "mockBuyingPower",
          "reservedMockCash",
        ],
        properties: {
          id: { type: "string" },
          accountNumber: { type: "string" },
          type: { enum: ["practice", "competition", "private"] },
          status: { enum: ["active", "restricted", "suspended", "closed"] },
          currency: { const: "INR" },
          startingBalance: ref("Decimal"),
          mockCashBalance: ref("Decimal"),
          mockBuyingPower: ref("Decimal"),
          reservedMockCash: ref("Decimal"),
          openedAt: dateTime(true),
          createdAt: dateTime(),
          updatedAt: dateTime(),
        },
      },
      BootstrapResponse: {
        type: "object",
        required: [
          "user",
          "roles",
          "capabilities",
          "onboarding",
          "accounts",
          "currency",
          "features",
          "executionPolicy",
        ],
        properties: {
          user: { type: "object", additionalProperties: true },
          roles: { type: "array", items: { type: "string" } },
          capabilities: { type: "object", additionalProperties: true },
          onboarding: { type: "object", additionalProperties: true },
          accounts: { type: "array", items: ref("PublicAccount") },
          currency: { const: "INR" },
          features: {
            type: "object",
            additionalProperties: { type: "boolean" },
          },
          executionPolicy: { type: "object", additionalProperties: true },
        },
      },
      ProvisionAccountResponse: {
        type: "object",
        required: ["account", "created"],
        properties: {
          account: ref("PublicAccount"),
          created: { type: "boolean" },
        },
      },
      AccountResponse: {
        type: "object",
        required: ["account", "summary"],
        properties: {
          account: ref("PublicAccount"),
          summary: { type: "object", additionalProperties: true },
        },
      },
      LedgerEntry: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          type: { type: "string" },
          status: { type: "string" },
          amount: ref("Decimal"),
          currency: { const: "INR" },
          balanceAfter: { oneOf: [ref("Decimal"), { type: "null" }] },
          description: { type: ["string", "null"] },
          occurredAt: dateTime(),
          postedAt: dateTime(true),
        },
      },
      ActivityResponse: arrayResponse("entries", "LedgerEntry"),
      Instrument: { type: "object", additionalProperties: true },
      Position: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          accountId: { type: "string" },
          instrumentId: { type: "string" },
          quantity: ref("Decimal"),
          availableQuantity: ref("Decimal"),
          averageCost: ref("Decimal"),
          currentPrice: ref("Decimal"),
          marketValue: { type: "number" },
          realizedPnl: ref("Decimal"),
          unrealizedPnl: ref("Decimal"),
          instrument: ref("Instrument"),
          valuation: {
            type: "object",
            required: ["source", "stale", "observedAt"],
            properties: {
              source: { enum: ["latest_quote", "average_cost_fallback"] },
              stale: { type: "boolean" },
              observedAt: dateTime(true),
            },
          },
        },
      },
      Order: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          accountId: { type: "string" },
          clientOrderId: { type: "string" },
          instrumentId: { type: "string" },
          side: { enum: ["buy", "sell"] },
          type: { const: "market" },
          status: { enum: ["queued", "filled", "canceled", "rejected"] },
          timeInForce: { const: "day" },
          quantity: ref("Decimal"),
          filledQuantity: ref("Decimal"),
          averageFillPrice: { oneOf: [ref("Decimal"), { type: "null" }] },
          placedAt: dateTime(true),
          createdAt: dateTime(),
          updatedAt: dateTime(),
        },
      },
      Trade: { type: "object", additionalProperties: true },
      CreateOrderRequest: {
        type: "object",
        additionalProperties: false,
        required: ["instrumentId", "side", "type", "quantity"],
        properties: {
          instrumentId: { type: "string", minLength: 1 },
          side: { enum: ["buy", "sell"] },
          type: { const: "market" },
          quantity: { type: "number", exclusiveMinimum: 0 },
          timeInForce: { const: "day", default: "day" },
          clientOrderId: { type: "string", minLength: 1, maxLength: 255 },
          metadata: { type: ["object", "null"], additionalProperties: true },
        },
      },
      PlaceOrderResponse: {
        type: "object",
        required: [
          "order",
          "trade",
          "account",
          "position",
          "filled",
          "replayed",
        ],
        properties: {
          order: ref("Order"),
          trade: ref("Trade"),
          account: ref("PublicAccount"),
          position: ref("Position"),
          realizedPnl: { type: "number" },
          filled: { const: true },
          replayed: { type: "boolean" },
        },
      },
      PositionsResponse: arrayResponse("positions", "Position", false),
      OrdersResponse: arrayResponse("orders", "Order"),
      TradesResponse: arrayResponse("trades", "Trade"),
      PortfolioResponse: {
        type: "object",
        required: ["accounts"],
        properties: {
          accounts: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
        },
      },
      HealthResponse: { type: "object", additionalProperties: true },
      ReadinessResponse: { type: "object", additionalProperties: true },
      MarketStatsResponse: { type: "object", additionalProperties: true },
      InstrumentSearchResponse: { type: "array", items: ref("Instrument") },
      QuotesResponse: { type: "object", additionalProperties: true },
    },
  },
};

await writeFile(
  new URL("../openapi.json", import.meta.url),
  `${JSON.stringify(document, null, 2)}\n`,
);

function ref(name: string) {
  return { $ref: `#/components/schemas/${name}` };
}

function dateTime(nullable = false) {
  return {
    type: nullable ? ["string", "null"] : "string",
    format: "date-time",
  };
}

function pathParameter(name: string) {
  return { name, in: "path", required: true, schema: { type: "string" } };
}

function query(name: string, schema: object, required = false) {
  return { name, in: "query", required, schema };
}

function errorResponse(description: string) {
  return {
    description,
    content: { "application/json": { schema: ref("ApiError") } },
  };
}

function arrayResponse(property: string, itemSchema: string, paginated = true) {
  return {
    type: "object",
    required: paginated ? [property, "nextCursor"] : [property],
    properties: {
      [property]: { type: "array", items: ref(itemSchema) },
      ...(paginated ? { nextCursor: { type: ["string", "null"] } } : {}),
    },
  };
}

function listOperation(operationId: string, schema: string, paginated = true) {
  return {
    tags: ["Trading"],
    operationId,
    security,
    parameters: paginated
      ? [
          { $ref: "#/components/parameters/AccountId" },
          query("limit", { type: "integer", minimum: 1, maximum: 100 }),
          query("cursor", { type: "string" }),
        ]
      : [{ $ref: "#/components/parameters/AccountId" }],
    responses: {
      "200": jsonResponse(schema),
      "401": errorResponses["401"],
      "404": errorResponses["404"],
    },
  };
}

function listPath(operationId: string, schema: string, paginated = true) {
  return { get: listOperation(operationId, schema, paginated) };
}

function publicGet(
  operationId: string,
  schema: string,
  parameters: object[] = [],
) {
  return {
    get: {
      tags: ["Market Data"],
      operationId,
      parameters,
      responses: {
        "200": jsonResponse(schema),
        "400": errorResponses["400"],
        "404": errorResponses["404"],
      },
    },
  };
}
