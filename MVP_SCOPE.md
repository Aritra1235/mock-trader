# Mock Trader MVP contract

This document freezes the product decisions used by the API and frontend for
the first release.

## Included

- India-focused practice trading with **INR** as the only account currency.
- Exactly one automatically provisioned practice account per verified user.
- Initial practice balance: **₹10,00,000.00**. The initial credit is recorded
  in the cash ledger exactly once.
- Google authentication and verified email/password authentication.
- Market buy and sell orders only, with `day` time-in-force.
- Deterministic, full execution at the latest fresh, tradable backend quote.
- Zero fees, zero artificial slippage, and no partial fills for the MVP.
- Instrument lot-size, freeze-quantity, tradability, quote freshness, and
  exchange price-band validation before execution.
- Portfolio, positions, orders, trades, and cash activity for the user's own
  practice account.
- Authenticated live quote WebSocket with mode-correct subscriptions.

## Explicitly deferred

- Limit, stop, and stop-limit orders.
- IOC, FOK, and GTC time-in-force.
- Account reset.
- Competition participation and administration in the customer frontend.
- Watchlists and notifications.
- Historical portfolio/candle charts and snapshot jobs.
- Brokerage fees, taxes, slippage, and partial fills.

Existing competition/admin routes are not part of the MVP frontend contract.
They may remain available to operators but must not be advertised as customer
features.

## API conventions

- Base path: `/api/v1`.
- Monetary and quantity database values are serialized as decimal strings.
- Timestamps are ISO-8601 UTC values.
- Order creation requires an `Idempotency-Key` header. Replaying the same key
  with the same account and payload returns the original result; changing the
  payload returns `409 IDEMPOTENCY_KEY_REUSED`.
- Error bodies use `{ "error": { "code", "message", "requestId" } }`.
- Browser authentication uses credentialed cookies. Frontend origins must be
  listed in `APP_ORIGINS`.
- The local frontend runs on port `3001`; the API runs on port `5000`.

## Frontend bootstrap sequence

1. Complete a Better Auth sign-in flow under `/api/v1/auth/*`.
2. Call `GET /api/v1/me` with credentials included. This idempotently creates
   the verified user's practice account when necessary.
3. Use the returned account ID and feature flags for routing.
4. Read `GET /api/v1/me/portfolio` and account activity.
5. Place orders with a new client-generated idempotency key per user action.
