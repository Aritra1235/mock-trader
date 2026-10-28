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

## Sign-up and email verification

Email sign-up (`POST /api/v1/auth/sign-up/email`) sends a 6-digit code to the
address automatically. Submit it to `POST /api/v1/auth/email-otp/verify-email`
with `{ email, otp }`; a correct code verifies the email and signs the user in.
Codes expire after 10 minutes and allow 5 attempts. Resend with
`POST /api/v1/auth/email-otp/send-verification-otp`
(`type: "email-verification"`). Signing in before verifying returns `403`
`EMAIL_NOT_VERIFIED`. Password reset uses
`/email-otp/request-password-reset` and `/email-otp/reset-password`.

## Bootstrap and onboarding

After authentication, call `GET /api/v1/me`. It returns the profile,
roles/capabilities, accounts and an `onboarding` summary
(`{ complete, currentStep, watchlist }`). It never opens an account.

Until onboarding is complete, every account, order and market-data endpoint
and the market WebSocket answer `403` with code `ONBOARDING_REQUIRED`. Only
`/me`, `/onboarding*` and the auth endpoints are open to a signed-in user.

`GET /api/v1/onboarding` returns progress, saved answers and the options for
each step. Save the steps in order:

1. `POST /onboarding/profile`: name, date of birth (18+), optional Indian
   mobile number, city, state/UT and occupation.
2. `POST /onboarding/experience`: experience level, instruments traded and
   trading style.
3. `POST /onboarding/preferences`: goals, risk appetite and starting capital
   (₹1L, ₹5L, ₹10L or ₹25L).
4. `POST /onboarding/watchlist`: 1–20 instrument IDs.
5. `POST /onboarding/agreements`: the current `termsVersion` with
   `acceptTerms` and `acceptRiskDisclosure` set to `true`. Acceptance time, IP
   and user agent are recorded; a new terms version must be accepted again.
6. `POST /onboarding/complete`: opens the practice account with the chosen
   capital and marks onboarding complete. It's idempotent. A user who already
   had an account keeps it unchanged (`existingAccount` in the state).

Each call returns the full onboarding state. Invalid answers return `422`
`INVALID_ONBOARDING`; editing after completion returns `409`
`ONBOARDING_COMPLETED`.

`POST /api/v1/me/accounts` remains for an explicit retry once onboarded. It
never creates a second practice account.

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
