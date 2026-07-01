This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Price WebSocket (frontend integration)

This WebSocket is **price updates only** (LTP/QUOTE). **Chart data stays HTTP** (not over this socket).

**Endpoint**

- Default: `ws://<api-host>:3000/ws/prices` (configurable via API `PRICE_WS_PATH`)

**Client -> Server**

Subscribe:

```json
{
  "type": "subscribe",
  "symbols": [{ "scripId": "3456", "exchangeType": "NSE", "scripType": "EQUITY" }]
}
```

Unsubscribe:

```json
{
  "type": "unsubscribe",
  "symbols": [{ "scripId": "3456", "exchangeType": "NSE", "scripType": "EQUITY" }]
}
```

**Server -> Client**

On connect:

```json
{ "type": "connected", "maxSubscriptions": 50, "modeType": "LTP" }
```

On updates:

```json
{
  "type": "price",
  "data": {
    "scripId": "3456",
    "last_price": "123.45",
    "providerTs": 1747700000,
    "serverTs": 1747700001,
    "subscriptionKey": "NSE:EQUITY:LTP:3456"
  }
}
```

**Notes**

- Use **one WebSocket per browser session** and multiplex subscriptions.
- The server enforces `MAX_PRICE_SUBSCRIPTIONS` per connection (default `50`).
- Reconnect on disconnect and re-send active subscriptions.
- `providerTs`/`serverTs` are included for ordering/latency.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
