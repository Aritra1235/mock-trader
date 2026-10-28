export const ONBOARDING_STEPS = [
  {
    id: "profile",
    title: "Personal details",
    description: "Who you are and where you trade from.",
  },
  {
    id: "experience",
    title: "Trading experience",
    description: "What you've traded before and how you like to trade.",
  },
  {
    id: "preferences",
    title: "Goals & capital",
    description:
      "What you want to practise and how much virtual money to start with.",
  },
  {
    id: "watchlist",
    title: "First watchlist",
    description: "Pick the stocks you want to follow.",
  },
  {
    id: "agreements",
    title: "Terms & risk disclosure",
    description: "How the practice account works and its limits.",
  },
  {
    id: "review",
    title: "Review & open account",
    description: "Check your details and open your practice account.",
  },
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]["id"];

export const ONBOARDING_OPTIONS = {
  occupations: [
    { value: "student", label: "Student" },
    { value: "salaried", label: "Salaried" },
    { value: "self_employed", label: "Self-employed" },
    { value: "business", label: "Business owner" },
    { value: "professional", label: "Professional (CA, doctor, lawyer…)" },
    { value: "retired", label: "Retired" },
    { value: "homemaker", label: "Homemaker" },
    { value: "other", label: "Other" },
  ],
  experienceLevels: [
    {
      value: "none",
      label: "I'm new to trading",
      description: "Never placed a trade.",
    },
    {
      value: "beginner",
      label: "Beginner",
      description: "Less than a year of trading.",
    },
    {
      value: "intermediate",
      label: "Intermediate",
      description: "One to three years.",
    },
    {
      value: "experienced",
      label: "Experienced",
      description: "More than three years.",
    },
  ],
  instruments: [
    { value: "equity_delivery", label: "Stocks (delivery)" },
    { value: "equity_intraday", label: "Stocks (intraday)" },
    { value: "futures", label: "Futures" },
    { value: "options", label: "Options" },
    { value: "etf", label: "ETFs" },
    { value: "mutual_funds", label: "Mutual funds" },
    { value: "commodities", label: "Commodities" },
    { value: "currency", label: "Currency" },
  ],
  tradingStyles: [
    {
      value: "intraday",
      label: "Intraday",
      description: "Open and close within the day.",
    },
    {
      value: "swing",
      label: "Swing",
      description: "Hold for a few days to weeks.",
    },
    {
      value: "positional",
      label: "Positional",
      description: "Hold for weeks to months.",
    },
    {
      value: "long_term",
      label: "Long-term investing",
      description: "Hold for years.",
    },
  ],
  goals: [
    { value: "learn_basics", label: "Learn how the market works" },
    { value: "test_strategies", label: "Test trading strategies" },
    { value: "prepare_live", label: "Prepare for trading real money" },
    { value: "practice_shorting", label: "Practise short selling" },
    { value: "track_ideas", label: "Track stock ideas" },
  ],
  riskAppetites: [
    {
      value: "conservative",
      label: "Conservative",
      description: "Protecting capital matters most.",
    },
    {
      value: "moderate",
      label: "Moderate",
      description: "Some swings for steadier growth.",
    },
    {
      value: "aggressive",
      label: "Aggressive",
      description: "Comfortable with large swings.",
    },
  ],
  startingCapitals: [
    { value: 100_000, label: "₹1 lakh" },
    { value: 500_000, label: "₹5 lakh" },
    { value: 1_000_000, label: "₹10 lakh" },
    { value: 2_500_000, label: "₹25 lakh" },
  ],
  states: [
    "Andaman and Nicobar Islands",
    "Andhra Pradesh",
    "Arunachal Pradesh",
    "Assam",
    "Bihar",
    "Chandigarh",
    "Chhattisgarh",
    "Dadra and Nagar Haveli and Daman and Diu",
    "Delhi",
    "Goa",
    "Gujarat",
    "Haryana",
    "Himachal Pradesh",
    "Jammu and Kashmir",
    "Jharkhand",
    "Karnataka",
    "Kerala",
    "Ladakh",
    "Lakshadweep",
    "Madhya Pradesh",
    "Maharashtra",
    "Manipur",
    "Meghalaya",
    "Mizoram",
    "Nagaland",
    "Odisha",
    "Puducherry",
    "Punjab",
    "Rajasthan",
    "Sikkim",
    "Tamil Nadu",
    "Telangana",
    "Tripura",
    "Uttar Pradesh",
    "Uttarakhand",
    "West Bengal",
  ],
} as const;

/** NSE large caps offered on the watchlist step. */
export const SUGGESTED_SYMBOLS = [
  "RELIANCE",
  "HDFCBANK",
  "ICICIBANK",
  "INFY",
  "TCS",
  "SBIN",
  "BHARTIARTL",
  "ITC",
  "LT",
  "KOTAKBANK",
  "AXISBANK",
  "HINDUNILVR",
  "BAJFINANCE",
  "MARUTI",
  "SUNPHARMA",
  "TATASTEEL",
  "WIPRO",
  "ASIANPAINT",
] as const;

/** Bump the version whenever the text changes; users must accept it again. */
export const TERMS = {
  version: "2026-10-29",
  sections: [
    {
      id: "terms",
      title: "Terms of use",
      points: [
        "Mock Trader is a practice platform. All money, orders, trades and positions are virtual; nothing is sent to an exchange or broker.",
        "Your practice balance has no cash value and can't be withdrawn, transferred or exchanged.",
        "One practice account per person. Accounts created to game rankings or abuse the service may be restricted.",
        "We use your details to run your account and keep the platform fair. We don't sell them.",
      ],
    },
    {
      id: "risk",
      title: "Risk disclosure",
      points: [
        "Practice results don't predict real results. Real trading adds costs, taxes, slippage and emotions that a simulator doesn't.",
        "Orders fill at the latest quote we receive, which can lag the exchange. Market data may be delayed or briefly unavailable.",
        "Short selling and leverage can lose more than you put in. Here, shorts hold buying power as margin; real brokers' rules differ.",
        "Nothing on Mock Trader is investment advice or a recommendation to buy or sell any security.",
      ],
    },
  ],
} as const;
