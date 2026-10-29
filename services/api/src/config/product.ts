export const MVP_PRODUCT = {
  currency: "INR",
  initialPracticeBalance: 1_000_000,
  orderTypes: ["market", "limit"] as const,
  timeInForce: ["day", "gtc", "ioc"] as const,
  products: ["delivery", "intraday"] as const,
  intraday: {
    // Flat leverage for every stock; real brokers set it per instrument.
    leverage: 5,
    entryCutoff: "15:15",
    squareOffAt: "15:20",
  },
  execution: {
    priceSource: "latest_fresh_quote",
    fees: 0,
    slippage: 0,
    partialFills: false,
  },
  features: {
    marketOrders: true,
    conditionalOrders: true,
    competitions: false,
    watchlists: false,
    accountReset: false,
    liveQuotes: true,
  },
} as const;

export const INITIAL_PRACTICE_BALANCE =
  MVP_PRODUCT.initialPracticeBalance.toFixed(8);
