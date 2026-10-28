import { expect, test } from "bun:test";
import { parseYahooBars } from "../../src/services/historicalMarketData";

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
