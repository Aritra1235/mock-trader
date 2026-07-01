# Dev Docs

## Boundary

Users interact with your site and your backend only. Paytm login, token exchange, and session inspection are private operator functions exposed through CLI scripts, not HTTP routes.

## Local workflow

Start Redis first:

```bash
docker compose -f deploy/docker-compose.yml up redis
```

Start the API:

```bash
bun run dev
```

Start the Paytm ingest worker in another terminal:

```bash
bun run worker:ingest
```

Refresh the instrument catalog when needed:

```bash
bun run worker:catalog
```

## Operator Paytm login

Generate a login URL:

```bash
bun run paytm:login-url
```

After Paytm redirects you, copy the `requestToken` query value and exchange it:

```bash
bun run paytm:exchange-token -- <requestToken>
```

Check stored session state:

```bash
bun run paytm:session
```

## Real provider verification

```bash
bun run verify:paytm -- RELIANCE
```

This uses the stored Paytm session, resolves the instrument from the local catalog, and pulls a live market data response from Paytm.

## Tests

```bash
bun test tests
```

The suite covers market parsing, catalog lookup, WebSocket fanout, `/ready`, and confirms Paytm auth endpoints are not public.
