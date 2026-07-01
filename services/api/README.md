# Mock Trader API

Users talk only to this backend. Paytm auth, token exchange, and session inspection are private operator scripts, not public HTTP routes.

## Start locally

Start Redis:

```bash
docker compose -f deploy/docker-compose.yml up redis
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

Docs are available in both Markdown and HTML under [docs](/home/aritra-bhattacharya/Desktop/Projects/mock-trader/services/api/docs).
