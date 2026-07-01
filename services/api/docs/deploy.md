# Deploy Docs

## Services

- `api`: HTTP API and user WebSocket gateway.
- `price-ingest`: the single upstream Paytm WebSocket consumer.
- `redis`: pub/sub, subscription leases, latest quote cache, and candle cache.
- `catalog-sync`: optional one-shot catalog refresh job.

## Start with Compose

From `services/api`:

```bash
docker compose -f deploy/docker-compose.yml up --build
```

For local development, you can start Redis only:

```bash
docker compose -f deploy/docker-compose.yml up redis
```

## Scaling

- Scale `api` horizontally.
- Keep `price-ingest` to one replica unless you explicitly shard subscriptions.
- Persist `data/` so `paytm-session.json` and `instruments.snapshot.json` survive restarts.
- Put the public load balancer in front of `api` only.

## Readiness gate

Route traffic that sends market commands only when:

```bash
curl http://localhost:3000/ready
```

returns `"ready": true`.

## Private operator tasks

Run these from the server shell, not from public routes:

```bash
bun run paytm:login-url
bun run paytm:exchange-token -- <requestToken>
bun run worker:catalog
bun run verify:paytm -- RELIANCE
```
