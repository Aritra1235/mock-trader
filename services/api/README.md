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
curl http://localhost:3000/ready
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
