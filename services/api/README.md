# Mock Trader API

Users talk only to this backend. Paytm auth, token exchange, and session inspection are private operator scripts, not public HTTP routes.

## Start locally

Start Redis and Postgres:

```bash
docker compose -f deploy/docker-compose.yml up redis postgres
```

Apply database migrations:

```bash
bun run db:migrate
```

Start the API:

```bash
bun run dev
```

The frontend runs at `http://localhost:3001` and calls this API at
`http://localhost:5000`. In `.env`, set `PORT=5000`,
`BETTER_AUTH_URL=http://localhost:5000`, and list every frontend origin in
`APP_ORIGINS`, separated by commas. For example:

```dotenv
APP_ORIGINS=http://localhost:3001,http://127.0.0.1:3001
```

Use origins only (no paths, trailing slash is optional). Restart the API after
changing `.env`. Check `curl http://localhost:5000/health` before diagnosing a
browser CORS error; a failed connection also appears as a CORS failure in some
browsers.

Logs are plain text, one line per event:

```text
2026-10-29T10:15:02.114Z INFO  http request method=GET path=/api/v1/me status=200 ms=12 requestId=…
```

Every HTTP request and WebSocket connection is logged after it finishes, with
the path but never the query string. Better Auth and driver errors are cut to
their first line so query parameters such as session tokens never reach the
log. Set `LOG_LEVEL` (`debug`, `info`, `warn`, `error`, `silent`) to change the
detail; health checks, docs and CORS preflights only appear at `debug`.

Start the Paytm ingest worker in a second terminal:

```bash
bun run worker:ingest
```

Refresh catalog data when needed:

```bash
bun run worker:catalog
```

Generate a new migration after schema changes:

```bash
bun run db:generate
```

Check readiness:

```bash
curl http://localhost:5000/ready
```

## Private Paytm commands

```bash
bun run paytm:login-url
bun run paytm:exchange-token -- <requestToken>
bun run paytm:session
bun run verify:paytm -- RELIANCE
```

These operator Paytm commands only require the Paytm credentials and local
`data/` files. They do not need Redis or Postgres running.

Docs are available in both Markdown and HTML under [docs](/home/aritra-bhattacharya/Desktop/Projects/mock-trader/services/api/docs).
