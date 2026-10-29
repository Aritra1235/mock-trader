import { expect, test } from "bun:test";
import { positionHold } from "../../src/services/trading/mockTradingService";
import {
  dayOrderExpiry,
  intradayOrderExpiry,
  isIntradayEntryOpen,
  isIntradaySquareOffDue,
  isOrderSessionOpen,
  limitPriceMatches,
} from "../../src/services/trading/orderPolicy";

test("a buy limit is a maximum, and a sell limit is a minimum", () => {
  expect(limitPriceMatches("buy", 100, 99)).toBeTrue();
  expect(limitPriceMatches("buy", 100, 100)).toBeTrue();
  expect(limitPriceMatches("buy", 100, 101)).toBeFalse();
  expect(limitPriceMatches("sell", 100, 101)).toBeTrue();
  expect(limitPriceMatches("sell", 100, 100)).toBeTrue();
  expect(limitPriceMatches("sell", 100, 99)).toBeFalse();
});

test("Day expiry follows the simulated IST session, including after-hours and weekends", () => {
  expect(dayOrderExpiry(new Date("2026-10-29T05:00:00Z")).toISOString()).toBe(
    "2026-10-29T10:00:00.000Z",
  );
  expect(dayOrderExpiry(new Date("2026-10-29T10:00:00Z")).toISOString()).toBe(
    "2026-10-30T10:00:00.000Z",
  );
  expect(dayOrderExpiry(new Date("2026-10-30T10:01:00Z")).toISOString()).toBe(
    "2026-11-02T10:00:00.000Z",
  );
  expect(dayOrderExpiry(new Date("2026-10-31T05:00:00Z")).toISOString()).toBe(
    "2026-11-02T10:00:00.000Z",
  );
});

test("limit matching excludes after-hours and weekends", () => {
  expect(isOrderSessionOpen(new Date("2026-10-29T03:44:59Z"))).toBeFalse();
  expect(isOrderSessionOpen(new Date("2026-10-29T03:45:00Z"))).toBeTrue();
  expect(isOrderSessionOpen(new Date("2026-10-29T09:59:59Z"))).toBeTrue();
  expect(isOrderSessionOpen(new Date("2026-10-29T10:00:00Z"))).toBeFalse();
  expect(isOrderSessionOpen(new Date("2026-10-31T05:00:00Z"))).toBeFalse();
});

test("intraday entries close at 15:15 IST and positions square off at 15:20 IST", () => {
  // 09:45Z = 15:15 IST, 09:50Z = 15:20 IST on Thursday 2026-10-29.
  expect(isIntradayEntryOpen(new Date("2026-10-29T03:44:00Z"))).toBeFalse();
  expect(isIntradayEntryOpen(new Date("2026-10-29T03:45:00Z"))).toBeTrue();
  expect(isIntradayEntryOpen(new Date("2026-10-29T09:44:00Z"))).toBeTrue();
  expect(isIntradayEntryOpen(new Date("2026-10-29T09:45:00Z"))).toBeFalse();
  expect(isIntradayEntryOpen(new Date("2026-10-31T05:00:00Z"))).toBeFalse();
  expect(
    intradayOrderExpiry(new Date("2026-10-29T05:00:00Z")).toISOString(),
  ).toBe("2026-10-29T09:50:00.000Z");

  const opened = new Date("2026-10-29T05:00:00Z");
  expect(
    isIntradaySquareOffDue(new Date("2026-10-29T09:49:00Z"), opened),
  ).toBeFalse();
  expect(
    isIntradaySquareOffDue(new Date("2026-10-29T09:50:00Z"), opened),
  ).toBeTrue();
  expect(
    isIntradaySquareOffDue(new Date("2026-10-29T18:00:00Z"), opened),
  ).toBeTrue();
  // Missed square-off (server down): caught during the next session too.
  expect(
    isIntradaySquareOffDue(new Date("2026-10-30T04:00:00Z"), opened),
  ).toBeTrue();
  expect(
    isIntradaySquareOffDue(
      new Date("2026-10-30T04:00:00Z"),
      new Date("2026-10-30T03:50:00Z"),
    ),
  ).toBeFalse();
});

test("intraday positions hold 20% margin; delivery longs hold nothing extra", () => {
  // Intraday long of 1,000: cash fell 1,000, so 800 is handed back.
  expect(positionHold("intraday", 10, 100)).toBeCloseTo(-800);
  // Intraday short of 1,000: proceeds (1,000) plus 200 margin.
  expect(positionHold("intraday", -10, 100)).toBeCloseTo(1_200);
  expect(positionHold("delivery", 10, 100)).toBe(0);
  expect(positionHold("delivery", -10, 100)).toBe(2_000);
});
