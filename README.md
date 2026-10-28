# Mock Trader

A simple mock trading site for practicing trades without using real money.

## Features

- Simulated buy and sell orders
- Portfolio tracking
- Real market data

## Run locally

Install [Bun](https://bun.com) and Docker, then from the repository root:

```bash
bun run install:apps
cp -n services/api/.env.example services/api/.env
cp -n services/next-web/.env.example services/next-web/.env.local
bun run db:up
bun run db:migrate
bun run dev
```

The API runs on port 5000 and the web app on port 3001 with the example configuration. If you already have local environment files, make sure the web app's `NEXT_PUBLIC_API_URL` matches the API's `PORT`, and `DATABASE_URL` matches your Postgres settings. `bun run dev` starts both apps and the API's price ingest worker. The worker needs a valid Paytm session; see [API setup](services/api/README.md). Run `bun run db:down` to stop Redis and Postgres.

Each service can also be started separately with `bun run dev:api`, `bun run dev:web`, or `bun run dev:worker`. The separate `services/workers` price ingest app has its own command, `bun run dev:standalone-worker`; it is not part of `dev` because it duplicates the API's ingest worker.


## Notes

- This project is for learning and testing only.
- No real financial transactions are involved.
