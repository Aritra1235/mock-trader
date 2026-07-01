# The Paytm Money Equity 1.1.4 API TypeScript client

The official TypeScript client for communicating with [PaytmMoney Equity API](https://www.paytmmoney.com/stocks/).

PMClient is a set of REST-like APIs that expose many capabilities required to build a complete investment and
trading platform. Execute orders in real time, manage user portfolio, stream live market data (WebSockets), and more, with the simple HTTP API collection.

[PaytmMoney Technology Pvt Ltd](https://www.paytmmoney.com/) (c) 2022. Licensed under the MIT License.

## Api Documentation

- [PaytmMoney API documentation](https://developer.paytmmoney.com/docs/api/logout/)

## Usage

```typescript
import { PMClient } from "ts-paytmmoney-sdk";

// Initialize PMClient using apiKey, apiSecret.
const pm = new PMClient("your_api_key", "your_api_secret");

// Initialize PMClient using apiKey, apiSecret & jwt tokens if user has already generated.
const pmWithTokens = new PMClient(
  "your_api_key",
  "your_api_secret",
  "access_token",
  "public_access_token",
  "read_access_token"
);
```

Every API returns a promise. Use `then` and `catch` or `await`.

```typescript
pm.generate_session("your_request_token")
  .then((response) => {
    console.log(response);
  })
  .catch((err) => {
    console.log(err);
  });
```

### WebSocket Usage

```typescript
import { LivePriceWebSocket } from "ts-paytmmoney-sdk";

const livePriceWebSocket = new LivePriceWebSocket();
const jwt = "your_public_access_token";

const customerPreferences = [
  {
    actionType: "ADD", // "ADD", "REMOVE"
    modeType: "LTP", // "LTP", "FULL", "QUOTE"
    scripType: "EQUITY", // "ETF", "FUTURE", "INDEX", "OPTION", "EQUITY"
    exchangeType: "NSE", // "BSE", "NSE"
    scripId: "3456"
  }
];

livePriceWebSocket.setOnOpenListener(() => {
  livePriceWebSocket.subscribe(customerPreferences);
});

livePriceWebSocket.setOnCloseListener((code, reason) => {
  console.log(`disconnected Code: ${code} Reason: ${reason}`);
});

livePriceWebSocket.setOnMessageListener((arr) => {
  console.log(arr);
});

livePriceWebSocket.setOnErrorListener((err) => {
  console.log(err);
});

livePriceWebSocket.setReconnectConfig(true, 5);
livePriceWebSocket.connect(jwt);
```
