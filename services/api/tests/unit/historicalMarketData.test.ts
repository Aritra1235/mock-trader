import { afterEach, expect, spyOn, test } from "bun:test";
import {
  fetchHistoricalCandles,
  type PaytmHistorySource,
  parsePaytmBars,
  parseYahooBars,
  sessionBar,
} from "../../src/services/historicalMarketData";
import type { InstrumentRecord, QuotePayload } from "../../src/types/market";

test("normalizes historical OHLC bars and skips incomplete timestamps", () => {
  const bars = parseYahooBars(
    {
      chart: {
        result: [
          {
            meta: { symbol: "TCS.BO", currency: "INR" },
            timestamp: [1000, 2000],
            indicators: {
              quote: [
                {
                  open: [100, null],
                  high: [105, null],
                  low: [99, null],
                  close: [103, null],
                  volume: [200, null],
                },
              ],
            },
          },
        ],
      },
    },
    "TCS.BO",
  );
  expect(bars).toEqual([
    {
      timestamp: 1_000_000,
      open: 100,
      high: 105,
      low: 99,
      close: 103,
      volume: 200,
    },
  ]);
});

test("rejects another ticker instead of showing the wrong stock", () => {
  expect(
    parseYahooBars(
      { chart: { result: [{ meta: { symbol: "INFY.NS", currency: "INR" } }] } },
      "TCS.BO",
    ),
  ).toEqual([]);
});

const instrument = (symbol: string) =>
  ({
    instrumentKey: `NSE:EQUITY:${symbol}`,
    symbol,
    exchange: "NSE",
    series: "EQ",
  }) as InstrumentRecord;

const quote = (overrides: Partial<QuotePayload> = {}) =>
  ({
    lastPrice: 110,
    lastTradeTime: new Date().toISOString(),
    volumeTraded: 500,
    ohlc: { open: 100, high: 108, low: 99, close: 95 },
    ...overrides,
  }) as QuotePayload;

const dailyChart = { data: [["21-10-2026 00:00", 100, 105, 99, 103, 200]] };

const paytm = (
  overrides: Partial<PaytmHistorySource> = {},
): PaytmHistorySource => ({
  getDailyChart: async () => dailyChart,
  getSessionQuote: async () => null,
  ...overrides,
});

const stubYahoo = () =>
  spyOn(globalThis, "fetch").mockImplementation((async (url: URL) => {
    const symbol = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
    return Response.json({
      chart: {
        result: [
          {
            meta: { symbol, currency: "INR" },
            timestamp: [1000],
            indicators: {
              quote: [
                { open: [1], high: [2], low: [1], close: [2], volume: [3] },
              ],
            },
          },
        ],
      },
    });
  }) as unknown as typeof fetch);

afterEach(() => {
  (globalThis.fetch as { mockRestore?: () => void }).mockRestore?.();
});

test("reads Paytm rows as IST and skips malformed ones", () => {
  expect(
    parsePaytmBars({
      data: [
        ["21-10-2026 00:00", 100, 105, 99, 103, 200],
        ["22-10-2026 00:00", 100, 90, 99, 103, 200],
        ["bad", 100, 105, 99, 103, 200],
      ],
    }),
  ).toEqual([
    {
      timestamp: Date.parse("2026-10-20T18:30:00Z"),
      open: 100,
      high: 105,
      low: 99,
      close: 103,
      volume: 200,
    },
  ]);
  expect(parsePaytmBars({ message: "nope" })).toEqual([]);
});

test("a session bar uses the last price, not the provider's previous close", () => {
  expect(sessionBar(quote())).toMatchObject({
    open: 100,
    high: 110,
    low: 99,
    close: 110,
    volume: 500,
  });
  expect(sessionBar(quote({ lastTradeTime: null }))).toBeNull();
  expect(
    sessionBar(quote({ ohlc: { open: 0, high: 0, low: 0, close: 0 } })),
  ).toBeNull();
});

test("a year of NSE daily bars stays inside Paytm's span limit per request", async () => {
  const spans: [string, string][] = [];
  const history = await fetchHistoricalCandles(
    instrument("SPANS"),
    "1y",
    paytm({
      getDailyChart: async (_, fromDate, toDate) => {
        spans.push([fromDate, toDate]);
        const [year, month, day] = fromDate.split("-");
        return {
          data: [[`${day}-${month}-${year} 00:00`, 100, 105, 99, 103, 200]],
        };
      },
    }),
  );

  expect(history.source).toBe("Paytm Money");
  expect(history.interval).toBe("1d");
  expect(spans.length).toBeGreaterThan(1);
  for (const [newest, oldest] of spans) {
    expect(
      (Date.parse(newest) - Date.parse(oldest)) / 86_400_000,
    ).toBeLessThanOrEqual(89);
  }
  for (let index = 1; index < spans.length; index += 1) {
    expect(spans[index][0] < spans[index - 1][1]).toBe(true);
  }
});

test("today's live session is added after Paytm's last published bar", async () => {
  const history = await fetchHistoricalCandles(
    instrument("SESSION"),
    "1mo",
    paytm({ getSessionQuote: async () => quote() }),
  );

  expect(history.bars.at(-1)?.close).toBe(110);
  expect(history.bars.length).toBeGreaterThan(1);
});

test("a session already published by Paytm is not added twice", async () => {
  const history = await fetchHistoricalCandles(
    instrument("PUBLISHED"),
    "1mo",
    paytm({
      getSessionQuote: async () =>
        quote({ lastTradeTime: "2026-10-21T09:00:00.000Z" }),
    }),
  );

  expect(history.bars).toHaveLength(1);
});

test("falls back to Yahoo when Paytm fails or has no bars", async () => {
  const yahoo = stubYahoo();

  const failed = await fetchHistoricalCandles(
    instrument("FAILS"),
    "1mo",
    paytm({
      getDailyChart: async () => {
        throw new Error("expired");
      },
    }),
  );
  const empty = await fetchHistoricalCandles(
    instrument("EMPTY"),
    "1mo",
    paytm({ getDailyChart: async () => ({ data: [] }) }),
  );

  expect(failed.source).toBe("Yahoo Finance");
  expect(empty.source).toBe("Yahoo Finance");
  expect(yahoo).toHaveBeenCalledTimes(2);
});

test("rejects Paytm responses that mix several securities on one date", async () => {
  stubYahoo();

  const history = await fetchHistoricalCandles(
    instrument("M&M"),
    "1mo",
    paytm({
      getDailyChart: async () => ({
        data: [
          ["27-10-2026 00:00", 694, 719, 691, 713, 414549],
          ["27-10-2026 00:00", 2853, 2868, 2840, 2858, 1859202],
        ],
      }),
    }),
  );

  expect(history.source).toBe("Yahoo Finance");
});

test("15-minute history never asks Paytm", async () => {
  stubYahoo();

  const intraday = await fetchHistoricalCandles(
    instrument("INTRADAY"),
    "5d",
    paytm({
      getDailyChart: async () => {
        throw new Error("should not be called");
      },
    }),
  );

  expect(intraday).toMatchObject({ source: "Yahoo Finance", interval: "15m" });
});
