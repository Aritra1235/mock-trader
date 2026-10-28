# Frontend integration handoff

The frozen MVP decisions live in [`MVP_SCOPE.md`](../../../MVP_SCOPE.md).

## Local endpoints

- API: `http://localhost:5000`
- Frontend: `http://localhost:3001`
- REST base: `http://localhost:5000/api/v1`
- WebSocket: `ws://localhost:5000/ws/market`

Set `credentials: "include"` on browser HTTP requests. Configure the exact
frontend origins as a comma-separated `APP_ORIGINS` list, for example
`APP_ORIGINS=http://localhost:3001,http://127.0.0.1:3001`. Each entry must be
an HTTP(S) origin without a path; wildcard origins are not supported with
credentialed cookies. `NEXT_PUBLIC_API_URL` in the frontend must point to the
API's actual host and port. Restart the API after changing its `.env`.

## Bootstrap and onboarding

After authentication, call `GET /api/v1/me`. The response includes the public
profile, roles/capabilities, onboarding state, practice account, currency,
feature flags, and execution policy. A verified user's missing practice
account and initial ledger credit are created idempotently during this call.

`POST /api/v1/me/accounts` is also available for an explicit retry. It never
creates a second practice account.

## Trading

Create a UUID in the browser for every deliberate order action and send it as
`Idempotency-Key`. Keep the key stable while retrying that action.

```http
POST /api/v1/accounts/{accountId}/orders
Idempotency-Key: 077d24d3-373b-4f83-b48f-5826697a6642
Content-Type: application/json

{"instrumentId":"RELIANCE","side":"buy","type":"market","quantity":1}
```

Only `market` + `day` is supported. Conditional orders and other
time-in-force values receive a stable `400` error.

## Portfolio valuation

Position responses include current price, market value, unrealized P&L, and a
`valuation` object with `source`, `stale`, and `observedAt`. During an upstream
outage the endpoint remains readable and explicitly marks the cost-basis
fallback as stale.

## Live quotes

The WebSocket requires the normal authenticated session cookie and validates
the browser origin. Reconnect with backoff and resend active subscriptions.
Subscriptions are routed by the full subscription key, including quote mode,
so `LTP`, `QUOTE`, and `FULL` clients do not receive each other's payloads.
Provider `raw` payloads are never sent to browsers.
