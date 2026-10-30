import { writeFile } from "node:fs/promises";
import { auth } from "../src/lib/auth";
import { ONBOARDING_STEPS } from "../src/services/onboarding/onboardingOptions";

const stepIds = ONBOARDING_STEPS.map((step) => step.id);

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
      "Frontend contract for INR mock trading with market and limit orders.",
  },
  servers: [{ url: process.env.API_PUBLIC_URL ?? "http://localhost:5000" }],
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
    "/api/v1/onboarding": {
      get: {
        tags: ["Onboarding"],
        operationId: "getOnboarding",
        description:
          "Onboarding progress, saved answers and the options for every step. Every account, order and market-data API returns 403 ONBOARDING_REQUIRED until onboarding is complete.",
        security,
        responses: {
          "200": jsonResponse("OnboardingState"),
          "401": errorResponses["401"],
          "403": { $ref: "#/components/responses/Forbidden" },
        },
      },
    },
    "/api/v1/onboarding/profile": onboardingStep(
      "saveOnboardingProfile",
      "OnboardingProfileInput",
    ),
    "/api/v1/onboarding/experience": onboardingStep(
      "saveOnboardingExperience",
      "OnboardingExperienceInput",
    ),
    "/api/v1/onboarding/preferences": onboardingStep(
      "saveOnboardingPreferences",
      "OnboardingPreferencesInput",
    ),
    "/api/v1/onboarding/watchlist": onboardingStep(
      "saveOnboardingWatchlist",
      "OnboardingWatchlistInput",
    ),
    "/api/v1/onboarding/agreements": onboardingStep(
      "acceptOnboardingAgreements",
      "OnboardingAgreementsInput",
    ),
    "/api/v1/onboarding/complete": {
      post: {
        tags: ["Onboarding"],
        operationId: "completeOnboarding",
        description:
          "Opens the practice account with the chosen starting capital once every step is done.",
        security,
        responses: {
          "200": jsonResponse("OnboardingState"),
          "401": errorResponses["401"],
          "403": { $ref: "#/components/responses/Forbidden" },
          "409": errorResponses["409"],
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
    "/api/v1/orders/{orderId}/cancel": {
      post: {
        tags: ["Trading"],
        operationId: "cancelOrder",
        security,
        parameters: [pathParameter("orderId")],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { reason: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "200": jsonResponse("CancelOrderResponse"),
          ...errorResponses,
        },
      },
    },
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
    "/api/v1/market/instruments/{id}/history": {
      get: {
        tags: ["Market Data"],
        operationId: "getInstrumentHistory",
        security,
        parameters: [
          { $ref: "#/components/parameters/InstrumentId" },
          query("range", { enum: ["5d", "1mo", "6mo", "1y"] }),
        ],
        responses: {
          "200": jsonResponse("InstrumentHistoryResponse"),
          "400": errorResponses["400"],
          "404": errorResponses["404"],
          "422": errorResponses["422"],
          "502": { description: "Historical price source unavailable" },
        },
      },
    },
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
          onboarding: ref("OnboardingSummary"),
          accounts: { type: "array", items: ref("PublicAccount") },
          currency: { const: "INR" },
          features: {
            type: "object",
            additionalProperties: { type: "boolean" },
          },
          executionPolicy: { type: "object", additionalProperties: true },
        },
      },
      OnboardingSummary: {
        type: "object",
        required: ["complete", "currentStep", "watchlist"],
        properties: {
          complete: { type: "boolean" },
          currentStep: { type: ["string", "null"], enum: [...stepIds, null] },
          watchlist: { type: "array", items: ref("OnboardingInstrument") },
        },
      },
      OnboardingInstrument: {
        type: "object",
        required: ["instrumentKey", "symbol", "name", "exchange", "scripType"],
        properties: {
          instrumentKey: { type: "string" },
          symbol: { type: "string" },
          name: { type: "string" },
          exchange: { type: "string" },
          scripType: { type: "string" },
          lotSize: { type: ["number", "null"] },
          tickSize: { type: ["number", "null"] },
        },
      },
      OnboardingOption: {
        type: "object",
        required: ["value", "label"],
        properties: {
          value: { type: "string" },
          label: { type: "string" },
          description: { type: "string" },
        },
      },
      OnboardingState: {
        type: "object",
        required: [
          "status",
          "complete",
          "emailVerified",
          "currentStep",
          "steps",
          "completedAt",
          "existingAccount",
          "data",
          "options",
        ],
        properties: {
          status: { enum: ["in_progress", "completed"] },
          complete: { type: "boolean" },
          emailVerified: { type: "boolean" },
          currentStep: { type: ["string", "null"], enum: [...stepIds, null] },
          completedAt: dateTime(true),
          existingAccount: {
            type: ["object", "null"],
            required: ["accountNumber", "startingBalance"],
            properties: {
              accountNumber: { type: "string" },
              startingBalance: { type: "number" },
            },
          },
          steps: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "title", "description", "complete"],
              properties: {
                id: { enum: stepIds },
                title: { type: "string" },
                description: { type: "string" },
                complete: { type: "boolean" },
              },
            },
          },
          data: {
            type: "object",
            required: [
              "fullName",
              "email",
              "dateOfBirth",
              "phone",
              "city",
              "state",
              "occupation",
              "experienceLevel",
              "instrumentsTraded",
              "tradingStyle",
              "tradingGoals",
              "riskAppetite",
              "startingCapital",
              "watchlist",
              "termsVersion",
              "termsAcceptedAt",
              "riskDisclosureAcceptedAt",
            ],
            properties: {
              fullName: { type: "string" },
              email: { type: "string" },
              dateOfBirth: { type: ["string", "null"], format: "date" },
              phone: { type: ["string", "null"] },
              city: { type: ["string", "null"] },
              state: { type: ["string", "null"] },
              occupation: { type: ["string", "null"] },
              experienceLevel: { type: ["string", "null"] },
              instrumentsTraded: { type: "array", items: { type: "string" } },
              tradingStyle: { type: ["string", "null"] },
              tradingGoals: { type: "array", items: { type: "string" } },
              riskAppetite: { type: ["string", "null"] },
              startingCapital: { type: ["number", "null"] },
              watchlist: { type: "array", items: ref("OnboardingInstrument") },
              termsVersion: { type: ["string", "null"] },
              termsAcceptedAt: dateTime(true),
              riskDisclosureAcceptedAt: dateTime(true),
            },
          },
          options: {
            type: "object",
            required: [
              "occupations",
              "experienceLevels",
              "instruments",
              "tradingStyles",
              "goals",
              "riskAppetites",
              "startingCapitals",
              "states",
              "minimumAge",
              "maxWatchlist",
              "suggestedInstruments",
              "terms",
            ],
            properties: {
              occupations: optionList(),
              experienceLevels: optionList(),
              instruments: optionList(),
              tradingStyles: optionList(),
              goals: optionList(),
              riskAppetites: optionList(),
              startingCapitals: {
                type: "array",
                items: {
                  type: "object",
                  required: ["value", "label"],
                  properties: {
                    value: { type: "number" },
                    label: { type: "string" },
                  },
                },
              },
              states: { type: "array", items: { type: "string" } },
              minimumAge: { type: "integer" },
              maxWatchlist: { type: "integer" },
              suggestedInstruments: {
                type: "array",
                items: ref("OnboardingInstrument"),
              },
              terms: {
                type: "object",
                required: ["version", "sections"],
                properties: {
                  version: { type: "string" },
                  sections: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["id", "title", "points"],
                      properties: {
                        id: { type: "string" },
                        title: { type: "string" },
                        points: { type: "array", items: { type: "string" } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      OnboardingProfileInput: {
        type: "object",
        required: ["fullName", "dateOfBirth", "city", "state", "occupation"],
        properties: {
          fullName: { type: "string" },
          dateOfBirth: { type: "string", format: "date" },
          phone: { type: ["string", "null"] },
          city: { type: "string" },
          state: { type: "string" },
          occupation: { type: "string" },
        },
      },
      OnboardingExperienceInput: {
        type: "object",
        required: ["experienceLevel", "instrumentsTraded", "tradingStyle"],
        properties: {
          experienceLevel: { type: "string" },
          instrumentsTraded: { type: "array", items: { type: "string" } },
          tradingStyle: { type: "string" },
        },
      },
      OnboardingPreferencesInput: {
        type: "object",
        required: ["tradingGoals", "riskAppetite", "startingCapital"],
        properties: {
          tradingGoals: { type: "array", items: { type: "string" } },
          riskAppetite: { type: "string" },
          startingCapital: { type: "number" },
        },
      },
      OnboardingWatchlistInput: {
        type: "object",
        required: ["instrumentIds"],
        properties: {
          instrumentIds: { type: "array", items: { type: "string" } },
        },
      },
      OnboardingAgreementsInput: {
        type: "object",
        required: ["termsVersion", "acceptTerms", "acceptRiskDisclosure"],
        properties: {
          termsVersion: { type: "string" },
          acceptTerms: { const: true },
          acceptRiskDisclosure: { const: true },
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
          product: { enum: ["delivery", "intraday"] },
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
          type: { enum: ["market", "limit"] },
          status: {
            enum: [
              "queued",
              "accepted",
              "partially_filled",
              "filled",
              "canceled",
              "rejected",
              "expired",
            ],
          },
          timeInForce: { enum: ["day", "gtc", "ioc"] },
          product: { enum: ["delivery", "intraday"] },
          source: {
            type: "string",
            description:
              "api for user orders; auto_square_off for intraday square-offs.",
          },
          limitPrice: { oneOf: [ref("Decimal"), { type: "null" }] },
          stopPrice: { oneOf: [ref("Decimal"), { type: "null" }] },
          expiresAt: dateTime(true),
          rejectedReason: { type: ["string", "null"] },
          canceledReason: { type: ["string", "null"] },
          notionalEstimate: { oneOf: [ref("Decimal"), { type: "null" }] },
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
          type: { enum: ["market", "limit"] },
          quantity: { type: "number", exclusiveMinimum: 0 },
          limitPrice: {
            type: ["number", "null"],
            exclusiveMinimum: 0,
            description:
              "Required for limit orders; must align with the instrument tick size.",
          },
          timeInForce: {
            enum: ["day", "gtc", "ioc"],
            default: "day",
            description: "Intraday orders accept day or ioc only.",
          },
          product: {
            ...{
              enum: ["delivery", "intraday"],
              description:
                "delivery holds on full cash; intraday trades on 5x margin and is squared off at 15:20 IST.",
            },
            default: "delivery",
          },
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
          trade: { oneOf: [ref("Trade"), { type: "null" }] },
          account: ref("PublicAccount"),
          position: { oneOf: [ref("Position"), { type: "null" }] },
          realizedPnl: { type: "number" },
          filled: { type: "boolean" },
          replayed: { type: "boolean" },
        },
      },
      PositionsResponse: arrayResponse("positions", "Position", false),
      CancelOrderResponse: {
        type: "object",
        required: ["order", "releasedReservations"],
        properties: {
          order: ref("Order"),
          releasedReservations: { type: "integer" },
        },
      },
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
      HistoricalBar: {
        type: "object",
        required: ["timestamp", "open", "high", "low", "close", "volume"],
        properties: {
          timestamp: { type: "integer", description: "Unix milliseconds" },
          open: { type: "number" },
          high: { type: "number" },
          low: { type: "number" },
          close: { type: "number" },
          volume: { type: "number" },
        },
      },
      InstrumentHistoryResponse: {
        type: "object",
        required: [
          "instrumentKey",
          "symbol",
          "source",
          "interval",
          "range",
          "bars",
        ],
        properties: {
          instrumentKey: { type: "string" },
          symbol: { type: "string" },
          source: { enum: ["Paytm Money", "Yahoo Finance"] },
          interval: { enum: ["15m", "1d"] },
          range: { enum: ["5d", "1mo", "6mo", "1y"] },
          bars: { type: "array", items: ref("HistoricalBar") },
        },
      },
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

function onboardingStep(operationId: string, input: string) {
  return {
    post: {
      tags: ["Onboarding"],
      operationId,
      security,
      requestBody: {
        required: true,
        content: { "application/json": { schema: ref(input) } },
      },
      responses: {
        "200": jsonResponse("OnboardingState"),
        "401": errorResponses["401"],
        "403": { $ref: "#/components/responses/Forbidden" },
        "409": errorResponses["409"],
        "422": errorResponses["422"],
      },
    },
  };
}

function optionList() {
  return { type: "array", items: ref("OnboardingOption") };
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
      description: "Requires a signed-in user who has completed onboarding.",
      security,
      parameters,
      responses: {
        "200": jsonResponse(schema),
        "400": errorResponses["400"],
        "401": errorResponses["401"],
        "403": { $ref: "#/components/responses/Forbidden" },
        "404": errorResponses["404"],
      },
    },
  };
}
