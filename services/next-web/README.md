# Mock Trader frontend

Next.js 16 app for the INR practice-trading MVP. Run it on port 3001 with `bun run dev`; the API runs on port 5000.

## API access

The browser calls the API directly at `NEXT_PUBLIC_API_URL` (default `http://localhost:5000`) with credentials, and opens the market socket at `NEXT_PUBLIC_MARKET_WS_URL`. The API must list this app's origin in `APP_ORIGINS`; that one list drives CORS, Better Auth's trusted origins and the websocket origin check.

`localhost` and `127.0.0.1` are different sites to the browser, so when both the page and the configured API host are loopback, the app calls the API on the page's own loopback name to keep the session cookie same-site. To open the dev server from another hostname, add it to `DEV_ORIGINS`.

## Sign-up and onboarding

Signed-out users see the auth screen: sign in, create an account, verify the
email with a 6-digit code, or reset a password with a code. A verified user
who hasn't finished onboarding gets the full-page setup flow in
`src/components/onboarding.tsx` instead of the terminal: personal details,
experience, goals and starting capital, a first watchlist, terms and risk
disclosure, then review. The API rejects account and market-data calls until
it's done, so the provider only starts loading quotes and portfolio data once
`/me` reports onboarding complete. The watchlist picked during onboarding
seeds the user's watchlist, which is stored per user in `localStorage`.

## Theme

Light and dark themes follow the OS setting until the user picks one with the sun/moon button in the top bar; the choice is stored in `localStorage` (`mock-trader-theme`). Colours are CSS variables in `globals.css`, with the dark values under `:root[data-theme="dark"]`.

## Layout

A broker-style terminal: a persistent watchlist on the left, the active screen on the right, and a buy/sell order window that opens over any screen. The shell and its live data live in `TraderProvider` (`src/components/trader-provider.tsx`), so the quote socket and watchlist survive navigation.

- `/` Dashboard: margin, holdings P&L, recent orders
- `/markets`: catalog search with exchange filter; large caps by default
- `/markets/[id]`: quote, session stats, candlestick chart with MA and volume
- `/portfolio` Holdings: positions valued at the latest price, with totals
- `/activity` Orders: order book, trade book, and `?tab=funds` for margin and the cash ledger

The watchlist is stored in the browser (`mock-trader-watchlist`, up to 50 instruments, exact NSE listings). It starts with six NSE large caps and migrates the older `mock-trader-pins` symbol list. Press `/` to search; hover a row for Buy, Sell, chart, and remove.

When no live quote is available, prices fall back to the last daily close and are marked as such. Orders still require a fresh live quote; the order window explains why it is disabled.

The chart uses [KLineChart](https://klinecharts.com/en-US/), an Apache-2.0 financial chart library. The API serves real exchange-specific historical OHLC bars: 15-minute candles for 5D and daily candles for 1M, 6M, and 1Y. The development data source is Yahoo Finance's chart endpoint, cached by the API for five minutes. It is an unofficial source; review data licensing and replace it with an approved feed before production use.

API calls use the checked-in OpenAPI types and credentialed cookies. A verified sign-in is followed by `GET /api/v1/me`, which provisions the practice account. Order requests use a UUID `Idempotency-Key`; retries for the same confirmation reuse the key.

Run `bun run lint` and `bun run build` to check the frontend.
