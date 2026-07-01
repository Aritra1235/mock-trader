# API Docs

This API is the public backend surface for your site. Paytm remains behind the backend; no browser user should ever call Paytm auth or token flows.

## Public endpoints

- `GET /health` returns a lightweight process health response.
- `GET /ready` verifies Redis, subscription leases, Paytm session tokens, and the instrument catalog before the frontend sends market commands.
- `GET /v1/market/stats` returns catalog and stream configuration metadata.
- `GET /v1/market/instruments/search?q=RELIANCE&limit=20` searches the local Paytm security-master snapshot.
- `GET /v1/market/instruments/:id` resolves by instrument key, security id, or symbol.
- `GET /v1/market/quotes?ids=RELIANCE,3456&mode=QUOTE` returns cached quotes and refreshes stale data through the backend.
- `GET /v1/market/candles/:id?interval=1m&from=...&to=...` returns backend-built candles.
- `GET /v1/market/provider/chart?...` proxies Paytm chart data from the backend only.
- `WS /ws/market` streams subscribed quote updates.

## Readiness

`/ready` is the final preflight before the frontend sends API commands.

```json
{
  "ready": true,
  "checks": {
    "redis": true,
    "subscriptionLeases": true,
    "paytmSession": true,
    "catalog": true
  }
}
```

If any check fails, the endpoint returns `503`.

## WebSocket subscribe

```json
{
  "type": "subscribe",
  "symbols": [
    { "symbol": "RELIANCE" },
    { "scripId": "13", "exchangeType": "NSE", "scripType": "INDEX" }
  ]
}
```

## WebSocket quote event

```json
{
  "type": "quote",
  "data": {
    "instrumentKey": "NSE:EQUITY:3456",
    "securityId": "3456",
    "modeType": "QUOTE",
    "lastPrice": 1500.25,
    "receivedAt": "2026-06-29T09:45:00.000Z"
  }
}
```

## Private Paytm operations

These are shell commands only, not HTTP APIs:

```bash
bun run paytm:login-url
bun run paytm:exchange-token -- <requestToken>
bun run paytm:session
bun run verify:paytm -- RELIANCE
```
