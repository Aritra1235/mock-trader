import { expect, test } from "bun:test";
import {
  aggregateCandles,
  createOrMergeCandle,
  normalizeTimestamp,
  parseSecurityMaster,
} from "../../src/lib/market";
import { sampleSecurityMaster } from "../testSupport";

test("parseSecurityMaster builds searchable instruments", () => {
  const records = parseSecurityMaster(sampleSecurityMaster);
  expect(records).toHaveLength(2);
  expect(records[0]?.securityId).toBe("3456");
  expect(records[0]?.instrumentKey).toBe("NSE:EQUITY:3456");
  expect(records[1]?.instrumentKey).toBe("NSE:INDEX:13");
});

test("aggregateCandles rolls 1m candles into larger buckets", () => {
  const first = createOrMergeCandle(null, 100, Date.UTC(2026, 0, 1, 9, 15), 10);
  const second = createOrMergeCandle(null, 105, Date.UTC(2026, 0, 1, 9, 16), 20);
  const aggregated = aggregateCandles([first, second], 5 * 60 * 1000);

  expect(aggregated).toHaveLength(1);
  expect(aggregated[0]?.open).toBe(100);
  expect(aggregated[0]?.close).toBe(105);
  expect(aggregated[0]?.high).toBe(105);
  expect(aggregated[0]?.volume).toBe(30);
});

test("normalizeTimestamp applies Paytm live-data epoch offset", () => {
  expect(new Date(normalizeTimestamp(1467196176) ?? 0).toISOString()).toBe(
    "2026-06-29T10:29:36.000Z"
  );
});
