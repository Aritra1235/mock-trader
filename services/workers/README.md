# workers

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run price-ingest
```

## Price ingest (Paytm live prices -> Redis)

Required environment variables:

- `REDIS_URL` (example: `redis://localhost:6379/2`)
- `PAYTM_PUBLIC_ACCESS_TOKEN` **or** `PAYTM_SESSION_PATH` (defaults to `../api/data/paytm-session.json`)

Optional environment variables:

- `PRICE_PUBLISH_INTERVAL_MS` (default: `100`)
- `PRICE_MODE_TYPE` (default: `LTP`)
- `PRICE_CONTROL_CHANNEL` (default: `price:control`)
- `PRICE_CHANNEL_PREFIX` (default: `price:tick:`)
- `PRICE_LATEST_PREFIX` (default: `price:latest:`)
- `PRICE_WS_RECONNECT_ATTEMPTS` (default: `10`)

This project was created using `bun init` in bun v1.3.10. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
