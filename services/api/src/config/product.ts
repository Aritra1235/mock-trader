export const MVP_PRODUCT = {
  currency: "INR",
  initialPracticeBalance: 1_000_000,
  orderTypes: ["market"] as const,
  timeInForce: ["day"] as const,
  execution: {
    priceSource: "latest_fresh_quote",
    fees: 0,
    slippage: 0,
    partialFills: false,
  },
  features: {
    marketOrders: true,
    conditionalOrders: false,
    competitions: false,
    watchlists: false,
    accountReset: false,
    liveQuotes: true,
  },
} as const;

export const INITIAL_PRACTICE_BALANCE =
  MVP_PRODUCT.initialPracticeBalance.toFixed(8);
